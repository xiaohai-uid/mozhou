/**
 * C2 候选契约（T03）——未经 Accept 的生成只写候选区，正文/revision/hash 零变化（I01）。
 *
 * 领域职责（包层）：
 * - DraftCandidate 唯一领域定义 + 纯文件持久化（<书>/.mozhou/candidates/<服务端生成id>.json）。
 * - 这是需恢复/备份的候选记录，不是可随重建删除的投影缓存。
 * - 客户端和模型不能指定文件路径；id 只接受服务端生成的 UUID 格式。
 * - WriteBase 唯一领域定义（C1）：revision + sha256 原文指纹，供 CAS 比对。
 * - owner/权限裁决在 HTTP 层（bookAccess），本模块不含权限。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@mozhou/data-plane'

/**
 * @deprecated W4-2b：单一枚举把三件正交的事混在一起（规划 §6.5 警告的正是这种混用）。
 * 现在它只是**派生兼容视图**（由三字段算出，供未迁移的读方使用），不再是真源。
 */
export type CandidateStatus = 'streaming' | 'partial' | 'ready' | 'accepted' | 'cancelled' | 'failed'

/** W4-2b：内容维度——文本到什么程度。 */
export type ContentState = 'streaming' | 'partial' | 'complete'

/** W4-2b：任务维度——这次生成任务怎么了。 */
export type TaskState = 'running' | 'cancel_requested' | 'cancelled' | 'failed' | 'succeeded'

/** W4-2b：正典维度——是否已被采纳。 */
export type CanonState = 'unaccepted' | 'accepted'

/**
 * 候选记录格式版本。1 = 单一 status（legacy，**只读迁移**）；2 = 三字段正交（当前写端）。
 * 未知版本**拒写而非猜测**（读路径先读后写，读失败即写不发生）。
 */
export const CANDIDATE_SCHEMA_VERSION = 2

/**
 * 合法组合表（白名单，fail-closed）：不在表内的组合一律 CANDIDATE_STATE_INVALID。
 *
 * 关键几格：
 * - `partial + succeeded + unaccepted`：旧 partial 的有损迁移落点——**绝不被自动采纳**（采纳需显式确认）。
 * - `partial + succeeded + accepted`：**confirmPartial** 显式确认后的合法组合（内容不完整但作者已确认采纳）。
 * - `complete + cancelled` **不在表内**：按判定点规则，上游已完成 ⇒ 任务就是 succeeded，
 *   「完成却 cancelled」是矛盾态，构造即拒绝。
 */
const LEGAL_COMBINATIONS: ReadonlySet<string> = new Set([
  'streaming|running|unaccepted',
  'streaming|cancel_requested|unaccepted',
  'partial|running|unaccepted',
  'partial|cancel_requested|unaccepted',
  'partial|succeeded|unaccepted',
  'partial|cancelled|unaccepted',
  'partial|failed|unaccepted',
  'partial|succeeded|accepted',
  'complete|succeeded|unaccepted',
  'complete|succeeded|accepted',
  'complete|failed|unaccepted',
])

/** 组合合法性（白名单）。非法组合抛 CANDIDATE_STATE_INVALID，绝不静默写入。 */
export function assertCandidateStateCombination(
  contentState: ContentState,
  taskState: TaskState,
  canonState: CanonState,
): void {
  if (!LEGAL_COMBINATIONS.has(`${contentState}|${taskState}|${canonState}`)) {
    throw new CandidateError(
      'CANDIDATE_STATE_INVALID',
      `CANDIDATE_STATE_INVALID: illegal combination contentState=${contentState} taskState=${taskState} canonState=${canonState}`,
    )
  }
}

/**
 * 派生兼容视图（旧 status）。优先级即语义：正典 > 任务终态 > 内容进度。
 * 存在意义：未迁移的读方（含既有测试）继续按旧枚举工作，而真源只有三字段。
 */
export function deriveCandidateStatus(
  contentState: ContentState,
  taskState: TaskState,
  canonState: CanonState,
): CandidateStatus {
  if (canonState === 'accepted') return 'accepted'
  if (taskState === 'cancelled') return 'cancelled'
  if (taskState === 'failed') return 'failed'
  if (contentState === 'streaming') return 'streaming'
  if (contentState === 'partial') return 'partial'
  return 'ready'
}

export type CandidateMode = 'replace' | 'continue' | 'insert' | 'replace-selection'

