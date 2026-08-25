/**
 * 章节相位机与原子提交（实现票 #17 / T3）。
 *
 * 规格锚点：dual-plane-sync-spec Q1/Q2/S2/S3 + kernel-schema I5。
 * - 正文文件即草稿：`phase: draft|committed` 相位机，文件名只是皮；
 * - ChapterCommit 无独立实体文件，物理形态 = 原子三件套：
 *   正文 md（翻转相位 + 钉 commitId）＋ 追踪 jsonl 增量 ＋ `.mozhou/events.jsonl` 事件行；
 * - 应用内重编辑已提交章节 ⇒ 移回 draft，再提交产生**新** cmit_，
 *   旧 commit 的全部物理痕迹（事件行 + 各流增量行）只增不改（I5）；
 * - 原子性模型：pending-commit 日志（`.mozhou/`，非 canon）＋ 以「正文相位翻转」为
 *   线性化点的前滚/回滚两向恢复。翻转前任何中断 ⇒ 恢复回 draft 净态；
 *   翻转后任何中断 ⇒ 恢复补齐投影与基线。两向都到不了半提交可见状态。
 *
 * 刻意取舍（后续票领地，勿在此扩权）：
 * - 五族 delta 在此只做不解释的字节级追加；行语义校验与查询归 T4；
 * - EXTERNAL_MODIFIED 五态协议归 T5，此处只提供 S2 检测面分类；
 * - 快照（每次 commit 后）保留策略未定，整书快照归回滚票；
 * - 掉电级 fsync 屏障待应用壳出现后统一加固，测试注入的是进程内故障。
 */
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newChapterCommitId, newChapterNodeId, parseDependencyManifest } from '@mozhou/kernel'
import type { DependencyManifest } from '@mozhou/kernel'
import type Database from 'better-sqlite3'
import { CanonStructureError } from './canon-read.js'
import { openDatabase } from './database.js'
import {
  MANIFEST_PATH,
  PENDING_COMMIT_PATH,
  RUNTIME_DB_PATH,
  RUNTIME_EVENTS_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
  chapterOutlinePath,
  proseChapterPath,
  type TrackingKind,
} from './layout.js'
import { refreshManifestEntries, writeManifest, type HashManifest } from './manifest.js'
import { assertCommitAppendsLegal } from './narrative-state.js'
import { sha256FileHex, sha256Hex } from './sha256.js'
import { emitFrontmatter, parseFrontmatter, type FrontmatterFieldValue } from './yaml-frontmatter.js'

export type ChapterPhase = 'draft' | 'committed'

export class ChapterPhaseError extends Error {
  override readonly name = 'ChapterPhaseError'

  constructor(readonly chapterIndex: number, detail: string) {
    super(`chapter ${chapterIndex} phase violation: ${detail}`)
  }
}

export class ChapterExistsError extends Error {
  override readonly name = 'ChapterExistsError'

  constructor(readonly relPath: string) {
    super(`chapter file already exists: ${relPath}`)
  }
}

/** S3 写前校验失败：盘上内容 ≠ 应用基线（或从未入册），挂起写入转介对账。 */
export class PreWriteHashMismatchError extends Error {
  override readonly name = 'PreWriteHashMismatchError'

  constructor(readonly relPath: string, detail: string) {
    super(`pre-write hash check failed for ${relPath}: ${detail}`)
  }
}

/** 恢复时发现日志目标被第三方字节污染——宁败不脏，人工介入。 */
export class PendingCommitConflictError extends Error {
  override readonly name = 'PendingCommitConflictError'

  constructor(readonly relPath: string, detail: string) {
    super(`pending-commit recovery conflict at ${relPath}: ${detail}`)
  }
}

export interface ProseChapterScan {
  readonly relPath: string
  /** 与章大纲节点同 id：章一体两面（规划文件 + 正文文件），watcher 按 id 归并。 */
  readonly mozhouId: string
  readonly chapterIndex: number
  readonly phase: ChapterPhase
  /** 仅 committed 态存在（exactOptionalPropertyTypes：缺席 = 键不存在）。 */
  readonly commitId: string | undefined
  readonly revision: number
  /** frontmatter 之后的正文区；draft 态即当前草稿全文。 */
  readonly body: string
}

/* ---------------------------------------------------------------------------
 * 正文文件读写（Q13 冻结字段集的正文章取用）
 * ------------------------------------------------------------------------- */

