/**
 * 外部修改五态对账（实现票 #20 / T5）。
 *
 * 规格锚点：dual-plane-sync-spec Q4/Q8-Q12 + 不变量 S1-S7；ADR-0010/0019。
 *
 *   - 检测面（Q4）：启动必检 + 运行期 watcher（mtime 预筛 → SHA-256 复核），
 *     承诺语义 = 最终必检出。触发源三分：startupScan / watcher / preWriteReferral
 *     （S3 写前校验抛错后由调用方经 intakePaths 转介）。
 *   - 五态生命周期（Q8/Q11）：detected → extracting → awaiting_author →
 *     applied | partially_applied | dismissed；extract_failed 一键重试回 extracting。
 *     提案逐份落 `.mozhou/reconciliations/rcln_<ULID>.json`，跨会话存活。
 *   - 关键语义（Q12/S4）：拒绝一条 delta ≠ 回滚文件——文件保持作者改后的样子，
 *     仅该断言不升格进投影；**基线无论取舍照常更新**（终态即吸收盘上现状），
 *     因此不会死循环重报；已被拒过的 (旧行,新行) 对与新行载荷在再检出中被抑制。
 *   - S2 分面复用 T3 的 verifyBaseline：只有非草稿面进入对账，草稿自由改。
 *   - 未批准前正典与投影零触碰；提取为确定性结构摘要（frontmatter / 行级 diff），
 *     LLM 语义提取是后续票的事——经 extract 接缝注入替换。
 *
 * 刻意取舍（后续票领地，勿在此扩权）：
 * - 追踪行的字段级 Schema 校验与「逻辑退役」默认建议需要 T4 的行 Schema；
 * - 对账未决期间的 Context 编译软门禁归编译器票；
 * - 章节大纲文件的物理删除无法从路径反解 mozhouId（身份在 frontmatter），批准即响亮
 *   拒绝并提示走 rebuildProjectionFromCanon（S5 确定性恢复兜底）。
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { newUlid } from '@mozhou/kernel'
import type Database from 'better-sqlite3'
import type { BaselineReport } from './local-data-plane.js'
import { readProseChapter } from './chapter.js'
import { CanonStructureError, readBookRecord, scanEntityCards } from './canon-read.js'
import {
  AUTHOR_INTENT_PATH,
  BOOK_RECORD_PATH,
  CHAPTER_OUTLINE_DIR,
  ENTITY_CARD_DIR_BY_PREFIX,
  PROSE_DIR,
  RUNTIME_EVENTS_PATH,
  RUNTIME_RECONCILIATIONS_DIR,
  STYLE_PROFILE_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
  ZONGGANG_PATH,
  isCanonRelPath,
  type TrackingKind,
} from './layout.js'
import { listAllFiles, refreshManifestEntries, writeManifest, type HashManifest } from './manifest.js'
import { syncEntityCardRows } from './projection.js'
import { sha256FileHex, sha256Hex } from './sha256.js'
import { parseFrontmatter, type FrontmatterFieldValue } from './yaml-frontmatter.js'

/* ----------------------------------------------------------------------------
 * 类型面：五态 / 触发源 / 变更摘要判别联合 / 提案记录
 * ------------------------------------------------------------------------- */

export type ReconciliationState =
  | 'detected'
  | 'extracting'
  | 'awaiting_author'
  | 'applied'
  | 'partially_applied'
  | 'dismissed'
  | 'extract_failed'

export type ReconciliationTrigger = 'startupScan' | 'watcher' | 'preWriteReferral'
export type ResolutionKind = 'applied' | 'partially_applied' | 'dismissed'

export interface FieldDiff {
  readonly field: string
  readonly before: string | number | boolean | null
  readonly after: string | number | boolean | null
}

export interface TrackingLineAddition {
  /** 该行在盘上文件中的行号（0 起）。 */
  readonly seqOnDisk: number
  readonly payload: string
}

export interface TrackingLineChange {
  /** 基线行序号（投影 tracking_lines.seq）。 */
  readonly seq: number
  readonly baselineSha256: string
  readonly diskPayload: string
}

export interface TrackingLineRemoval {
  readonly seq: number
  readonly baselinePayload: string
}

export interface InvalidTrackingLine {
  readonly lineNo: number
  readonly reason: string
}

/** 路径类别：检测与应用两段共用的分派键。 */
export type ReconciliationPathClass =
  | 'proseChapter'
  | 'trackingStream'
  | 'entityCard'
  | 'outlineNode'
  | 'planningArtifact'
  | 'bookRecord'
  | 'other'

/**
 * 变更摘要（Q8 的确定性 v1）：按路径类别给出作者可读的差异面。
 * 正文区无基线文本可 diff（基线只存指纹），正文摘要以相位机 frontmatter 为准；
 * 追踪流以投影行为基线做行级三分法（Q12）；结构化 md 与投影行做字段 diff。
 */
export type ChangeSummary =
  | {
      readonly kind: 'proseChapter'
      readonly mozhouId: string | null
      readonly chapterIndex: number | null
      readonly phase: 'draft' | 'committed' | 'unreadable'
      readonly revision: number | null
    }
  | {
      readonly kind: 'trackingStream'
      readonly streamKind: TrackingKind
      readonly additions: readonly TrackingLineAddition[]
      readonly changes: readonly TrackingLineChange[]
      readonly removals: readonly TrackingLineRemoval[]
      readonly invalidLines: readonly InvalidTrackingLine[]
    }
  | {
      readonly kind: 'structuredFile'
      readonly fileType: 'outlineNode' | 'planningArtifact' | 'bookRecord'
      readonly id: string | null
      readonly fieldDiffs: readonly FieldDiff[]
      /** planningArtifact 的内容摘要必然变化（检出的充要条件），单列成位。 */
      readonly contentChanged: boolean
    }
  | { readonly kind: 'entityCard'; readonly ref: string; readonly fieldDiffs: readonly FieldDiff[] }
  | { readonly kind: 'newEntityCard'; readonly ref: string; readonly cardType: string; readonly name: string }
  | { readonly kind: 'fileDeleted'; readonly fileType: ReconciliationPathClass }
  | { readonly kind: 'opaqueFile'; readonly bytesBefore: number; readonly bytesAfter: number }