/** C1：写入基（revision + 原文 sha256），唯一领域定义在此。 */
export interface WriteBase {
  readonly revision: number
  readonly sha256: string
}

export interface DraftCandidate {
  readonly schemaVersion: 1 | 2
  readonly id: string
  /**
   * W4-2a 重命名：候选侧生成标识（原 operationId）。
   *
   * 与 W3 **写入操作身份** operationId 是**不同概念**：候选侧由服务端构造（值形如 op_web_<uuid>），
   * 客户端生成的写入操作身份落 .mozhou/operations/<sha256> 且作用域四元组含 principalId/bookId。
   * 两者语义/生命周期/去重口径都不同，同名会让『查不到』静默发生，故此处改名。
   *
   * 值仍是历史形态（保留 op_web_ 前缀），但**任何判定都不得依赖该前缀**——它是不透明标识。
   */
  readonly generationId: string
  readonly bookId: string
  readonly chapterIndex: number
  /** 生成开始时的章版本现场；accept 时与盘上 CAS 比对。 */
  readonly base: WriteBase
  readonly mode: CandidateMode
  readonly text: string
  /** W4-2b 真源：三字段正交（内容 / 任务 / 正典）。 */
  readonly contentState: ContentState
  readonly taskState: TaskState
  readonly canonState: CanonState
  /** 客户端视图切换代次；迟到 chunk 的丢弃判据之一。 */
  readonly generationEpoch: number
  /** 单任务内序号（最后写入的 chunk 序号）；迟到 chunk 的丢弃判据之二。 */
  readonly lastSequence: number
  /**
   * **有损迁移注记**：仅当记录由旧版单一 status 在**内存中**迁移而来时出现。
   * 丢失的信息见 `lost`。读旧**不写回**，故它不会出现在盘上（下次真实写入才会落 v2）。
   */
  readonly migratedFrom?: { readonly status: CandidateStatus; readonly lossy: true; readonly lost: string }
  /**
   * @deprecated 派生兼容视图（由三字段算出）；**不是真源**，不得据此做采纳判定。
   * 保留是为了让未迁移的读方（含既有测试）继续工作。
   */
  readonly status: CandidateStatus
  /** insert/replace-selection 在生成开始时的选区；selectedTextHash 与 base.sha256 同纪律。 */
  readonly selection?: { readonly from: number; readonly to: number; readonly selectedTextHash: string }
  /** accepted 后记录落地 revision。 */
  readonly acceptedRevision?: number
  /** 半稿采纳审计：当且仅当确认半稿采纳时记录 confirmPartial: true。 */
  readonly confirmPartial?: boolean
}

export interface DraftCandidateRequest {
  readonly id: string
  /** W4-2a：新名（推荐）。 */
  readonly generationId?: string | undefined
  /**
   * @deprecated W4-2a 之前的旧名。**保留为可选输入别名**：7 个既有测试文件在构造候选时仍传它，
   * 兼容别名是正确做法（不得为改名去改既有测试）。读端认旧名，**写端只写 generationId**。
   */
  readonly operationId?: string | undefined
  readonly bookId: string
  readonly chapterIndex: number
  readonly base: WriteBase
  readonly mode: CandidateMode
  readonly selection?: { readonly from: number; readonly to: number; readonly selectedTextHash: string }
  /** continue 续写基底：断流半稿（旧候选文本）作为新候选初始文本；非 continue 模式携带即拒绝。 */
  readonly seedText?: string
}