const MOZHOU_ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/

function requireField(document: { data: Readonly<Record<string, FrontmatterFieldValue>> }, key: string, relPath: string): FrontmatterFieldValue {
  const value = document.data[key]
  if (value === undefined) {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' is required`)
  }
  return value
}

function requireStringField(document: { data: Readonly<Record<string, FrontmatterFieldValue>> }, key: string, relPath: string): string {
  const value = requireField(document, key, relPath)
  if (typeof value !== 'string') {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be a string`)
  }
  return value
}

function requireNumberField(document: { data: Readonly<Record<string, FrontmatterFieldValue>> }, key: string, relPath: string): number {
  const value = requireField(document, key, relPath)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be a finite number`)
  }
  return value
}

/** 解析正文章文件为相位机状态。结构违例宁抛不猜（S5 纪律）。 */
export function readProseChapter(root: string, relPath: string): ProseChapterScan {
  const raw = readFileSync(join(root, relPath), 'utf8')
  let document: ReturnType<typeof parseFrontmatter>
  try {
    document = parseFrontmatter(raw)
  } catch (error) {
    throw new CanonStructureError(relPath, (error as Error).message)
  }

  const mozhouId = requireStringField(document, 'mozhouId', relPath)
  if (!MOZHOU_ID_PATTERN.test(mozhouId)) {
    throw new CanonStructureError(relPath, `frontmatter mozhouId must be prefixed ULID, got ${mozhouId}`)
  }
  const kind = requireStringField(document, 'kind', relPath)
  if (kind !== 'prose') {
    throw new CanonStructureError(relPath, `frontmatter kind must be 'prose', got ${kind}`)
  }
  const chapterIndex = requireNumberField(document, 'chapterIndex', relPath)
  const phase = requireStringField(document, 'phase', relPath)
  if (phase !== 'draft' && phase !== 'committed') {
    throw new CanonStructureError(relPath, `frontmatter phase must be draft|committed, got ${phase}`)
  }
  const rawCommitId = document.data['commitId']
  let commitId: string | undefined
  if (rawCommitId !== undefined) {
    if (typeof rawCommitId !== 'string' || !rawCommitId.startsWith('cmit_')) {
      const got = typeof rawCommitId === 'string' ? rawCommitId : JSON.stringify(rawCommitId)
      throw new CanonStructureError(relPath, `frontmatter commitId must be a cmit_ ULID, got ${got}`)
    }
    commitId = rawCommitId
  }
  if (phase === 'committed' && commitId === undefined) {
    throw new CanonStructureError(relPath, 'committed chapter requires commitId')
  }
  if (phase === 'draft' && commitId !== undefined) {
    throw new CanonStructureError(relPath, 'draft chapter must not carry commitId')
  }

  return {
    relPath,
    mozhouId,
    chapterIndex,
    phase,
    commitId,
    revision: requireNumberField(document, 'revision', relPath),
    body: document.body,
  }
}

/**
 * 组装正文章文件全文（字段顺序冻结，同状态逐字节一致）。
 * T17 导出：管线 Draft/Edit 步写草稿正文复用同一冻结字段序（章一体两面的
 * frontmatter 形态只有一份真源，禁止调用侧散写第二份渲染器）。
 */
export function renderProseChapter(fields: {
  mozhouId: string
  revision: number
  chapterIndex: number
  phase: ChapterPhase
  commitId?: string
  body: string
}): string {
  const front: Record<string, FrontmatterFieldValue> = {
    mozhouId: fields.mozhouId,
    kind: 'prose',
    revision: fields.revision,
    originAuthor: true,
    // Q8：正文保护不在 commit 层重复设防——不可变性即最强保护；草稿是共写区
    protected: false,
    chapterIndex: fields.chapterIndex,
    phase: fields.phase,
  }
  if (fields.commitId !== undefined) {
    front['commitId'] = fields.commitId
  }
  return `${emitFrontmatter(front)}${fields.body}`
}

/** 原地替换单个文件：同目录临时文件 + rename（rename 即原子可见点）。 */
export function atomicReplace(root: string, relPath: string, content: string): void {
  const absolute = join(root, relPath)
  const tmp = `${absolute}.mozhou-tmp`
  writeFileSync(tmp, content)
  renameSync(tmp, absolute)
}