/** 已拒绝的追踪修改行决策（抑制账本：同路径再检出不再重复上报同一对差异）。 */
export interface RejectedLineChangePair {
  readonly baselineSha256: string
  readonly diskPayload: string
}

export interface ReconciliationProposal {
  readonly proposalVersion: 1
  readonly proposalId: string
  readonly relPath: string
  readonly state: ReconciliationState
  readonly triggerSource: ReconciliationTrigger
  readonly detectedAt: string
  /** 检出时的基线指纹（应用最后一次写入；untracked 无册记为空串）。 */
  readonly baselineSha256: string
  readonly baselineBytes: number
  readonly diskSha256: string | null
  readonly diskBytes: number | null
  readonly summary: ChangeSummary | null
  readonly extractErrorDetail: string | null
  readonly resolvedAt: string | null
  readonly resolution: ResolutionKind | null
  readonly rejectedLineChanges: readonly RejectedLineChangePair[]
  readonly rejectedLineAdditions: readonly string[]
}

export interface ScanOutcome {
  readonly proposed: readonly ReconciliationProposal[]
  readonly draftsExempted: readonly string[]
}

/* ----------------------------------------------------------------------------
 * 提取器接缝：确定性结构摘要是缺省实现；LLM 语义提取由后续票注入替换。
 * ------------------------------------------------------------------------- */

export interface ExtractRequest {
  readonly root: string
  readonly relPath: string
}

/** 提取上下文：自定义提取器读投影与基线所需的运行时面。 */
export interface ExtractContext {
  readonly root: string
  readonly db: Database.Database
  readonly manifest: HashManifest
}

export type Extractor = (request: ExtractRequest, context: ExtractContext) => ChangeSummary

/* ----------------------------------------------------------------------------
 * 服务宿主（结构化接口，LocalDataPlane 天然满足；规避运行时循环依赖）
 * ------------------------------------------------------------------------- */

export interface ReconciliationHost {
  readonly root: string
  readonly db: Database.Database
  readonly manifest: HashManifest
  verifyBaseline(): BaselineReport
  reloadManifest(): void
}

export class ReconciliationError extends Error {
  override readonly name = 'ReconciliationError'
}

/* ----------------------------------------------------------------------------
 * 路径分类（唯一真源）
 * ------------------------------------------------------------------------- */

const CARD_DIRS = Object.values(ENTITY_CARD_DIR_BY_PREFIX)

export function classifyReconciliationPath(relPosixPath: string): ReconciliationPathClass {
  if (relPosixPath === BOOK_RECORD_PATH) return 'bookRecord'
  if (TRACKING_STREAMS.some((stream) => stream.path === relPosixPath)) return 'trackingStream'
  if (CARD_DIRS.some((dir) => relPosixPath.startsWith(`${dir}/`)) && relPosixPath.endsWith('.md')) {
    return 'entityCard'
  }
  if (
    relPosixPath === ZONGGANG_PATH ||
    relPosixPath === VOLUME_ONE_OUTLINE_PATH ||
    relPosixPath.startsWith(`${CHAPTER_OUTLINE_DIR}/`)
  ) {
    return 'outlineNode'
  }
  if (relPosixPath === AUTHOR_INTENT_PATH || relPosixPath === STYLE_PROFILE_PATH) {
    return 'planningArtifact'
  }
  if (relPosixPath.startsWith(`${PROSE_DIR}/`) && relPosixPath.endsWith('.md')) return 'proseChapter'
  return 'other'
}

function trackingKindOf(rel: string): TrackingKind {
  const stream = TRACKING_STREAMS.find((candidate) => candidate.path === rel)
  if (stream === undefined) {
    throw new ReconciliationError(`not a tracking stream path: ${rel}`)
  }
  return stream.kind
}

/* ----------------------------------------------------------------------------
 * 缺省确定性提取器
 * ------------------------------------------------------------------------- */

function diskLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function scalarOf(value: FrontmatterFieldValue): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  // 数组等复杂值序列化为稳定 JSON 串参与 diff
  return JSON.stringify(value)
}

function titleFromHeading(body: string): string | null {
  const match = /^#\s+(.+)\s*$/m.exec(body)
  return match === null ? null : (match[1]?.trim() ?? null)
}

interface ParsedDocument {
  readonly data: Readonly<Record<string, FrontmatterFieldValue>>
  readonly body: string
}

function parseDocumentSafe(root: string, rel: string): ParsedDocument | null {
  try {
    return parseFrontmatter(readFileSync(join(root, rel), 'utf8'))
  } catch {
    return null
  }
}

/** Q12 新增行资格线（v1）：JSON 对象 + 前缀化 ULID 形态的 id；字段级校验归 T4。 */
function isValidCandidateRow(payload: string): boolean {
  const parsed = tryParseJson(payload)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
  const id = (parsed as Record<string, unknown>)['id']
  return typeof id === 'string' && /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(id)
}

interface BaselineTrackingRow {
  readonly seq: number
  readonly lineSha256: string
  readonly payload: string
}

