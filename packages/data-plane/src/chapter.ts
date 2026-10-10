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
 * - 掉电级 fsync 屏障已由 atomicWriteFileSync 统一承担（tmp → fsync → rename），
 *   测试仍以进程内故障注入为主，掉电语义靠该原语保证而非测试复现。
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  truncateSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { newChapterCommitId, newChapterNodeId, parseDependencyManifest } from '@mozhou/kernel'
import type { DependencyManifest } from '@mozhou/kernel'
import type Database from 'better-sqlite3'
import { atomicWriteFileSync, removeAtomicTmpFilesFor } from './atomic-write.js'
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
import { readManifest, refreshManifestEntries, writeManifest, type HashManifest } from './manifest.js'
import {
  OPERATION_RECORD_VERSION,
  findReplayableOperation,
  writeOperationRecordIfAbsent,
  type OperationIntent,
  type OperationRecord,
} from './operations.js'
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

/** 草稿保存冲突：盘上版本 ≠ 作者预期（双端并发/过期页面）——拒绝静默覆盖。 */
export class ProseRevisionConflictError extends Error {
  override readonly name = 'ProseRevisionConflictError'

  constructor(
    readonly chapterIndex: number,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(`prose save conflict on chapter ${chapterIndex}: expected r${expectedRevision}, disk has r${currentRevision}`)
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

/** 原地替换单个文件：同目录临时文件 → fsync → rename（rename 即原子可见点）。 */
export function atomicReplace(root: string, relPath: string, content: string): void {
  atomicWriteFileSync(join(root, relPath), content)
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
  /** v1 = 无操作身份（旧格式，读端兼容）；v2 = 携带 operation（W3 操作幂等）。 */
  readonly journalVersion: 1 | 2
  /** v2 的 save 路径没有 commitId，用空串占位（字段形状不变）。 */
  readonly commitId: string
  readonly chapterIndex: number
  readonly proseRelPath: string
  /** 回滚向判别锚：盘上正文仍等于此摘要 ⇒ 相位未翻转，走回滚。 */
  readonly originalProseSha256: string
  /** 前滚向判别锚：盘上正文等于此摘要 ⇒ 线性化点已过，补齐收尾。 */
  readonly stagedProseSha256: string
  readonly appends: readonly JournalAppendTarget[]
  /** v2 必填：操作身份（结果文件在删 journal 之前写，同一恢复单元）。 */
  readonly operation?: OperationIntent
}

/**
 * 正文规范化：末尾无换行则补一个（写入器与**请求摘要**必须共用这一个函数——
 * 否则「少一个末尾换行」的重试会被判成不同意图，幂等直接失效）。
 */
export function normalizeProseBody(body: string): string {
  return body.endsWith('\n') || body.length === 0 ? body : `${body}\n`
}

/** 回放既有操作结果：正文/版本/事件零变更，只把当时的结果与当前盘上版本一并返回。 */
function replayCommitResult(
  root: string,
  proseRel: string,
  record: OperationRecord,
  chapterIndex: number,
): ChapterCommitResult {
  let currentRevision = record.result.appliedRevision
  try {
    currentRevision = readProseChapter(root, proseRel).revision
  } catch {
    // 章此后被删除：仍回放历史结果，currentRevision 退回 appliedRevision
  }
  return {
    commitId: record.result.commitId ?? '',
    chapterIndex,
    proseRelPath: proseRel,
    contentSha256: record.result.appliedBodyHash,
    appendedCounts: {},
    replayed: true,
    appliedRevision: record.result.appliedRevision,
    currentRevision,
  }
}

function journalPath(root: string): string {
  return join(root, PENDING_COMMIT_PATH)
}

function writeJournal(root: string, journal: PendingCommitJournal): void {
  atomicReplace(root, PENDING_COMMIT_PATH, `${JSON.stringify(journal, null, 2)}\n`)
}

/** kind → 追踪流路径（TRACKING_STREAMS 是布局唯一真源，此处只做反查）。 */
const TRACKING_PATH_BY_KIND = new Map<string, string>(TRACKING_STREAMS.map((stream) => [stream.kind, stream.path]))

/** payloadBase64 必须能严格往返解码：重编码与原文一致（拒绝空白、非法字符、缺填充）。 */
function isStrictBase64(value: string): boolean {
  return Buffer.from(value, 'base64').toString('base64') === value
}

/**
 * 日志形状校验：坏日志一律抛**可定位**冲突（含 journal 路径与具体原因），
 * 绝不把 SyntaxError/TypeError 漏给调用方——恢复路径的失败必须指向具体文件。
 *
 * 语义校验（kind ∈ 五族、relPath 与 kind 对应、baseSeq 非负整数、base64 严格往返）
 * 同样在此完成：形状合法的越界 kind 会让投影 INSERT 撞 CHECK 约束并被
 * INSERT OR IGNORE 静默丢弃（静默丢行），必须在动盘之前拦下。
 * 注意：kind=null 的 events 账本目标 baseSeq 是占位 -1，非负整数规则只对追踪族生效。
 */
function assertJournalShape(value: unknown, relPath: string): PendingCommitJournal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PendingCommitConflictError(relPath, 'journal must be a JSON object')
  }
  const record = value as Record<string, unknown>
  const journalVersion = record['journalVersion']
  if (journalVersion !== 1 && journalVersion !== 2) {
    throw new PendingCommitConflictError(
      relPath,
      `journal journalVersion must be 1 or 2, got ${JSON.stringify(journalVersion)}`,
    )
  }
  if (journalVersion === 2) {
    const operation = record['operation']
    if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
      throw new PendingCommitConflictError(relPath, 'journal v2 requires an operation object')
    }
    const intent = operation as Record<string, unknown>
    for (const key of ['operationType', 'operationId', 'principalId', 'bookId', 'requestDigest'] as const) {
      if (typeof intent[key] !== 'string' || (intent[key]).length === 0) {
        throw new PendingCommitConflictError(relPath, `journal operation.${key} must be a non-empty string`)
      }
    }
    if (intent['operationType'] !== 'prose.save' && intent['operationType'] !== 'chapter.commit') {
      throw new PendingCommitConflictError(relPath, `journal operation.operationType must be prose.save|chapter.commit`)
    }
  }
  for (const key of ['commitId', 'proseRelPath', 'originalProseSha256', 'stagedProseSha256'] as const) {
    if (typeof record[key] !== 'string') {
      throw new PendingCommitConflictError(relPath, `journal field '${key}' must be a string`)
    }
  }
  const appends = record['appends']
  if (!Array.isArray(appends)) {
    throw new PendingCommitConflictError(relPath, "journal field 'appends' must be an array")
  }
  // 集合不变量：正常提交恒为「N 个唯一追踪族目标（N≥0）+ 恰好 1 个 events 账本目标」。
  // 空集合会让恢复零目标地走完并移除 journal（静默把残缺事务当终态）。
  if (appends.length === 0) {
    throw new PendingCommitConflictError(
      relPath,
      'journal appends must contain at least one target (the events ledger target is always present)',
    )
  }
  appends.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new PendingCommitConflictError(relPath, `journal appends[${index}] must be an object`)
    }
    const target = entry as Record<string, unknown>
    const kind = target['kind']
    const trackingKind = kind === null ? null : TRACKING_PATH_BY_KIND.has(kind as string) ? (kind as string) : undefined
    if (trackingKind === undefined) {
      throw new PendingCommitConflictError(
        relPath,
        `journal appends[${index}].kind must be null or one of ${TRACKING_STREAMS.map((stream) => stream.kind).join('|')}, got ${JSON.stringify(kind)}`,
      )
    }
    const targetRelPath = target['relPath']
    if (typeof targetRelPath !== 'string') {
      throw new PendingCommitConflictError(relPath, `journal appends[${index}].relPath must be a string`)
    }
    if (trackingKind !== null) {
      const expectedPath = TRACKING_PATH_BY_KIND.get(trackingKind)
      if (targetRelPath !== expectedPath) {
        throw new PendingCommitConflictError(
          relPath,
          `journal appends[${index}].relPath must be '${expectedPath}' for kind '${trackingKind}', got '${targetRelPath}'`,
        )
      }
    } else if (targetRelPath !== RUNTIME_EVENTS_PATH) {
      // kind=null = events 审计账本，落点是布局常量；篡改后会把事件行静默写进追踪流并丢掉 events
      throw new PendingCommitConflictError(
        relPath,
        `journal appends[${index}].relPath must be '${RUNTIME_EVENTS_PATH}' for the kind=null events ledger, got '${targetRelPath}'`,
      )
    }
    if (typeof target['baseBytes'] !== 'number' || !Number.isFinite(target['baseBytes'])) {
      throw new PendingCommitConflictError(relPath, `journal appends[${index}].baseBytes must be a finite number`)
    }
    const baseSeq = target['baseSeq']
    if (typeof baseSeq !== 'number' || !Number.isFinite(baseSeq)) {
      throw new PendingCommitConflictError(relPath, `journal appends[${index}].baseSeq must be a finite number`)
    }
    if (trackingKind !== null && (!Number.isInteger(baseSeq) || baseSeq < 0)) {
      throw new PendingCommitConflictError(
        relPath,
        `journal appends[${index}].baseSeq must be a non-negative integer for kind '${trackingKind}', got ${JSON.stringify(baseSeq)}`,
      )
    }
    if (trackingKind === null && baseSeq !== -1) {
      // events 账本无投影行序号：-1 是冻结占位约定，改成别的值即语义越界
      throw new PendingCommitConflictError(
        relPath,
        `journal appends[${index}].baseSeq must be -1 (events-ledger placeholder), got ${JSON.stringify(baseSeq)}`,
      )
    }
    const payloadBase64 = target['payloadBase64']
    if (typeof payloadBase64 !== 'string') {
      throw new PendingCommitConflictError(relPath, `journal appends[${index}].payloadBase64 must be a string`)
    }
    if (!isStrictBase64(payloadBase64)) {
      throw new PendingCommitConflictError(
        relPath,
        `journal appends[${index}].payloadBase64 is not strictly decodable base64 (re-encode mismatch)`,
      )
    }
  })

  // 集合不变量（逐项校验通过后）：events 账本目标恰好一个；追踪族目标不得重复 kind。
  // 0 个 events 目标会让事件行无处落、丢审计；重复 kind 会让同一流出现两个基线偏移，
  // 恢复时按目标顺序追加即产生错位字节。
  const eventsTargetCount = appends.filter((entry) => (entry as Record<string, unknown>)['kind'] === null).length
  if (eventsTargetCount !== 1) {
    throw new PendingCommitConflictError(
      relPath,
      `journal appends must contain exactly one kind=null events-ledger target, got ${eventsTargetCount}`,
    )
  }
  const seenTrackingKinds = new Set<string>()
  for (const entry of appends) {
    const kind = (entry as Record<string, unknown>)['kind']
    if (kind === null) {
      continue
    }
    if (seenTrackingKinds.has(kind as string)) {
      throw new PendingCommitConflictError(
        relPath,
        `journal appends must not repeat tracking kind '${kind as string}' (at most one append target per stream per commit)`,
      )
    }
    seenTrackingKinds.add(kind as string)
  }
  return value as PendingCommitJournal
}