/* ---------------------------------------------------------------------------
 * jsonl 计行（与 canon-read 同纪律：末尾换行是格式纪律，不产生幽灵空行）
 * ------------------------------------------------------------------------- */

function jsonlLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/* ---------------------------------------------------------------------------
 * pending-commit 日志与恢复
 * ------------------------------------------------------------------------- */

interface JournalAppendTarget {
  /** null = .mozhou/events.jsonl 审计账本；其余为追踪五族。 */
  readonly kind: TrackingKind | null
  readonly relPath: string
  readonly baseBytes: number
  /** kind=null 时为占位 -1。 */
  readonly baseSeq: number
  readonly payloadBase64: string
}

interface PendingCommitJournal {
  readonly journalVersion: 1
  readonly commitId: string
  readonly chapterIndex: number
  readonly proseRelPath: string
  /** 回滚向判别锚：盘上正文仍等于此摘要 ⇒ 相位未翻转，走回滚。 */
  readonly originalProseSha256: string
  /** 前滚向判别锚：盘上正文等于此摘要 ⇒ 线性化点已过，补齐收尾。 */
  readonly stagedProseSha256: string
  readonly appends: readonly JournalAppendTarget[]
}

function journalPath(root: string): string {
  return join(root, PENDING_COMMIT_PATH)
}

function writeJournal(root: string, journal: PendingCommitJournal): void {
  atomicReplace(root, PENDING_COMMIT_PATH, `${JSON.stringify(journal, null, 2)}\n`)
}

function readJournalIfExists(root: string): PendingCommitJournal | null {
  if (!existsSync(journalPath(root))) {
    return null
  }
  return JSON.parse(readFileSync(journalPath(root), 'utf8')) as PendingCommitJournal
}

/**
 * 盘上追加目标 vs 日志记录三分法：
 * untouched（未动）/ done（完整落上）/ partial（截断在载荷中段）。
 * 其余形态 = 第三方字节混入，抛冲突。
 */
type AppendDiskState =
  | { readonly state: 'untouched' }
  | { readonly state: 'done' }
  | { readonly state: 'partial'; readonly writtenBytes: number }

function classifyAppendDiskState(disk: Buffer, target: JournalAppendTarget): AppendDiskState {
  const payload = Buffer.from(target.payloadBase64, 'base64')
  const size = disk.length
  if (size < target.baseBytes) {
    throw new PendingCommitConflictError(target.relPath, `file shrank below journaled offset (${size} < ${target.baseBytes})`)
  }
  if (size === target.baseBytes) {
    return { state: 'untouched' }
  }
  const suffix = disk.subarray(target.baseBytes)
  const comparable = Math.min(suffix.length, payload.length)
  if (!suffix.subarray(0, comparable).equals(payload.subarray(0, comparable))) {
    throw new PendingCommitConflictError(target.relPath, 'bytes after journaled offset do not match staged payload')
  }
  if (suffix.length > payload.length) {
    throw new PendingCommitConflictError(target.relPath, 'file longer than journaled offset plus staged payload')
  }
  if (suffix.length === payload.length) {
    return { state: 'done' }
  }
  return { state: 'partial', writtenBytes: suffix.length }
}

function readDiskOrNull(root: string, relPath: string): Buffer | null {
  try {
    return readFileSync(join(root, relPath))
  } catch {
    return null
  }
}

/**
 * 提交恢复：open() 第一步调用。以正文相位翻转为线性化点——
 * 未翻转 ⇒ 回滚（截掉半截追加）；已翻转 ⇒ 前滚（补投影、立基线）。
 * 两向终点都删日志；无日志时零开销返回。
 */
export function recoverPendingCommit(root: string): void {
  const journal = readJournalIfExists(root)
  if (journal === null) {
    return
  }

  // 先验明所有追加目标的盘上状态，任何冲突在动第一字节前就响亮失败
  const diskStates: { target: JournalAppendTarget; disk: Buffer }[] = []
  for (const target of journal.appends) {
    const disk = readDiskOrNull(root, target.relPath)
    if (disk === null) {
      throw new PendingCommitConflictError(target.relPath, 'journaled target file is missing')
    }
    classifyAppendDiskState(disk, target)
    diskStates.push({ target, disk })
  }

  const proseRaw = readDiskOrNull(root, journal.proseRelPath)
  if (proseRaw === null) {
    throw new PendingCommitConflictError(journal.proseRelPath, 'prose file went missing during pending commit')
  }
  const proseSha = sha256Hex(proseRaw)

  if (proseSha === journal.stagedProseSha256) {
    recoverForward(root, journal, diskStates)
    return
  }
  if (proseSha === journal.originalProseSha256) {
    recoverBackward(root, journal, diskStates)
    return
  }
  throw new PendingCommitConflictError(
    journal.proseRelPath,
    'prose file matches neither journaled anchor — external edit raced a crash window',
  )
}