function baselineTrackingRows(db: Database.Database, kind: TrackingKind): BaselineTrackingRow[] {
  return db
    .prepare('SELECT seq, line_sha256 AS lineSha256, payload FROM tracking_lines WHERE kind = ? ORDER BY seq')
    .all(kind) as BaselineTrackingRow[]
}

/** Q12 行级三分法：尾追加=新增、中段改写=修改、基线有盘上无=删除；坏行进解析失败清单。 */
function summarizeTrackingStream(request: ExtractRequest, context: ExtractContext, kind: TrackingKind): ChangeSummary {
  let raw: string
  try {
    raw = readFileSync(join(request.root, request.relPath), 'utf8')
  } catch (error) {
    throw new ReconciliationError(`tracking stream unreadable at ${request.relPath}: ${(error as Error).message}`)
  }
  const lines = diskLines(raw)
  const baseline = baselineTrackingRows(context.db, kind)

  const additions: TrackingLineAddition[] = []
  const changes: TrackingLineChange[] = []
  const removals: TrackingLineRemoval[] = []
  const invalidLines: InvalidTrackingLine[] = []

  for (const [index, payload] of lines.entries()) {
    if (!isValidCandidateRow(payload)) {
      invalidLines.push({ lineNo: index, reason: 'line is not a valid candidate row (JSON object with prefixed-ULID id)' })
      continue
    }
    const base = baseline[index]
    if (base === undefined) {
      additions.push({ seqOnDisk: index, payload })
      continue
    }
    if (sha256Hex(payload) !== base.lineSha256) {
      changes.push({ seq: base.seq, baselineSha256: base.lineSha256, diskPayload: payload })
    }
  }
  for (const base of baseline.slice(lines.length)) {
    removals.push({ seq: base.seq, baselinePayload: base.payload })
  }

  return { kind: 'trackingStream', streamKind: kind, additions, changes, removals, invalidLines }
}

function summarizeProseChapter(request: ExtractRequest): ChangeSummary {
  try {
    const prose = readProseChapter(request.root, request.relPath)
    return {
      kind: 'proseChapter',
      mozhouId: prose.mozhouId,
      chapterIndex: prose.chapterIndex,
      phase: prose.phase,
      revision: prose.revision,
    }
  } catch {
    // 结构坏掉的正文：T3 分面已保守入面，这里只如实报告不可读
    return { kind: 'proseChapter', mozhouId: null, chapterIndex: null, phase: 'unreadable', revision: null }
  }
}

function summarizeStructured(
  request: ExtractRequest,
  context: ExtractContext,
  fileType: 'outlineNode' | 'planningArtifact' | 'bookRecord',
): ChangeSummary {
  if (fileType === 'bookRecord') {
    const row = context.db.prepare('SELECT id, title, revision FROM books LIMIT 1').get() as
      | { id: string; title: string; revision: number }
      | undefined
    let fresh: ReturnType<typeof readBookRecord> | null = null
    try {
      fresh = readBookRecord(request.root)
    } catch {
      fresh = null
    }
    const fieldDiffs: FieldDiff[] = []
    if (row !== undefined && fresh !== null) {
      if (row.title !== fresh.title) fieldDiffs.push({ field: 'title', before: row.title, after: fresh.title })
      if (row.revision !== fresh.revision) {
        fieldDiffs.push({ field: 'revision', before: row.revision, after: fresh.revision })
      }
    }
    return { kind: 'structuredFile', fileType, id: fresh?.id ?? row?.id ?? null, fieldDiffs, contentChanged: false }
  }

  const document = parseDocumentSafe(request.root, request.relPath)
  if (document === null) {
    return { kind: 'structuredFile', fileType, id: null, fieldDiffs: [], contentChanged: true }
  }
  const idRaw = document.data['mozhouId']
  const id = typeof idRaw === 'string' ? idRaw : null

  if (fileType === 'planningArtifact') {
    const row = context.db.prepare('SELECT revision FROM planning_artifacts WHERE id = ?').get(id ?? '') as
      | { revision: number }
      | undefined
    const fieldDiffs: FieldDiff[] = []
    const freshRevision = document.data['revision']
    if (row !== undefined && typeof freshRevision === 'number' && row.revision !== freshRevision) {
      fieldDiffs.push({ field: 'revision', before: row.revision, after: freshRevision })
    }
    return { kind: 'structuredFile', fileType, id, fieldDiffs, contentChanged: true }
  }

  // outlineNode：与投影行做全字段 diff（标题取正文 H1）
  const row = context.db
    .prepare(
      'SELECT node_type, parent_id, order_index, title, status, revision FROM outline_nodes WHERE id = ?',
    )
    .get(id ?? '') as
    | { node_type: string; parent_id: string | null; order_index: number; title: string; status: string; revision: number }
    | undefined
  if (row === undefined) {
    return { kind: 'structuredFile', fileType, id, fieldDiffs: [], contentChanged: true }
  }
  const fieldDiffs: FieldDiff[] = []
  const compare = (field: string, before: string | number | null, after: FrontmatterFieldValue | undefined): void => {
    const afterScalar = scalarOf(after ?? null)
    if (before !== afterScalar) {
      fieldDiffs.push({ field, before, after: afterScalar })
    }
  }
  compare('nodeType', row.node_type, document.data['nodeType'])
  compare('parentId', row.parent_id, document.data['parentId'])
  compare('orderIndex', row.order_index, document.data['orderIndex'])
  compare('status', row.status, document.data['status'])
  compare('revision', row.revision, document.data['revision'])
  const freshTitle = titleFromHeading(document.body)
  if (freshTitle !== null && freshTitle !== row.title) {
    fieldDiffs.push({ field: 'title', before: row.title, after: freshTitle })
  }
  return { kind: 'structuredFile', fileType, id, fieldDiffs, contentChanged: false }
}