/**
 * 读日志：缺失 = null（无待恢复事务）；不可读/非 JSON/形状非法一律抛
 * PendingCommitConflictError（带 journal 路径），journal 与原件保持原样。
 */
function readJournalIfExists(root: string): PendingCommitJournal | null {
  const path = journalPath(root)
  if (!existsSync(path)) {
    return null
  }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new PendingCommitConflictError(PENDING_COMMIT_PATH, `journal unreadable at ${path}: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new PendingCommitConflictError(
      PENDING_COMMIT_PATH,
      `journal is not valid JSON at ${path}: ${(error as Error).message}`,
    )
  }
  return assertJournalShape(parsed, PENDING_COMMIT_PATH)
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

/** 追加目标尾部（baseBytes 之后）必须与日志载荷逐字节相同，否则可定位冲突。 */
function assertAppendPayloadOnDisk(root: string, target: JournalAppendTarget): void {
  const disk = readFileSync(join(root, target.relPath))
  const payload = Buffer.from(target.payloadBase64, 'base64')
  const suffix = disk.subarray(target.baseBytes)
  if (suffix.length !== payload.length || !suffix.equals(payload)) {
    throw new PendingCommitConflictError(
      target.relPath,
      `disk bytes after journaled offset do not equal staged payload (${suffix.length}B != ${payload.length}B)`,
    )
  }
}

/** 回滚终点核对：目标必须只剩 baseBytes 前缀，多一字节即未收敛。 */
function assertAppendRolledBackOnDisk(root: string, target: JournalAppendTarget): void {
  const size = readFileSync(join(root, target.relPath)).length
  if (size !== target.baseBytes) {
    throw new PendingCommitConflictError(
      target.relPath,
      `rollback left ${size}B, expected journaled base ${target.baseBytes}B`,
    )
  }
}

/** flush 屏障：已写入的追加字节先落介质，journal 才允许消失。 */
function fsyncFile(absolutePath: string): void {
  const fd = openSync(absolutePath, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * 清扫本次事务可能残留的临时文件（正文 / 日志 / manifest 三个原子写落点）。
 * 按「该目标路径 + .mozhou-tmp」前缀匹配，不触碰其他目标的临时文件。
 */
function sweepJournalTmpFiles(root: string, journal: PendingCommitJournal): void {
  for (const rel of [journal.proseRelPath, MANIFEST_PATH, PENDING_COMMIT_PATH]) {
    removeAtomicTmpFilesFor(join(root, rel))
  }
}

/** 立基线后回读核对：manifest 记录必须与盘上字节一致，否则不算终态。 */
function assertManifestMatchesDisk(root: string, relPaths: readonly string[]): void {
  const manifest = readManifest(root)
  for (const rel of relPaths) {
    const entry = manifest.files[rel]
    const absolute = join(root, rel)
    if (entry === undefined || entry.sha256 !== sha256FileHex(absolute) || entry.bytes !== statSync(absolute).size) {
      throw new PendingCommitConflictError(rel, 'manifest baseline does not match recovered disk bytes')
    }
  }
}

/**
 * 投影重放：既有行内容必须与本次载荷一致，且新插入必须**确实生效**——
 * INSERT OR IGNORE 的「被忽略」不等于成功，行内容不一致或插入被忽略
 * 都抛冲突（journal 保留），绝不静默跳过、绝不静默丢行。
 */
function projectTrackingLines(db: Database.Database, targets: readonly JournalAppendTarget[]): void {
  const select = db.prepare('SELECT line_sha256, payload FROM tracking_lines WHERE kind = ? AND seq = ?')
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
        const seq = target.baseSeq + offset
        const lineSha = sha256Hex(line)
        const existing = select.get(target.kind, seq) as { line_sha256: string; payload: string } | undefined
        if (existing === undefined) {
          // 插入必须生效：INSERT OR IGNORE 撞约束（如 CHECK(kind IN …)）时会静默丢行，
          // 把「被忽略」当成功正是 W1 要消灭的静默丢行路径——changes !== 1 一律抛冲突。
          const inserted = insert.run(target.kind, seq, lineSha, line)
          if (inserted.changes !== 1) {
            throw new PendingCommitConflictError(
              target.relPath,
              `projection insert for ${target.kind}#${seq} was ignored (changes=${inserted.changes}) — refusing to treat a dropped tracking row as success`,
            )
          }
          return
        }
        if (existing.line_sha256 !== lineSha || existing.payload !== line) {
          throw new PendingCommitConflictError(
            target.relPath,
            `projection row ${target.kind}#${seq} disagrees with journaled payload — INSERT OR IGNORE would have silently skipped it`,
          )
        }
      })
    }
  })()
}