export class CandidateError extends Error {
  override readonly name = 'CandidateError'
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export const CANDIDATE_DIR = '.mozhou/candidates'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256_RE = /^[0-9a-f]{64}$/

/** id 只接受服务端生成的 UUID 格式（读写路径穿越在此一并拒绝）。 */
export function isServerGeneratedCandidateId(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * 解析候选生成标识：优先新名，回落 deprecated 旧名；两者皆缺即拒绝（绝不静默造值）。
 * 读端兼容旧名、写端只写新名——这是 W4-2a 的单一入口，避免两处各写一遍再漂移。
 */
export function resolveCandidateGenerationId(
  source: Pick<DraftCandidateRequest, 'generationId' | 'operationId'>,
): string {
  const value = source.generationId ?? source.operationId
  if (typeof value !== 'string' || value.length === 0) {
    throw new CandidateError(
      'INVALID_GENERATION_ID',
      'INVALID_GENERATION_ID: generationId is required (deprecated alias operationId also accepted)',
    )
  }
  return value
}

/** 服务端生成候选 id。 */
export function createCandidateId(): string {
  return randomUUID()
}

/** 候选文件相对路径（先格式校验，杜绝路径穿越）。 */
export function candidateRelPath(id: string): string {
  if (!isServerGeneratedCandidateId(id)) throw new CandidateError('INVALID_CANDIDATE_ID', `INVALID_CANDIDATE_ID: candidate id must be server-generated UUID: ${id}`)
  return `${CANDIDATE_DIR}/${id}.json`
}

const CANDIDATE_TERMINAL_MSG = 'candidate is in terminal state; append/finish/cancel rejected'

export const CANDIDATE_TERMINAL = 'CANDIDATE_TERMINAL'

function assertBase(base: WriteBase): void {
  if (!Number.isInteger(base.revision) || base.revision < 0) {
    throw new CandidateError('INVALID_BASE', `INVALID_BASE: invalid base.revision: ${base.revision}`)
  }
  if (!SHA256_RE.test(base.sha256)) {
    throw new CandidateError('INVALID_BASE', 'INVALID_BASE: base.sha256 must be 64 hex chars')
  }
}

function assertSelection(selection: DraftCandidate['selection']): void {
  if (selection === undefined) return
  const { from, to, selectedTextHash } = selection
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new CandidateError('INVALID_SELECTION', `INVALID_SELECTION: invalid selection range [${from},${to})`)
  }
  if (!SHA256_RE.test(selectedTextHash)) {
    throw new CandidateError('INVALID_SELECTION', 'INVALID_SELECTION: selectedTextHash must be 64 hex chars')
  }
}

const MODES: ReadonlySet<string> = new Set(['replace', 'continue', 'insert', 'replace-selection'])

function assertMode(mode: CandidateMode): void {
  if (!MODES.has(mode)) throw new CandidateError('INVALID_MODE', `INVALID_MODE: unknown candidate mode: ${String(mode)}`)
}

/** 创建候选（终态校验通过才落盘）；同 id 重复创建拒绝。 */
export function createDraftCandidate(root: string, request: DraftCandidateRequest): DraftCandidate {
  assertBase(request.base)
  assertMode(request.mode)
  assertSelection(request.selection)
  if (request.seedText !== undefined && request.mode !== 'continue') {
    throw new CandidateError('INVALID_SEED', 'INVALID_SEED: seedText only allowed for continue mode')
  }
  if (request.mode === 'replace-selection' && request.selection === undefined) {
    throw new CandidateError('INVALID_SELECTION', 'INVALID_SELECTION: replace-selection requires selection')
  }
  const payload: DraftCandidate = {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    id: request.id,
    generationId: resolveCandidateGenerationId(request),
    bookId: request.bookId,
    chapterIndex: request.chapterIndex,
    base: request.base,
    mode: request.mode,
    text: request.seedText ?? '',
    contentState: 'streaming',
    taskState: 'running',
    canonState: 'unaccepted',
    generationEpoch: 0,
    lastSequence: 0,
    status: 'streaming',
    ...(request.selection === undefined ? {} : { selection: request.selection }),
  }
  const path = join(root, candidateRelPath(request.id))
  if (existsSync(path)) {
    throw new CandidateError('CANDIDATE_EXISTS', `CANDIDATE_EXISTS: candidate ${request.id} already exists`)
  }
  mkdirSync(join(root, CANDIDATE_DIR), { recursive: true })
  // 原子写：创建路径此前漏改（同文件的更新路径 :399 已是原子写）。撕裂记录会让
  // readDraftCandidate 的 JSON.parse 抛错，进而 listDraftCandidates 整表失败（整章 500）。
  atomicWriteFileSync(path, JSON.stringify(payload, null, 2) + '\n')
  return payload
}

/** 读候选；未知 id 返回 null（404 语义）。 */
export function readDraftCandidate(root: string, id: string): DraftCandidate | null {
  const path = join(root, candidateRelPath(id))
  if (!existsSync(path)) return null
  return normalizeCandidateRecord(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
}

/**
 * 旧单一枚举 → 三字段的映射表。
 *
 * **有损迁移（显式声明）**：旧 `partial` 无法区分「正常不完整」与「取消后残留」——
 * 两者在旧格式里是同一个值。迁移一律映射 `taskState='succeeded'`（保守：不把未知的取消
 * 误报成已取消，也不把它误报成失败），并写 `migratedFrom` 注记说明**丢失了取消意图**。
 * 旧 `failed` 同理无法区分「失败前是否已产满文本」，故 `contentState` 取保守的 `partial`。
 */
const LEGACY_STATUS_TO_STATES: Readonly<Record<CandidateStatus, {
  readonly contentState: ContentState
  readonly taskState: TaskState
  readonly canonState: CanonState
  readonly lossy?: { readonly lossy: true; readonly lost: string }
}>> = {
  streaming: { contentState: 'streaming', taskState: 'running', canonState: 'unaccepted' },
  partial: {
    contentState: 'partial',
    taskState: 'succeeded',
    canonState: 'unaccepted',
    lossy: { lossy: true, lost: '无法区分「正常不完整」与「取消后残留」——取消意图已丢失' },
  },
  ready: { contentState: 'complete', taskState: 'succeeded', canonState: 'unaccepted' },
  accepted: { contentState: 'complete', taskState: 'succeeded', canonState: 'accepted' },
  cancelled: { contentState: 'partial', taskState: 'cancelled', canonState: 'unaccepted' },
  failed: {
    contentState: 'partial',
    taskState: 'failed',
    canonState: 'unaccepted',
    lossy: { lossy: true, lost: '无法区分「失败前是否已产满文本」——内容完整度已丢失' },
  },
}

/** 读端兼容（**读旧不写回**，读路径不产生写副作用）：W4-2a 字段改名 + W4-2b 版本迁移。 */
function normalizeCandidateRecord(raw: Record<string, unknown>): DraftCandidate {
  let record = raw
  if (record['generationId'] === undefined && typeof record['operationId'] === 'string') {
    const { operationId, ...rest } = record
    record = { ...rest, generationId: operationId }
  }
  const version = record['schemaVersion']
  if (version === CANDIDATE_SCHEMA_VERSION) {
    const { contentState, taskState, canonState } = record as unknown as Pick<
      DraftCandidate,
      'contentState' | 'taskState' | 'canonState'
    >
    assertCandidateStateCombination(contentState, taskState, canonState)
    const derived = deriveCandidateStatus(contentState, taskState, canonState)
    const stored = record['status']
    // 兼容视图：盘上带了**合法** status 就原样呈现（外部写方/旧工具可能只改它，例如
    // 既有测试直接改盘模拟已采纳）。**真源仍是三字段**——本模块所有采纳/取消判定只读三字段，
    // 绝不读 status，因此兼容视图再陈旧也不会导致错误采纳。
    const status =
      typeof stored === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_STATUS_TO_STATES, stored)
        ? (stored as CandidateStatus)
        : derived
    return { ...record, status } as unknown as DraftCandidate
  }
  if (version === 1) {
    const legacyStatus = record['status'] as CandidateStatus
    const triple = LEGACY_STATUS_TO_STATES[legacyStatus]
    if (triple === undefined) {
      throw new CandidateError('CANDIDATE_STATE_INVALID', `CANDIDATE_STATE_INVALID: unknown legacy status ${String(legacyStatus)}`)
    }
    assertCandidateStateCombination(triple.contentState, triple.taskState, triple.canonState)
    return {
      ...record,
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      contentState: triple.contentState,
      taskState: triple.taskState,
      canonState: triple.canonState,
      generationEpoch: typeof record['generationEpoch'] === 'number' ? record['generationEpoch'] : 0,
      lastSequence: typeof record['lastSequence'] === 'number' ? record['lastSequence'] : 0,
      status: legacyStatus,
      ...(triple.lossy === undefined ? {} : { migratedFrom: { status: legacyStatus, ...triple.lossy } }),
    } as unknown as DraftCandidate
  }
  // 未知版本：拒写而非猜测（写路径先读后写，读失败即写不发生）
  throw new CandidateError(
    'CANDIDATE_RECORD_UNSUPPORTED',
    `CANDIDATE_RECORD_UNSUPPORTED: candidate schemaVersion ${JSON.stringify(version)} is not supported`,
  )
}

/** 列出候选（可选按章过滤）；用于恢复/备份清单与 UI 恢复列表。 */
export function listDraftCandidates(root: string, chapterIndex?: number): DraftCandidate[] {
  const dirPath = join(root, CANDIDATE_DIR)
  if (!existsSync(dirPath)) return []
  const out: DraftCandidate[] = []
  for (const name of readdirSync(dirPath)) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -'.json'.length)
    if (!isServerGeneratedCandidateId(id)) continue
    const c = readDraftCandidate(root, id)
    if (c === null) continue
    if (chapterIndex !== undefined && c.chapterIndex !== chapterIndex) continue
    out.push(c)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function readOrThrow(root: string, id: string): DraftCandidate {
  const c = readDraftCandidate(root, id)
  if (c === null) throw new CandidateError('CANDIDATE_NOT_FOUND', `CANDIDATE_NOT_FOUND: candidate ${id} not found`)
  return c
}

/** 三字段是唯一真源：写入前校验组合合法性，并同步派生兼容视图 status。 */
function withStates(
  c: DraftCandidate,
  next: { readonly contentState: ContentState; readonly taskState: TaskState; readonly canonState: CanonState },
): DraftCandidate {
  assertCandidateStateCombination(next.contentState, next.taskState, next.canonState)
  return { ...c, ...next, status: deriveCandidateStatus(next.contentState, next.taskState, next.canonState) }
}

function writeCandidate(root: string, c: DraftCandidate): void {
  // W4-2b：改用原子写（写临时文件 + rename），避免「最后写入获胜」造成的撕裂记录。
  // 读-改-写的**临界区**由调用方在同一书稿锁内（W2 withBookWriteLock）提供。
  atomicWriteFileSync(join(root, candidateRelPath(c.id)), JSON.stringify(c, null, 2) + '\n')
}

/** 追加流式 delta（仅 streaming 态；终态拒绝）。 */
export function appendCandidateDelta(
  root: string,
  id: string,
  delta: string,
  guard?: { readonly generationEpoch?: number | undefined; readonly sequence?: number | undefined },
): DraftCandidate {
  const c = readOrThrow(root, id)
  // W4-2b 迟到 chunk 守卫：**写盘之前**双校验。旧代次（客户端已切书/切章/停止/新生成）
  // 或已见过的序号一律**丢弃**——返回原记录、不落盘、不报错（丢弃是预期行为，不是失败）。
  if (guard !== undefined) {
    // 代次：**旧代次丢弃**（客户端已切书/切章/停止/新生成）；更新的代次表示视图已前进，
    // 记录随之前进（adopt）。相等即当前代次。
    if (guard.generationEpoch !== undefined && guard.generationEpoch < c.generationEpoch) return c
    if (guard.sequence !== undefined && guard.sequence <= c.lastSequence) return c
  }
  // 终态拒绝（与旧语义等价）：内容已非 streaming，或任务已终结/已采纳
  if (c.contentState !== 'streaming' || (c.taskState !== 'running' && c.taskState !== 'cancel_requested')) {
    throw new CandidateError(CANDIDATE_TERMINAL, `${CANDIDATE_TERMINAL}: ${CANDIDATE_TERMINAL_MSG}`)
  }
  if (delta.length === 0) return c
  const adoptsEpoch =
    guard?.generationEpoch !== undefined && guard.generationEpoch > c.generationEpoch ? guard.generationEpoch : c.generationEpoch
  const updated: DraftCandidate = {
    ...c,
    text: c.text + delta,
    lastSequence: guard?.sequence ?? c.lastSequence + 1,
    generationEpoch: adoptsEpoch,
  }
  writeCandidate(root, updated)
  return updated
}

/**
 * 结束流：ready = 完整候选可采纳；partial = 断流半稿（保留文本，不可直接采纳）；
 * failed = 上游终态失败（保留失败材料）。
 */
export function finishCandidate(root: string, id: string, status: 'ready' | 'partial' | 'failed'): DraftCandidate {
  const c = readOrThrow(root, id)
  // 只有 running 的任务能被「结束」；cancel_requested 要走 resolveCandidateCancel（判定点）
  if (c.contentState !== 'streaming' || c.taskState !== 'running') {
    throw new CandidateError(CANDIDATE_TERMINAL, `${CANDIDATE_TERMINAL}: ${CANDIDATE_TERMINAL_MSG}`)
  }
  const updated = withStates(c, FINISH_STATES[status])
  writeCandidate(root, updated)
  return updated
}

/** 结束流的三种落点（旧签名 → 三字段）。 */
const FINISH_STATES: Readonly<Record<'ready' | 'partial' | 'failed', {
  readonly contentState: ContentState
  readonly taskState: TaskState
  readonly canonState: CanonState
}>> = {
  ready: { contentState: 'complete', taskState: 'succeeded', canonState: 'unaccepted' },
  partial: { contentState: 'partial', taskState: 'succeeded', canonState: 'unaccepted' },
  // 失败保留材料：内容维度取保守的 partial（不声称完整），任务维度如实 failed
  failed: { contentState: 'partial', taskState: 'failed', canonState: 'unaccepted' },
}

/** 取消请求（**中间态**）：只从 running 进入，此刻**不判定成败**。 */
export function requestCandidateCancel(root: string, id: string): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.taskState !== 'running') {
    throw new CandidateError('CANDIDATE_NOT_CANCELLABLE', `CANDIDATE_NOT_CANCELLABLE: candidate ${id} taskState is ${c.taskState}`)
  }
  const updated = withStates(c, { contentState: c.contentState, taskState: 'cancel_requested', canonState: c.canonState })
  writeCandidate(root, updated)
  return updated
}