function serializeAliasRules(rules: readonly { text: string; kind: string; caseSensitive?: boolean }[]): string {
  return JSON.stringify(
    rules.map((rule) =>
      rule.caseSensitive === undefined ? { text: rule.text, kind: rule.kind } : { text: rule.text, kind: rule.kind, caseSensitive: rule.caseSensitive },
    ),
  )
}

function summarizeEntityCard(request: ExtractRequest, context: ExtractContext): ChangeSummary {
  const cards = scanEntityCards(request.root)
  const card = cards.find((candidate) => candidate.fileRel === request.relPath)
  if (card === undefined) {
    throw new CanonStructureError(request.relPath, 'card file no longer parses as an entity card')
  }
  // 基线无册 ⇒ 全新卡（Q12 新增语义：整卡吸收提案，缺省档 detected）
  if (!(request.relPath in context.manifest.files)) {
    return { kind: 'newEntityCard', ref: card.ref, cardType: card.cardType, name: card.name }
  }
  const row = context.db.prepare('SELECT name, ai_context, brief FROM entity_cards WHERE ref = ?').get(card.ref) as
    | { name: string; ai_context: string; brief: string | null }
    | undefined
  if (row === undefined) {
    throw new CanonStructureError(request.relPath, `tracked card ${card.ref} has no projection row — run rebuildProjectionFromCanon`)
  }

  const fieldDiffs: FieldDiff[] = []
  if (row.name !== card.name) fieldDiffs.push({ field: 'name', before: row.name, after: card.name })
  if (row.ai_context !== card.aiContext) {
    fieldDiffs.push({ field: 'aiContext', before: row.ai_context, after: card.aiContext })
  }
  if ((row.brief ?? null) !== card.brief) {
    fieldDiffs.push({ field: 'brief', before: row.brief ?? null, after: card.brief })
  }
  const baselineAliases = (
    context.db
      .prepare('SELECT text, kind, case_sensitive AS caseSensitive FROM entity_alias_rules WHERE ref = ? ORDER BY ord')
      .all(card.ref) as { text: string; kind: string; caseSensitive: number }[]
  ).map((rule) => ({ text: rule.text, kind: rule.kind, caseSensitive: rule.caseSensitive !== 0 }))
  if (serializeAliasRules(baselineAliases) !== serializeAliasRules([...card.aliases])) {
    fieldDiffs.push({ field: 'aliases', before: serializeAliasRules(baselineAliases), after: serializeAliasRules([...card.aliases]) })
  }
  return { kind: 'entityCard', ref: card.ref, fieldDiffs }
}

function summarizeOpaque(request: ExtractRequest): ChangeSummary {
  let bytesAfter: number
  try {
    bytesAfter = statSync(join(request.root, request.relPath)).size
  } catch (error) {
    throw new ReconciliationError(`opaque file unreadable at ${request.relPath}: ${(error as Error).message}`)
  }
  return { kind: 'opaqueFile', bytesBefore: bytesAfter, bytesAfter }
}

/** 缺省提取器：纯函数，运行时依赖经 context 显式传入（无隐藏状态）。 */
export function buildDefaultExtractor(): Extractor {
  return (request, context) => {
    // 盘上已消失 ⇒ 删除确认提案（Q12：物理删需显式确认；历史在 append-only 账本）
    try {
      statSync(join(request.root, request.relPath))
    } catch {
      if (request.relPath in context.manifest.files) {
        return { kind: 'fileDeleted', fileType: classifyReconciliationPath(request.relPath) }
      }
      throw new ReconciliationError(`file missing and not in baseline: ${request.relPath}`)
    }
    switch (classifyReconciliationPath(request.relPath)) {
      case 'proseChapter':
        return summarizeProseChapter(request)
      case 'trackingStream':
        return summarizeTrackingStream(request, context, trackingKindOf(request.relPath))
      case 'outlineNode':
        return summarizeStructured(request, context, 'outlineNode')
      case 'planningArtifact':
        return summarizeStructured(request, context, 'planningArtifact')
      case 'bookRecord':
        return summarizeStructured(request, context, 'bookRecord')
      case 'entityCard':
        return summarizeEntityCard(request, context)
      case 'other':
        return summarizeOpaque(request)
    }
  }
}

/* ----------------------------------------------------------------------------
 * 条目命名与抑制账本
 * ------------------------------------------------------------------------- */

/** 作者门条目命名：整文件类恒 `whole`；追踪流 `change:<seq>` / `add:<seqOnDisk>` / `remove:<seq>`。 */
function itemIdsOf(summary: ChangeSummary): Set<string> {
  const ids = new Set<string>(['whole'])
  if (summary.kind === 'trackingStream') {
    for (const change of summary.changes) ids.add(`change:${change.seq}`)
    for (const addition of summary.additions) ids.add(`add:${addition.seqOnDisk}`)
    for (const removal of summary.removals) ids.add(`remove:${removal.seq}`)
  }
  return ids
}

function rejectedLedgerOf(
  summary: ChangeSummary,
  accepted: ReadonlySet<string>,
): Pick<ReconciliationProposal, 'rejectedLineChanges' | 'rejectedLineAdditions'> {
  if (summary.kind !== 'trackingStream') {
    return { rejectedLineChanges: [], rejectedLineAdditions: [] }
  }
  return {
    rejectedLineChanges: summary.changes
      .filter((change) => !accepted.has(`change:${change.seq}`))
      .map((change) => ({ baselineSha256: change.baselineSha256, diskPayload: change.diskPayload })),
    rejectedLineAdditions: summary.additions
      .filter((addition) => !accepted.has(`add:${addition.seqOnDisk}`))
      .map((addition) => addition.payload),
  }
}