function recoverBackward(
  root: string,
  journal: PendingCommitJournal,
  diskStates: readonly { target: JournalAppendTarget; disk: Buffer }[],
): void {
  for (const { target, disk } of diskStates) {
    const classified = classifyAppendDiskState(disk, target)
    if (classified.state !== 'untouched') {
      truncateSync(join(root, target.relPath), target.baseBytes)
    }
  }
  // 清扫可能残留的正文临时文件（翻转前的写临时窗口）
  rmSync(`${join(root, journal.proseRelPath)}.mozhou-tmp`, { force: true })
  unlinkSync(journalPath(root))
}

function recoverForward(
  root: string,
  journal: PendingCommitJournal,
  diskStates: readonly { target: JournalAppendTarget; disk: Buffer }[],
): void {
  // 1) 补齐半截追加（partial ⇒ 归零重放，保证逐字节确定性）
  for (const { target, disk } of diskStates) {
    const classified = classifyAppendDiskState(disk, target)
    if (classified.state === 'partial') {
      truncateSync(join(root, target.relPath), target.baseBytes)
      appendFileSync(join(root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
    }
  }

  // 2) 幂等重放投影行（INSERT OR IGNORE：正常路径已插入过则跳过）
  if (journal.appends.some((target) => target.kind !== null)) {
    const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
    try {
      const insert = db.prepare(
        'INSERT OR IGNORE INTO tracking_lines (kind, seq, line_sha256, payload) VALUES (?, ?, ?, ?)',
      )
      db.transaction(() => {
        for (const target of journal.appends) {
          if (target.kind === null) {
            continue
          }
          const payload = Buffer.from(target.payloadBase64, 'base64').toString('utf8')
          jsonlLines(payload).forEach((line, offset) => {
            insert.run(target.kind, target.baseSeq + offset, sha256Hex(line), line)
          })
        }
      })()
    } finally {
      db.close()
    }
  }

  // 3) 立基线（正文 + 被触的 canon 流；events 在运行时区自动跳过）
  const staleManifest = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')) as HashManifest
  writeManifest(
    root,
    refreshManifestEntries(staleManifest, root, [
      journal.proseRelPath,
      ...journal.appends.filter((target) => target.kind !== null).map((target) => target.relPath),
    ]),
  )

  unlinkSync(journalPath(root))
}

/* ---------------------------------------------------------------------------
 * LocalDataPlane 上的相位机操作（方法体在本模块组装，保持数据面主文件薄）
 * ------------------------------------------------------------------------- */

/** commitChapter 内部阶段名——测试经 request.onStage 注入故障模拟中途失败。 */
export type CommitStage =
  | 'journal-durable'
  | 'stream-append'
  | 'event-append'
  | 'prose-flip'
  | 'projection'
  | 'manifest'

export interface CommitChapterRequest {
  readonly chapterIndex: number
  /** 提交摘要：进事件行，供书架/时间线速览。 */
  readonly summary: string
  /** 缺省 = 当前草稿正文区原样提交。 */
  readonly finalProse?: string
  /**
   * 五族增量（T4 前只做字节级追加，不解释内容）：
   * 每条记录 JSON.stringify 成一行 append 进对应追踪流。
   */
  readonly appends?: Partial<Record<TrackingKind, readonly unknown[]>>
  /**
   * T6：本次提交的依赖钉版（Q14 / US28——编译时读到的 {kind, id, revision} 精确版本）。
   * 落 ChapterCommitted 事件行；上游重算据此把受影响章节的章大纲节点标 stale。
   * 同章再次提交时后到者胜：不带清单的新提交即声明本章不再依赖旧上游版本。
   */
  readonly dependencyManifest?: DependencyManifest
  /** 测试注入点：每阶段执行前回调，抛错即模拟该阶段中途失败。 */
  readonly onStage?: ((stage: CommitStage) => void) | undefined
}

export interface ChapterCommitResult {
  readonly commitId: string
  readonly chapterIndex: number
  readonly proseRelPath: string
  readonly contentSha256: string
  readonly appendedCounts: Partial<Record<TrackingKind, number>>
}

export interface CreateChapterDraftRequest {
  readonly chapterIndex: number
  readonly title: string
}

export interface ChapterDraftPaths {
  readonly chapterNodeId: string
  readonly outlineRelPath: string
  readonly proseRelPath: string
}

/** LocalDataPlane 传给相位机操作的运行上下文（manifest 字段由操作原地刷新）。 */
export interface PlaneContext {
  readonly root: string
  readonly db: Database.Database
  manifest: HashManifest
}

/** 卷节点身份读取（createChapterDraft 需要 parentId；只解析所需字段）。 */
function readVolumeNodeId(root: string): string {
  const relPath = VOLUME_ONE_OUTLINE_PATH
  const document = parseFrontmatter(readFileSync(join(root, relPath), 'utf8'))
  const mozhouId = requireStringField(document, 'mozhouId', relPath)
  const nodeType = requireStringField(document, 'nodeType', relPath)
  if (nodeType !== 'volume') {
    throw new CanonStructureError(relPath, `expected volume node, got ${nodeType}`)
  }
  return mozhouId
}

/** S3 写前校验：目标文件盘上 hash 必须 == 基线（缺册 = 外部内容，一律拒绝静默覆盖）。 */
export function assertPreWriteHash(ctx: PlaneContext, relPath: string): void {
  const entry = ctx.manifest.files[relPath]
  const absolute = join(ctx.root, relPath)
  if (!existsSync(absolute)) {
    throw new PreWriteHashMismatchError(relPath, 'file missing on disk')
  }
  if (entry === undefined) {
    throw new PreWriteHashMismatchError(relPath, 'file is not tracked by the hash baseline')
  }
  if (sha256FileHex(absolute) !== entry.sha256) {
    throw new PreWriteHashMismatchError(relPath, 'disk content differs from baseline (external edit?)')
  }
}

/** 建章草稿：章大纲节点 + draft 正文一次落两件，登记基线。投影化与重建扫描归 canon-read 扩张票。 */
export function createChapterDraft(ctx: PlaneContext, request: CreateChapterDraftRequest): ChapterDraftPaths {
  const outlineRel = chapterOutlinePath(request.chapterIndex)
  const proseRel = proseChapterPath(request.chapterIndex)
  for (const rel of [outlineRel, proseRel]) {
    if (existsSync(join(ctx.root, rel))) {
      throw new ChapterExistsError(rel)
    }
  }

  const title = request.title.trim()
  if (title.length === 0) {
    throw new Error('chapter title must be non-empty')
  }

  const chapterNodeId = newChapterNodeId()
  const volumeNodeId = readVolumeNodeId(ctx.root)

  const outlineFields: Record<string, FrontmatterFieldValue> = {
    mozhouId: chapterNodeId,
    nodeType: 'chapter',
    parentId: volumeNodeId,
    orderIndex: request.chapterIndex - 1,
    revision: 0,
    status: 'drafted',
    originAuthor: true,
    protected: true,
  }
  writeFileSync(
    join(ctx.root, outlineRel),
    `${emitFrontmatter(outlineFields)}# ${title}\n\n> 章大纲规划态：scenes 数组挂此处（Scene 一等实体，正文归 ChapterCommit）。\n`,
  )

  const proseContent = renderProseChapter({
    mozhouId: chapterNodeId,
    revision: 0,
    chapterIndex: request.chapterIndex,
    phase: 'draft',
    body: `# ${title}\n`,
  })
  writeFileSync(join(ctx.root, proseRel), proseContent)

  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [outlineRel, proseRel])
  writeManifestFor(ctx)

  return { chapterNodeId, outlineRelPath: outlineRel, proseRelPath: proseRel }
}

function writeManifestFor(ctx: PlaneContext): void {
  writeManifest(ctx.root, ctx.manifest)
}

/** 提交章节：原子三件套（正文翻转 + 追踪流增量 + 事件行），线性化点 = 相位翻转。 */
export function commitChapter(ctx: PlaneContext, request: CommitChapterRequest): ChapterCommitResult {
  const proseRel = proseChapterPath(request.chapterIndex)
  const before = readProseChapter(ctx.root, proseRel)
  if (before.phase !== 'draft') {
    throw new ChapterPhaseError(request.chapterIndex, 'chapter is committed — reopen it before re-committing')
  }

  const touchedKinds = (Object.keys(request.appends ?? {}) as TrackingKind[]).filter((kind) => {
    const rows = request.appends?.[kind]
    return rows !== undefined && rows.length > 0
  })
  const streamTargets = TRACKING_STREAMS.filter((stream) => touchedKinds.includes(stream.kind))

  // T4 语义门禁：行校验 + 引用完整性 + M2 时间线单调——任何违例在写前
  // 校验乃至 pending-commit 日志之前抛出，零盘上副作用（宁败不脏）。
  if (touchedKinds.length > 0) {
    assertCommitAppendsLegal(ctx.root, request.appends ?? {})
  }

  // S3 写前校验：正文 + 全部将被追加的流
  assertPreWriteHash(ctx, proseRel)
  for (const stream of streamTargets) {
    assertPreWriteHash(ctx, stream.path)
  }

  const finalProse = request.finalProse ?? before.body
  const commitId = newChapterCommitId()
  const now = new Date().toISOString()

  const stagedProse = renderProseChapter({
    mozhouId: before.mozhouId,
    revision: before.revision + 1,
    chapterIndex: before.chapterIndex,
    phase: 'committed',
    commitId,
    body: finalProse.endsWith('\n') || finalProse.length === 0 ? finalProse : `${finalProse}\n`,
  })

  const appendedCounts: Partial<Record<TrackingKind, number>> = {}
  const appendTargets: JournalAppendTarget[] = []

  for (const stream of streamTargets) {
    const rows = request.appends?.[stream.kind] ?? []
    const payload = rows.map((row) => `${JSON.stringify(row)}\n`).join('')
    const baseBytes = statSync(join(ctx.root, stream.path)).size
    const baseSeq = jsonlLines(readFileSync(join(ctx.root, stream.path), 'utf8')).length
    appendedCounts[stream.kind] = rows.length
    appendTargets.push({
      kind: stream.kind,
      relPath: stream.path,
      baseBytes,
      baseSeq,
      payloadBase64: Buffer.from(payload, 'utf8').toString('base64'),
    })
  }

  const eventsDisk = readFileSync(join(ctx.root, RUNTIME_EVENTS_PATH), 'utf8')
  // T6：依赖钉版在进事件行前过冻结形状校验（宁败不脏——坏清单不产生半提交）
  const manifestFields: Record<string, unknown> =
    request.dependencyManifest === undefined
      ? {}
      : { dependencyManifest: parseDependencyManifest(request.dependencyManifest.entries) }
  const eventLine = `${JSON.stringify({
    type: 'ChapterCommitted',
    seq: jsonlLines(eventsDisk).length,
    at: now,
    commitId,
    chapterIndex: before.chapterIndex,
    chapterNodeId: before.mozhouId,
    prosePath: proseRel,
    summary: request.summary,
    contentSha256: sha256Hex(finalProse),
    appendedCounts,
    ...manifestFields,
  })}\n`
  appendTargets.push({
    kind: null,
    relPath: RUNTIME_EVENTS_PATH,
    baseBytes: Buffer.byteLength(eventsDisk, 'utf8'),
    baseSeq: -1,
    payloadBase64: Buffer.from(eventLine, 'utf8').toString('base64'),
  })

  const journal: PendingCommitJournal = {
    journalVersion: 1,
    commitId,
    chapterIndex: before.chapterIndex,
    proseRelPath: proseRel,
    originalProseSha256: sha256FileHex(join(ctx.root, proseRel)),
    stagedProseSha256: sha256Hex(stagedProse),
    appends: appendTargets,
  }

  request.onStage?.('journal-durable')
  writeJournal(ctx.root, journal)

  request.onStage?.('stream-append')
  for (const target of appendTargets) {
    if (target.kind !== null) {
      appendFileSync(join(ctx.root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
    }
  }

  request.onStage?.('event-append')
  appendFileSync(join(ctx.root, RUNTIME_EVENTS_PATH), Buffer.from(eventLine, 'utf8'))

  // —— 线性化点：此后任何中断由 recoverPendingCommit 前滚收尾 ——
  request.onStage?.('prose-flip')
  atomicReplace(ctx.root, proseRel, stagedProse)

  request.onStage?.('projection')
  insertTrackingLines(ctx.db, appendTargets)

  request.onStage?.('manifest')
  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [
    proseRel,
    ...appendTargets.filter((target) => target.kind !== null).map((target) => target.relPath),
  ])
  writeManifestFor(ctx)

  unlinkSync(journalPath(ctx.root))

  return {
    commitId,
    chapterIndex: before.chapterIndex,
    proseRelPath: proseRel,
    contentSha256: sha256Hex(finalProse),
    appendedCounts,
  }
}

function insertTrackingLines(db: Database.Database, targets: readonly JournalAppendTarget[]): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO tracking_lines (kind, seq, line_sha256, payload) VALUES (?, ?, ?, ?)',
  )
  db.transaction(() => {
    for (const target of targets) {
      if (target.kind === null) {
        continue
      }
      const payload = Buffer.from(target.payloadBase64, 'base64').toString('utf8')
      jsonlLines(payload).forEach((line, offset) => {
        insert.run(target.kind, target.baseSeq + offset, sha256Hex(line), line)
      })
    }
  })()
}