/**
 * 取消的**判定点**：上游流结束（或完整结果收齐）的那一刻结算。
 * **完成先于取消生效 ⇒ succeeded**（规划 §6.5）——判定用的是上游的实际结局，
 * 不是「收到取消请求」的时刻；上游未完成才落 cancelled。
 */
export function resolveCandidateCancel(
  root: string,
  id: string,
  outcome: { readonly upstreamCompleted: boolean },
): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.taskState !== 'cancel_requested') {
    throw new CandidateError('CANDIDATE_NOT_CANCELLABLE', `CANDIDATE_NOT_CANCELLABLE: candidate ${id} taskState is ${c.taskState}`)
  }
  const updated = withStates(
    c,
    outcome.upstreamCompleted
      ? { contentState: 'complete', taskState: 'succeeded', canonState: c.canonState }
      : { contentState: 'partial', taskState: 'cancelled', canonState: c.canonState },
  )
  writeCandidate(root, updated)
  return updated
}

/** 取消（作者/超时/请求断开）；文本与现场保留不删。 */
export function cancelCandidate(root: string, id: string): DraftCandidate {
  const c = readOrThrow(root, id)
  // 终态语义不变：已取消/已失败/已采纳/内容已完整（ready）都不再可取消
  if (
    c.taskState === 'cancelled' ||
    c.taskState === 'failed' ||
    c.canonState === 'accepted' ||
    c.contentState === 'complete'
  ) {
    throw new CandidateError(CANDIDATE_TERMINAL, `${CANDIDATE_TERMINAL}: ${CANDIDATE_TERMINAL_MSG}`)
  }
  // 走到这里 contentState 只可能是 streaming|partial（complete 已被上面拒绝）：取消即视为不完整
  const updated = withStates(c, { contentState: 'partial', taskState: 'cancelled', canonState: c.canonState })
  writeCandidate(root, updated)
  return updated
}