/**
 * 前滚的投影步骤。投影文件缺失时无既有行可核对（ADR-0006 可弃投影），交给
 * 重建从已补齐的 jsonl 派生；投影存在则必须核对通过，冲突照抛。
 */
function replayProjection(root: string, targets: readonly JournalAppendTarget[]): void {
  if (!targets.some((target) => target.kind !== null)) {
    return
  }
  const dbPath = join(root, RUNTIME_DB_PATH)
  if (!existsSync(dbPath)) {
    return
  }
  const db = openDatabase({ path: dbPath })
  try {
    projectTrackingLines(db, targets)
  } finally {
    db.close()
  }
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
  // 回滚终点核对 + flush：目标只剩基线前缀，且字节已落介质
  for (const { target } of diskStates) {
    assertAppendRolledBackOnDisk(root, target)
    fsyncFile(join(root, target.relPath))
  }
  // 清扫本次事务可能残留的临时文件（翻转前的写临时窗口）
  sweepJournalTmpFiles(root, journal)
  unlinkSync(journalPath(root))
}

function recoverForward(
  root: string,
  journal: PendingCommitJournal,
  diskStates: readonly { target: JournalAppendTarget; disk: Buffer }[],
): void {
  // 1) 补齐追加目标：untouched ⇒ 补写整段载荷；partial ⇒ 归零重放（逐字节确定性）
  for (const { target, disk } of diskStates) {
    const classified = classifyAppendDiskState(disk, target)
    if (classified.state === 'untouched') {
      appendFileSync(join(root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
    } else if (classified.state === 'partial') {
      truncateSync(join(root, target.relPath), target.baseBytes)
      appendFileSync(join(root, target.relPath), Buffer.from(target.payloadBase64, 'base64'))
    }
  }

  // 2) 盘上字节核对 + flush：每个目标的尾部必须与日志载荷逐字节相同，
  //    不符即抛可定位冲突并保留 journal 与原件，绝不静默确认完成
  for (const { target } of diskStates) {
    assertAppendPayloadOnDisk(root, target)
    fsyncFile(join(root, target.relPath))
  }

  // 3) 投影重放：核对既有行内容（INSERT OR IGNORE 的忽略不等于成功）
  replayProjection(root, journal.appends)

  // 4) 立基线（正文 + 被触的 canon 流；events 在运行时区自动跳过）并回读核对
  const canonTouched = [
    journal.proseRelPath,
    ...journal.appends.filter((target) => target.kind !== null).map((target) => target.relPath),
  ]
  const staleManifest = readManifest(root)
  writeManifest(root, refreshManifestEntries(staleManifest, root, canonTouched))
  assertManifestMatchesDisk(root, canonTouched)

  // 4.5) W3 操作结果（同一恢复单元）：线性化点之后、删 journal 之前幂等补写——
  //      进程死在第 4~7 步之间时，由这里补上请求身份与结果，绝不丢身份
  if (journal.operation !== undefined) {
    writeOperationRecordIfAbsent(root, buildOperationRecord(root, journal.operation, journal))
  }

  // 5) 目标完整 + flush 成功 + 投影匹配 + manifest 一致 + 操作结果落盘 ⇒ 才移除日志与残留临时文件
  sweepJournalTmpFiles(root, journal)
  unlinkSync(journalPath(root))
}

/**
 * 由 journal 重建操作结果记录（恢复路径专用）：正文已在线性化点落盘，
 * 故 appliedRevision/appliedBodyHash 从**盘上正文**读取，与正常路径同源。
 */
function buildOperationRecord(root: string, intent: OperationIntent, journal: PendingCommitJournal): OperationRecord {
  const prose = readProseChapter(root, journal.proseRelPath)
  return {
    recordVersion: OPERATION_RECORD_VERSION,
    operationId: intent.operationId,
    operationType: intent.operationType,
    principalId: intent.principalId,
    bookId: intent.bookId,
    requestDigest: intent.requestDigest,
    chapterIndex: journal.chapterIndex,
    state: 'succeeded',
    result: {
      appliedRevision: prose.revision,
      appliedBodyHash: sha256Hex(prose.body),
      ...(journal.commitId === '' ? {} : { commitId: journal.commitId }),
    },
    recordedAt: new Date().toISOString(),
  }
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
  /**
   * 作者实际读取的章版本（深化 05 Contract Delta，与 saveProseDraft.expectedRevision
   * 同构照搬）。携带时必须等于盘上 revision——不匹配即抛 ProseRevisionConflictError，
   * 写盘一步不进（正文/正典/账本零写入）。缺省（undefined）= 不启用该门：
   * 模块内部既有调用方不受影响；HTTP 契约面由路由强制在场（缺失 400）。
   */
  readonly expectedRevision?: number
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
  /** W3 操作幂等：携带时先查结果记录（同 ID 同摘要回放、不同摘要拒绝），并把身份写进 journal v2。 */
  readonly operation?: OperationIntent | undefined
}

export interface ChapterCommitResult {
  readonly commitId: string
  readonly chapterIndex: number
  readonly proseRelPath: string
  readonly contentSha256: string
  readonly appendedCounts: Partial<Record<TrackingKind, number>>
  /** W3：本次是回放既有结果（true）还是新执行（false）。 */
  readonly replayed: boolean
  /** W3：该操作**当时**落定的 revision（回放时是历史值，不是当前盘上值）。 */
  readonly appliedRevision: number
  /** W3：当前盘上 revision——UI 不得把它当成自己那次操作的基线。 */
  readonly currentRevision: number
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
  atomicWriteFileSync(
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
  atomicWriteFileSync(join(ctx.root, proseRel), proseContent)

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

  // W3 幂等前置检查必须**先于**相位/revision 门：同一操作的成功结果不因章节此后
  // 被提交或再编辑而否认（否则重试会撞 ChapterPhaseError/ProseRevisionConflictError）。
  if (request.operation !== undefined) {
    const replayed = findReplayableOperation(ctx.root, request.operation)
    if (replayed !== null) {
      return replayCommitResult(ctx.root, proseRel, replayed, request.chapterIndex)
    }
  }

  const before = readProseChapter(ctx.root, proseRel)
  if (before.phase !== 'draft') {
    throw new ChapterPhaseError(request.chapterIndex, 'chapter is committed — reopen it before re-committing')
  }
  // 深化 05 Contract Delta：作者所读 revision 与盘不符 ⇒ 拒绝（与 saveProseDraft 同码
  // ProseRevisionConflictError、同顺序——相位门在前，revision 比对在后）。编排层在
  // 提取缝之前已做同判，本门兜住提取 await 期间的并发保存窗口（TOCTOU）：任何写盘
  // 发生在 journal 落盘之后，此处先行比对即正文/正典/账本零写入。
  if (request.expectedRevision !== undefined && before.revision !== request.expectedRevision) {
    throw new ProseRevisionConflictError(request.chapterIndex, request.expectedRevision, before.revision)
  }

  const touchedKinds = (Object.keys(request.appends ?? {}) as TrackingKind[]).filter((kind) => {
    const rows = request.appends?.[kind]
    return rows !== undefined && rows.length > 0
  })
  const streamTargets = TRACKING_STREAMS.filter((stream) => touchedKinds.includes(stream.kind))

  // T4 语义门：行校验 + 引用完整性 + M2 时间线单调——任何违例在写前
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
    body: normalizeProseBody(finalProse),
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
    journalVersion: request.operation === undefined ? 1 : 2,
    commitId,
    chapterIndex: before.chapterIndex,
    proseRelPath: proseRel,
    originalProseSha256: sha256FileHex(join(ctx.root, proseRel)),
    stagedProseSha256: sha256Hex(stagedProse),
    appends: appendTargets,
    ...(request.operation === undefined ? {} : { operation: request.operation }),
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

  // flush 屏障：追加字节先落介质，才允许进入线性化点与 journal 移除
  for (const target of appendTargets) {
    fsyncFile(join(ctx.root, target.relPath))
  }

  // —— 线性化点：此后任何中断由 recoverPendingCommit 前滚收尾 ——
  request.onStage?.('prose-flip')
  atomicReplace(ctx.root, proseRel, stagedProse)

  request.onStage?.('projection')
  projectTrackingLines(ctx.db, appendTargets)

  request.onStage?.('manifest')
  const canonTouched = [
    proseRel,
    ...appendTargets.filter((target) => target.kind !== null).map((target) => target.relPath),
  ]
  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, canonTouched)
  writeManifestFor(ctx)

  // 终态核对：manifest 与盘上字节一致才移除日志（journal 只在满足终态后消失）
  assertManifestMatchesDisk(ctx.root, canonTouched)

  // W3 第 7 步：操作结果记录（线性化点之后、删 journal 之前；fsync 由 atomicWriteFileSync 承担）
  if (request.operation !== undefined) {
    writeOperationRecordIfAbsent(ctx.root, {
      recordVersion: OPERATION_RECORD_VERSION,
      operationId: request.operation.operationId,
      operationType: request.operation.operationType,
      principalId: request.operation.principalId,
      bookId: request.operation.bookId,
      requestDigest: request.operation.requestDigest,
      chapterIndex: before.chapterIndex,
      state: 'succeeded',
      result: { appliedRevision: before.revision + 1, appliedBodyHash: sha256Hex(finalProse), commitId },
      recordedAt: new Date().toISOString(),
    })
  }

  unlinkSync(journalPath(ctx.root))

  return {
    commitId,
    chapterIndex: before.chapterIndex,
    proseRelPath: proseRel,
    contentSha256: sha256Hex(finalProse),
    appendedCounts,
    replayed: false,
    appliedRevision: before.revision + 1,
    currentRevision: before.revision + 1,
  }
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
 * 草稿保存（发布评审 R1/R2）：预期版本契约 + 写前哈希 + 定稿保护
 * ------------------------------------------------------------------------- */

export interface SaveProseDraftRequest {
  readonly chapterIndex: number
  /** 作者写作层文本（保存后成为该章 Active Draft 正文）。 */
  readonly body: string
  /**
   * 作者实际读取的章版本；null = 新建语义（章必须不存在）。
   * 更新时必须等于盘上 revision——服务端绝不自行读取最新版本替换预期值。
   */
  readonly expectedRevision: number | null
  readonly title?: string | undefined
  /**
   * 作者显式确认覆盖外部修改。仅在 expectedRevision 与盘上一致且写前哈希失配
   * （外部改盘）时被采纳；revision 不匹配时一律仍拒绝。UI 上对应
   * 「我已核对最新内容」按钮——外部改盘后 revision 不变，无此确认位冲突永远无法解决。
   */
  readonly confirmExternalOverwrite?: boolean | undefined
  /** W3 操作幂等：携带时先查结果记录（同 ID 同摘要回放、不同摘要拒绝），并走轻量 journal。 */
  readonly operation?: OperationIntent | undefined
}

export interface SaveProseDraftResult {
  readonly chapterIndex: number
  readonly revision: number
  readonly phase: 'draft'
  readonly created: boolean
  readonly proseRelPath: string
  /** W3：本次是回放既有结果（true）还是新执行（false）。 */
  readonly replayed: boolean
  /** W3：该操作**当时**落定的 revision（回放时是历史值）。 */
  readonly appliedRevision: number
  /** W3：当前盘上 revision——UI 不得把它当成自己那次操作的基线。 */
  readonly currentRevision: number
}

/**
 * 作者草稿落盘（Accept → Active Draft）：
 * - committed 章：显式拒绝（ChapterPhaseError）——重开必须走 reopenChapter，绝不静默降级（R2）。
 * - 更新路径：revision 比对（双端/过期页面 → ProseRevisionConflictError）+
 *   写前哈希（外部改盘 → PreWriteHashMismatchError）双重门，冲突零磁盘变更（R1）。
 * - 新建路径：章必须不存在（ChapterExistsError），不把并发新建伪装成覆盖。
 * 成功即刷新哈希基线（与 createChapterDraft/reopenChapter 同纪律）。
 */
export function saveProseDraft(ctx: PlaneContext, request: SaveProseDraftRequest): SaveProseDraftResult {
  const proseRel = proseChapterPath(request.chapterIndex)

  // W3 幂等前置检查：先于新建/相位/revision 门——同一操作的成功结果不因章节此后
  // 被再编辑或被提交而否认。
  if (request.operation !== undefined) {
    const replayed = findReplayableOperation(ctx.root, request.operation)
    if (replayed !== null) {
      let currentRevision = replayed.result.appliedRevision
      try {
        currentRevision = readProseChapter(ctx.root, proseRel).revision
      } catch {
        // 章此后被删除：仍回放历史结果
      }
      return {
        chapterIndex: request.chapterIndex,
        revision: currentRevision,
        phase: 'draft',
        created: false,
        proseRelPath: proseRel,
        replayed: true,
        appliedRevision: replayed.result.appliedRevision,
        currentRevision,
      }
    }
  }

  const isNew = request.expectedRevision === null

  if (isNew) {
    // 新建语义：createChapterDraft 对已存在章抛 ChapterExistsError（不静默转覆盖）
    createChapterDraft(ctx, { chapterIndex: request.chapterIndex, title: request.title?.trim() || `第${request.chapterIndex}章` })
  }

  const existing = readProseChapter(ctx.root, proseRel)
  if (!isNew) {
    if (existing.phase === 'committed') {
      throw new ChapterPhaseError(request.chapterIndex, 'chapter is committed — explicit reopen required before editing')
    }
    if (existing.revision !== request.expectedRevision) {
      throw new ProseRevisionConflictError(request.chapterIndex, request.expectedRevision, existing.revision)
    }
    try {
      assertPreWriteHash(ctx, proseRel)
    } catch (error) {
      if (!(error instanceof PreWriteHashMismatchError) || request.confirmExternalOverwrite !== true) throw error
      // 作者已显式确认覆盖外部修改（revision 匹配前提下）——继续写入并刷新基线
    }
  }

  const normalizedBody = normalizeProseBody(request.body)
  const content = renderProseChapter({
    mozhouId: existing.mozhouId,
    revision: existing.revision + 1,
    chapterIndex: existing.chapterIndex,
    phase: 'draft',
    body: normalizedBody,
  })

  // W3：草稿保存同样要有可恢复的意图/结果记录（规划 §6.4.4）。用轻量 v2 journal：
  // 正文翻转退化为覆盖写，appends 只放一个**空载荷**的 events 目标——既满足 journal
  // 集合不变量（恰好一个 kind=null 目标），又不产生任何字节变化。
  if (request.operation !== undefined) {
    const emptyEventsTarget: JournalAppendTarget = {
      kind: null,
      relPath: RUNTIME_EVENTS_PATH,
      baseBytes: statSync(join(ctx.root, RUNTIME_EVENTS_PATH)).size,
      baseSeq: -1,
      payloadBase64: '',
    }
    writeJournal(ctx.root, {
      journalVersion: 2,
      commitId: '',
      chapterIndex: existing.chapterIndex,
      proseRelPath: proseRel,
      originalProseSha256: sha256FileHex(join(ctx.root, proseRel)),
      stagedProseSha256: sha256Hex(content),
      appends: [emptyEventsTarget],
      operation: request.operation,
    })
  }

  atomicReplace(ctx.root, proseRel, content)
  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [proseRel])
  writeManifestFor(ctx)

  if (request.operation !== undefined) {
    writeOperationRecordIfAbsent(ctx.root, {
      recordVersion: OPERATION_RECORD_VERSION,
      operationId: request.operation.operationId,
      operationType: request.operation.operationType,
      principalId: request.operation.principalId,
      bookId: request.operation.bookId,
      requestDigest: request.operation.requestDigest,
      chapterIndex: existing.chapterIndex,
      state: 'succeeded',
      result: { appliedRevision: existing.revision + 1, appliedBodyHash: sha256Hex(normalizedBody) },
      recordedAt: new Date().toISOString(),
    })
    unlinkSync(journalPath(ctx.root))
  }

  return {
    chapterIndex: existing.chapterIndex,
    revision: existing.revision + 1,
    phase: 'draft',
    created: isNew,
    proseRelPath: proseRel,
    replayed: false,
    appliedRevision: existing.revision + 1,
    currentRevision: existing.revision + 1,
  }
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