export interface ChapterReopenResult {
  readonly chapterIndex: number
  readonly reopenedFromCommitId: string
  readonly proseRelPath: string
}

/** 重开已提交章节：相位移回 draft、摘除 commitId；旧 commit 物理痕迹永不改写（I5）。 */
export function reopenChapter(ctx: PlaneContext, chapterIndex: number): ChapterReopenResult {
  const proseRel = proseChapterPath(chapterIndex)
  const before = readProseChapter(ctx.root, proseRel)
  if (before.phase !== 'committed' || before.commitId === undefined) {
    throw new ChapterPhaseError(chapterIndex, 'chapter is not committed — nothing to reopen')
  }
  assertPreWriteHash(ctx, proseRel)

  const reopened = renderProseChapter({
    mozhouId: before.mozhouId,
    revision: before.revision + 1,
    chapterIndex: before.chapterIndex,
    phase: 'draft',
    body: before.body,
  })

  // 单文件原子替换即可保证相位一致；其后的事件行缺口只损审计、不损状态机
  atomicReplace(ctx.root, proseRel, reopened)
  appendFileSync(
    join(ctx.root, RUNTIME_EVENTS_PATH),
    `${JSON.stringify({
      type: 'ChapterReopened',
      seq: jsonlLines(readFileSync(join(ctx.root, RUNTIME_EVENTS_PATH), 'utf8')).length,
      at: new Date().toISOString(),
      closedCommitId: before.commitId,
      chapterIndex: before.chapterIndex,
      prosePath: proseRel,
    })}\n`,
  )

  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [proseRel])
  writeManifestFor(ctx)

  return { chapterIndex: before.chapterIndex, reopenedFromCommitId: before.commitId, proseRelPath: proseRel }
}