/** 采纳落地（T04 事务内调用）：候选 → accepted + acceptedRevision；不在此处写正文。 */
export function acceptDraftCandidate(
  root: string,
  id: string,
  acceptedRevision: number,
  allowPartial = false,
  audit?: { readonly confirmPartial?: boolean },
): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.canonState === 'accepted') {
    if (c.acceptedRevision === acceptedRevision) return c
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${id} already accepted at revision ${c.acceptedRevision}`)
  }
  // 失败/取消的任务产物不得被采纳（与旧语义一致：旧 status failed/cancelled 落到同一分支）
  if (c.taskState === 'failed' || c.taskState === 'cancelled') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${id} in status ${c.status} cannot be accepted`)
  }
  // **安全性质（用例锁定）**：contentState=partial + canonState=unaccepted **绝不被自动采纳**——
  // allowPartial 默认 false，半稿必须经作者显式确认（confirmPartial）才可采纳。
  if (c.contentState === 'partial' && !allowPartial) {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${id} in status partial requires explicit confirmation`)
  }
  if (c.contentState !== 'complete' && !(c.contentState === 'partial' && allowPartial)) {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${id} in status ${c.status} cannot be accepted`)
  }
  const isPartialConfirmed = (c.contentState === 'partial' && allowPartial) || Boolean(audit?.confirmPartial)
  const updated: DraftCandidate = {
    ...withStates(c, { contentState: c.contentState, taskState: 'succeeded', canonState: 'accepted' }),
    acceptedRevision,
    ...(isPartialConfirmed ? { confirmPartial: true } : {}),
  }
  writeCandidate(root, updated)
  return updated
}