/* ----------------------------------------------------------------------------
 * ReconciliationService：五态状态机 + watcher
 * ------------------------------------------------------------------------- */

export interface ReconciliationOptions {
  /** 替换缺省确定性提取器（LLM 语义提取注入点 / 测试故障注入口）。 */
  readonly extract?: Extractor | undefined
}

export interface WatcherOptions {
  /** 轮询间隔毫秒（mtime 预筛粒度）。缺省 2000。 */
  readonly intervalMs?: number | undefined
}

const WATCHER_DEFAULT_INTERVAL_MS = 2000
const OPEN_STATES: readonly ReconciliationState[] = ['detected', 'extracting', 'awaiting_author', 'extract_failed']

interface MtimeFingerprint {
  readonly mtimeMs: number
  readonly size: number
}

export class ReconciliationService {
  private readonly extract: Extractor
  private watcherTimer: ReturnType<typeof setTimeout> | null = null
  private watcherStopped = true
  private lastMtimeSnapshot: ReadonlyMap<string, MtimeFingerprint> | null = null

  constructor(private readonly host: ReconciliationHost, options: ReconciliationOptions = {}) {
    this.extract = options.extract ?? buildDefaultExtractor()
  }

  /* ---------------- 检出面 ---------------- */

  /** 启动必检入口（Q4）：应用壳在 LocalDataPlane.open 后立即调用一次。 */
  scanExternalModifications(trigger: ReconciliationTrigger = 'startupScan'): ScanOutcome {
    return this.intakeFromBaseline(trigger)
  }

  /** watcher 手动一拍：跳过 mtime 预筛直接 SHA-256 全量复核（测试与精确控制用）。 */
  pollOnce(): ScanOutcome {
    return this.intakeFromBaseline('watcher')
  }

  /** 运行期 watcher：mtime 预筛命中才进入复核；快照在启动时立基，此后周期比对。 */
  startWatcher(options: WatcherOptions = {}): void {
    this.watcherStopped = false
    this.lastMtimeSnapshot = this.walkMtimeSnapshot()
    const intervalMs = options.intervalMs ?? WATCHER_DEFAULT_INTERVAL_MS
    const tick = (): void => {
      if (this.watcherStopped) return
      try {
        if (this.mtimeDriftDetected()) {
          this.intakeFromBaseline('watcher')
        }
      } finally {
        if (!this.watcherStopped) {
          this.watcherTimer = setTimeout(tick, intervalMs)
        }
      }
    }
    this.watcherTimer = setTimeout(tick, intervalMs)
  }

  stopWatcher(): void {
    this.watcherStopped = true
    if (this.watcherTimer !== null) {
      clearTimeout(this.watcherTimer)
      this.watcherTimer = null
    }
  }

  private mtimeDriftDetected(): boolean {
    const previous = this.lastMtimeSnapshot
    const current = this.walkMtimeSnapshot()
    this.lastMtimeSnapshot = current
    if (previous === null) return false
    if (previous.size !== current.size) return true
    for (const [rel, fingerprint] of current) {
      const prior = previous.get(rel)
      if (prior === undefined || prior.mtimeMs !== fingerprint.mtimeMs || prior.size !== fingerprint.size) {
        return true
      }
    }
    return false
  }