/* ---------------------------------------------------------------------------
 * S2 检测面分类：只有 phase=committed 的正文章外部修改触发对账
 * ------------------------------------------------------------------------- */

export interface ReconciliationSurfaceSplit {
  /** 进入对账面：非草稿文件的修改 + 全部缺失。 */
  readonly reconcile: readonly string[]
  /** 草稿自由改（S2 豁免），从对账面剔除但保留可见性。 */
  readonly freeDraftEdits: readonly string[]
}

const PROSE_DIR_PREFIX = '正文/'

/**
 * 把 verifyBaseline 报出的 modified 按 S2 分面。判定读**当前盘上** frontmatter：
 * 外部编辑器通常只动正文区，相位标记原样保留。无法解析相位的修改一律保守入面。
 */
export function splitByReconciliationSurface(root: string, modified: readonly string[]): ReconciliationSurfaceSplit {
  const reconcile: string[] = []
  const freeDraftEdits: string[] = []
  for (const rel of modified) {
    if (!rel.startsWith(PROSE_DIR_PREFIX) || !rel.endsWith('.md')) {
      reconcile.push(rel)
      continue
    }
    try {
      const scan = readProseChapter(root, rel)
      if (scan.phase === 'draft') {
        freeDraftEdits.push(rel)
        continue
      }
    } catch {
      // 结构坏掉的正文文件更需作者过目——保守入面
    }
    reconcile.push(rel)
  }
  return { reconcile, freeDraftEdits }
}