  private walkMtimeSnapshot(): ReadonlyMap<string, MtimeFingerprint> {
    const snapshot = new Map<string, MtimeFingerprint>()
    for (const rel of listAllFiles(this.host.root)) {
      if (!isCanonRelPath(rel)) continue
      try {
        const stat = statSync(join(this.host.root, rel))
        snapshot.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size })
      } catch {
        // 盘上消失也是漂移信号：NaN 哨兵（NaN !== NaN 恒真 ⇒ 必判漂移）
        snapshot.set(rel, { mtimeMs: Number.NaN, size: Number.NaN })
      }
    }
    return snapshot
  }

  private intakeFromBaseline(trigger: ReconciliationTrigger): ScanOutcome {
    const report = this.host.verifyBaseline()
    const proposed: ReconciliationProposal[] = []

    for (const rel of report.untracked) {
      proposed.push(...this.intake(rel, trigger))
    }
    for (const rel of report.reconcileSurface) {
      proposed.push(...this.intake(rel, trigger))
    }

    // 盘上已回退到基线的未决提案自动收口（无可对账之物）
    for (const open of this.listOpenProposals()) {
      if (open.state !== 'awaiting_author' || open.diskSha256 === null) continue
      const entry = this.host.manifest.files[open.relPath]
      if (
        entry !== undefined &&
        entry.sha256 === open.diskSha256 &&
        !report.modified.includes(open.relPath) &&
        !report.untracked.includes(open.relPath)
      ) {
        this.persistProposal({ ...open, state: 'dismissed', resolvedAt: nowIso(), resolution: 'dismissed' })
      }
    }

    return { proposed, draftsExempted: report.draftFreeEdits }
  }

  /** preWriteReferral 入口：S3 写前校验抛错后由调用方转介指定路径。 */
  intakePaths(relPaths: readonly string[], trigger: ReconciliationTrigger = 'preWriteReferral'): ScanOutcome {
    const proposed: ReconciliationProposal[] = []
    for (const rel of relPaths) {
      if (!isCanonRelPath(rel)) continue
      proposed.push(...this.intake(rel, trigger))
    }
    return { proposed, draftsExempted: [] }
  }

  /* ---------------- 提案仓（.mozhou/reconciliations/*.json） ---------------- */

  private proposalPath(proposalId: string): string {
    return join(this.host.root, RUNTIME_RECONCILIATIONS_DIR, `${proposalId}.json`)
  }

  private persistProposal(proposal: ReconciliationProposal): void {
    mkdirSync(join(this.host.root, RUNTIME_RECONCILIATIONS_DIR), { recursive: true })
    const target = this.proposalPath(proposal.proposalId)
    const tmp = `${target}.tmp`
    writeFileSync(tmp, `${JSON.stringify(proposal, null, 2)}\n`)
    renameSync(tmp, target)
  }

  private loadProposal(proposalId: string): ReconciliationProposal | null {
    try {
      return JSON.parse(readFileSync(this.proposalPath(proposalId), 'utf8')) as ReconciliationProposal
    } catch {
      return null
    }
  }

  listProposals(): ReconciliationProposal[] {
    let names: string[]
    try {
      names = readdirSync(join(this.host.root, RUNTIME_RECONCILIATIONS_DIR))
    } catch {
      return []
    }
    const loaded: ReconciliationProposal[] = []
    for (const name of names.filter((candidate) => candidate.endsWith('.json'))) {
      const proposal = this.loadProposal(name.replace(/\.json$/, ''))
      if (proposal !== null) loaded.push(proposal)
    }
    return loaded.sort((a, b) => (a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : 0))
  }

  listOpenProposals(): ReconciliationProposal[] {
    return this.listProposals().filter((proposal) => OPEN_STATES.includes(proposal.state))
  }

  getProposal(proposalId: string): ReconciliationProposal | null {
    return this.loadProposal(proposalId)
  }

  /* ---------------- 状态机 ---------------- */

  private intake(rel: string, trigger: ReconciliationTrigger): ReconciliationProposal[] {
    let diskSha: string | null = null
    let diskBytes: number | null = null
    try {
      const stat = statSync(join(this.host.root, rel))
      diskBytes = stat.size
      diskSha = sha256FileHex(join(this.host.root, rel))
    } catch {
      diskSha = null
      diskBytes = null
    }

    const existing = this.listOpenProposals().find((proposal) => proposal.relPath === rel)
    if (existing !== undefined) {
      if (diskSha !== null && diskSha === existing.diskSha256) {
        return [] // 已捕获且盘上未再动：不打扰
      }
      // 同路径二次外部编辑：原提案内刷新摘要（保留 id 与 detectedAt）
      this.persistProposal(this.runExtraction({ ...existing, diskSha256: diskSha, diskBytes }))
      return []
    }

    const entry = this.host.manifest.files[rel]
    const created: ReconciliationProposal = {
      proposalVersion: 1,
      proposalId: `rcln_${newUlid()}`,
      relPath: rel,
      state: 'detected',
      triggerSource: trigger,
      detectedAt: nowIso(),
      baselineSha256: entry?.sha256 ?? '',
      baselineBytes: entry?.bytes ?? 0,
      diskSha256: diskSha,
      diskBytes: diskBytes,
      summary: null,
      extractErrorDetail: null,
      resolvedAt: null,
      resolution: null,
      rejectedLineChanges: [],
      rejectedLineAdditions: [],
    }
    const extracted = this.runExtraction(created)
    this.emitEvent('ReconciliationProposed', {
      proposalId: extracted.proposalId,
      relPath: rel,
      triggerSource: trigger,
      summaryKind: extracted.summary?.kind ?? null,
    })
    this.persistProposal(extracted)
    return [extracted]
  }

  private runExtraction(base: ReconciliationProposal): ReconciliationProposal {
    const extracting: ReconciliationProposal = { ...base, state: 'extracting', extractErrorDetail: null }
    try {
      const rawSummary = this.extract(
        { root: this.host.root, relPath: base.relPath },
        { root: this.host.root, db: this.host.db, manifest: this.host.manifest },
      )
      const summary = this.suppressAlreadyRejected(base.relPath, rawSummary)
      return { ...extracting, state: 'awaiting_author', summary, extractErrorDetail: null }
    } catch (error) {
      return {
        ...extracting,
        state: 'extract_failed',
        summary: null,
        extractErrorDetail: (error as Error).message,
      }
    }
  }

  /** 抑制账本：同路径终态提案里已被拒过的差异对不再重复上报（Q12 关键语义的续章）。 */
  private suppressAlreadyRejected(relPath: string, summary: ChangeSummary): ChangeSummary {
    if (summary.kind !== 'trackingStream') return summary
    const ledgers = this.listProposals().filter(
      (proposal) => proposal.relPath === relPath && proposal.resolvedAt !== null,
    )
    if (ledgers.length === 0) return summary
    const rejectedPairs = new Set(
      ledgers.flatMap((proposal) =>
        proposal.rejectedLineChanges.map((pair) => `${pair.baselineSha256}\u0000${pair.diskPayload}`),
      ),
    )
    const rejectedAdditions = new Set(ledgers.flatMap((proposal) => [...proposal.rejectedLineAdditions]))
    return {
      ...summary,
      changes: summary.changes.filter(
        (change) => !rejectedPairs.has(`${change.baselineSha256}\u0000${change.diskPayload}`),
      ),
      additions: summary.additions.filter((addition) => !rejectedAdditions.has(addition.payload)),
    }
  }

  retryExtraction(proposalId: string): ReconciliationProposal {
    const proposal = this.requireOpen(proposalId)
    if (proposal.state !== 'extract_failed') {
      throw new ReconciliationError(`retryExtraction requires extract_failed, got ${proposal.state} (${proposalId})`)
    }
    const retried = this.runExtraction(proposal)
    this.persistProposal(retried)
    return retried
  }

  dismiss(proposalId: string): ReconciliationProposal {
    const proposal = this.requireOpen(proposalId)
    const ledger =
      proposal.summary === null
        ? { rejectedLineChanges: [], rejectedLineAdditions: [] }
        : rejectedLedgerOf(proposal.summary, new Set())
    return this.finalize(
      proposal,
      {
        ...proposal,
        state: 'dismissed',
        resolution: 'dismissed',
        resolvedAt: nowIso(),
        ...ledger,
      },
      'dismissed',
      0,
    )
  }

  /**
   * 作者门：acceptedItemIds 之外的可见条目一律视为拒绝。
   * 全接受 ⇒ applied；混合 ⇒ partially_applied；全拒 ⇒ dismissed（作者否决升格）。
   */
  decideItems(proposalId: string, acceptedItemIds: readonly string[]): ReconciliationProposal {
    const proposal = this.requireOpen(proposalId)
    if (proposal.state !== 'awaiting_author' || proposal.summary === null) {
      throw new ReconciliationError(
        `decideItems requires awaiting_author with a summary, got ${proposal.state} (${proposalId})`,
      )
    }
    const known = itemIdsOf(proposal.summary)
    const accepted = new Set(acceptedItemIds)
    for (const itemId of accepted) {
      if (!known.has(itemId)) {
        const knownList = [...known].join(', ')
        throw new ReconciliationError(`unknown item '${itemId}' for ${proposalId}; known items: ${knownList}`)
      }
    }

    this.applyAcceptedItems(proposal.relPath, proposal.summary, accepted)

    const resolution: ResolutionKind =
      accepted.size === known.size ? 'applied' : accepted.size === 0 ? 'dismissed' : 'partially_applied'
    return this.finalize(
      proposal,
      {
        ...proposal,
        state: resolution,
        resolution,
        resolvedAt: nowIso(),
        ...rejectedLedgerOf(proposal.summary, accepted),
      },
      resolution,
      accepted.size,
    )
  }

  /** 终态落库三连：提案持久化 + 基线吸收盘上现状（S4：无论取舍）+ 审计事件。 */
  private finalize(
    _original: ReconciliationProposal,
    terminal: ReconciliationProposal,
    resolution: ResolutionKind,
    acceptedCount: number,
  ): ReconciliationProposal {
    this.persistProposal(terminal)
    this.syncBaselineForPath(terminal.relPath)
    this.emitEvent('ReconciliationResolved', {
      proposalId: terminal.proposalId,
      relPath: terminal.relPath,
      resolution,
      acceptedItemCount: acceptedCount,
    })
    return terminal
  }

  private requireOpen(proposalId: string): ReconciliationProposal {
    const proposal = this.loadProposal(proposalId)
    if (proposal === null || proposal.resolvedAt !== null) {
      throw new ReconciliationError(`no open proposal for id ${proposalId}`)
    }
    return proposal
  }

  /** S4 基线纪律：按盘上现状吸收该路径（存在→刷新指纹；消失→移除键）。 */
  private syncBaselineForPath(rel: string): void {
    const next = refreshManifestEntries(this.host.manifest, this.host.root, [rel])
    writeManifest(this.host.root, next)
    this.host.reloadManifest()
  }

  /* ---------------- 应用：接受项落投影（canon 永不回写） ---------------- */

  private applyAcceptedItems(relPath: string, summary: ChangeSummary, accepted: ReadonlySet<string>): void {
    switch (summary.kind) {
      case 'trackingStream':
        this.applyTrackingStream(relPath, summary, accepted)
        return
      case 'proseChapter':
      case 'opaqueFile':
        return // 不入投影表：正文与人读工件的一致性由基线承载
      case 'fileDeleted':
        this.purgeRowsForDeletedFile(relPath, summary.fileType)
        return
      case 'structuredFile':
      case 'entityCard':
      case 'newEntityCard':
        if (accepted.has('whole')) this.applyStructuredUpsert(relPath, summary)
        return
    }
  }

  private applyStructuredUpsert(
    relPath: string,
    summary: Extract<ChangeSummary, { kind: 'structuredFile' | 'entityCard' | 'newEntityCard' }>,
  ): void {
    const db = this.host.db

    if (summary.kind === 'entityCard' || summary.kind === 'newEntityCard') {
      const card = scanEntityCards(this.host.root).find((candidate) => candidate.ref === summary.ref)
      if (card === undefined) {
        throw new CanonStructureError(relPath, `card for ${summary.ref} unresolvable at apply time`)
      }
      syncEntityCardRows(db, card)
      return
    }

    if (summary.fileType === 'bookRecord') {
      const book = readBookRecord(this.host.root)
      db.prepare('UPDATE books SET title = ?, revision = ?, created_at = ?, updated_at = ? WHERE id = ?').run(
        book.title,
        book.revision,
        book.createdAt,
        book.updatedAt,
        book.id,
      )
      return
    }

    const document = parseDocumentSafe(this.host.root, relPath)
    if (document === null) {
      throw new CanonStructureError(relPath, 'structured file unreadable at apply time')
    }
    const freshId = typeof document.data['mozhouId'] === 'string' ? document.data['mozhouId'] : null
    if (freshId === null) {
      throw new CanonStructureError(relPath, 'structured file lost its mozhouId at apply time')
    }

    if (summary.fileType === 'outlineNode') {
      // 身份漂移（外部改动动了 mozhouId）⇒ 旧行清除后按新身份落行
      if (summary.id !== null && summary.id !== freshId) {
        db.prepare('DELETE FROM outline_nodes WHERE id = ?').run(summary.id)
      }
      const parentIdValue = document.data['parentId']
      const orderIndex = document.data['orderIndex']
      const revision = document.data['revision']
      const nodeTypeValue = document.data['nodeType']
      const statusValue = document.data['status']
      db.prepare(
        `INSERT INTO outline_nodes (id, node_type, parent_id, order_index, title, status, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET node_type = excluded.node_type, parent_id = excluded.parent_id,
           order_index = excluded.order_index, title = excluded.title, status = excluded.status, revision = excluded.revision`,
      ).run(
        freshId,
        typeof nodeTypeValue === 'string' ? nodeTypeValue : '',
        parentIdValue === null || parentIdValue === undefined ? null : typeof parentIdValue === 'string' ? parentIdValue : JSON.stringify(parentIdValue),
        typeof orderIndex === 'number' ? orderIndex : 0,
        titleFromHeading(document.body) ?? '',
        typeof statusValue === 'string' ? statusValue : '',
        typeof revision === 'number' ? revision : 0,
      )
      return
    }

    // planningArtifact：revision 锚 + 全文件内容摘要
    const raw = readFileSync(join(this.host.root, relPath))
    if (summary.id !== null && summary.id !== freshId) {
      db.prepare('DELETE FROM planning_artifacts WHERE id = ?').run(summary.id)
    }
    const freshRevision = document.data['revision']
    db.prepare(
      `INSERT INTO planning_artifacts (id, kind, revision, content_sha256) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, content_sha256 = excluded.content_sha256`,
    ).run(
      freshId,
      document.data['kind'] === 'authorIntent' ? 'authorIntent' : 'styleProfile',
      typeof freshRevision === 'number' ? freshRevision : 0,
      sha256Hex(raw),
    )
  }

  /**
   * Q12 应用语义：追踪流投影最终镜像 = 盘上行按取舍过滤后的确定性重排。
   * 单事务整流重写（DELETE + 重插压缩 seq），接受全部时与重建灌入逐字节同构。
   */
  private applyTrackingStream(
    relPath: string,
    summary: Extract<ChangeSummary, { kind: 'trackingStream' }>,
    accepted: ReadonlySet<string>,
  ): void {
    const raw = readFileSync(join(this.host.root, relPath), 'utf8')
    const diskLinesAll = diskLines(raw)
    const baseline = baselineTrackingRows(this.host.db, summary.streamKind)

    const finalPayloads: string[] = []

    for (const [index, payload] of diskLinesAll.entries()) {
      const base = baseline[index]
      if (base === undefined) {
        if (accepted.has(`add:${index}`)) {
          finalPayloads.push(payload)
        }
        continue
      }
      if (sha256Hex(payload) === base.lineSha256) {
        finalPayloads.push(base.payload)
        continue
      }
      // 修改行：接受 ⇒ 盘上新版；拒绝 ⇒ 保持基线旧版
      finalPayloads.push(accepted.has(`change:${base.seq}`) ? payload : base.payload)
    }
    for (const base of baseline.slice(diskLinesAll.length)) {
      // 删除行：接受确认 ⇒ 物理移除；拒绝 ⇒ 基线行保留在投影
      if (!accepted.has(`remove:${base.seq}`)) {
        finalPayloads.push(base.payload)
      }
    }

    const insert = this.host.db.prepare(
      'INSERT INTO tracking_lines (kind, seq, line_sha256, payload) VALUES (?, ?, ?, ?)',
    )
    this.host.db.transaction(() => {
      this.host.db.prepare('DELETE FROM tracking_lines WHERE kind = ?').run(summary.streamKind)
      finalPayloads.forEach((payload, seq) => {
        insert.run(summary.streamKind, seq, sha256Hex(payload), payload)
      })
    })()
  }

  /** 删除确认：按类别清除投影行；身份不可从路径反解的类别宁败不脏。 */
  private purgeRowsForDeletedFile(relPath: string, fileType: ReconciliationPathClass): void {
    const db = this.host.db
    switch (fileType) {
      case 'entityCard':
        db.transaction(() => {
          db.prepare('DELETE FROM entity_alias_rules WHERE ref IN (SELECT ref FROM entity_cards WHERE file_rel = ?)').run(relPath)
          db.prepare('DELETE FROM entity_excluded_phrases WHERE ref IN (SELECT ref FROM entity_cards WHERE file_rel = ?)').run(relPath)
          db.prepare('DELETE FROM entity_cards WHERE file_rel = ?').run(relPath)
        })()
        return
      case 'trackingStream':
        db.prepare('DELETE FROM tracking_lines WHERE kind = ?').run(trackingKindOf(relPath))
        return
      case 'planningArtifact':
        // 工件无路径列，但 kind 与冻结路径一一对应
        db.prepare('DELETE FROM planning_artifacts WHERE kind = ?').run(
          relPath === AUTHOR_INTENT_PATH ? 'authorIntent' : 'styleProfile',
        )
        return
      case 'outlineNode':
        if (relPath === ZONGGANG_PATH) {
          db.prepare("DELETE FROM outline_nodes WHERE node_type = 'book'").run()
          return
        }
        if (relPath === VOLUME_ONE_OUTLINE_PATH) {
          db.prepare("DELETE FROM outline_nodes WHERE node_type = 'volume'").run()
          return
        }
        throw new ReconciliationError(
          `deleted chapter-outline ${relPath} cannot be mapped back to a mozhouId from the path alone — run rebuildProjectionFromCanon`,
        )
      case 'bookRecord':
        throw new ReconciliationError('refusing to purge the book record row — rebuild the projection instead')
      case 'proseChapter':
      case 'other':
        return // 无投影行
    }
  }

  private emitEvent(type: string, fields: Record<string, unknown>): void {
    const eventsAbsolute = join(this.host.root, RUNTIME_EVENTS_PATH)
    const seq = diskLines(readFileSync(eventsAbsolute, 'utf8')).length
    appendFileSync(eventsAbsolute, `${JSON.stringify({ type, seq, at: nowIso(), ...fields })}\n`)
  }
}

function nowIso(): string {
  return new Date().toISOString()
}
