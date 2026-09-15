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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type CandidateStatus = 'streaming' | 'partial' | 'ready' | 'accepted' | 'cancelled' | 'failed'

export type CandidateMode = 'replace' | 'continue' | 'insert' | 'replace-selection'

/** C1：写入基（revision + 原文 sha256），唯一领域定义在此。 */
export interface WriteBase {
  readonly revision: number
  readonly sha256: string
}

export interface DraftCandidate {
  readonly schemaVersion: 1
  readonly id: string
  readonly operationId: string
  readonly bookId: string
  readonly chapterIndex: number
  /** 生成开始时的章版本现场；accept 时与盘上 CAS 比对。 */
  readonly base: WriteBase
  readonly mode: CandidateMode
  readonly text: string
  readonly status: CandidateStatus
  /** insert/replace-selection 在生成开始时的选区；selectedTextHash 与 base.sha256 同纪律。 */
  readonly selection?: { readonly from: number; readonly to: number; readonly selectedTextHash: string }
  /** accepted 后记录落地 revision。 */
  readonly acceptedRevision?: number
}

export interface DraftCandidateRequest {
  readonly id: string
  readonly operationId: string
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
  const payload: DraftCandidate = {
    schemaVersion: 1,
    id: request.id,
    operationId: request.operationId,
    bookId: request.bookId,
    chapterIndex: request.chapterIndex,
    base: request.base,
    mode: request.mode,
    text: request.seedText ?? '',
    status: 'streaming',
    ...(request.selection === undefined ? {} : { selection: request.selection }),
  }
  const path = join(root, candidateRelPath(request.id))
  if (existsSync(path)) {
    throw new CandidateError('CANDIDATE_EXISTS', `CANDIDATE_EXISTS: candidate ${request.id} already exists`)
  }
  mkdirSync(join(root, CANDIDATE_DIR), { recursive: true })
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n')
  return payload
}

/** 读候选；未知 id 返回 null（404 语义）。 */
export function readDraftCandidate(root: string, id: string): DraftCandidate | null {
  const path = join(root, candidateRelPath(id))
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as DraftCandidate
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

function writeCandidate(root: string, c: DraftCandidate): void {
  writeFileSync(join(root, candidateRelPath(c.id)), JSON.stringify(c, null, 2) + '\n')
}

/** 追加流式 delta（仅 streaming 态；终态拒绝）。 */
export function appendCandidateDelta(root: string, id: string, delta: string): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.status !== 'streaming') throw new CandidateError(CANDIDATE_TERMINAL, `${CANDIDATE_TERMINAL}: ${CANDIDATE_TERMINAL_MSG}`)
  if (delta.length === 0) return c
  const updated: DraftCandidate = { ...c, text: c.text + delta }
  writeCandidate(root, updated)
  return updated
}

/**
 * 结束流：ready = 完整候选可采纳；partial = 断流半稿（保留文本，不可直接采纳）；
 * failed = 上游终态失败（保留失败材料）。
 */
export function finishCandidate(root: string, id: string, status: 'ready' | 'partial' | 'failed'): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.status !== 'streaming') throw new CandidateError(CANDIDATE_TERMINAL, `${CANDIDATE_TERMINAL}: ${CANDIDATE_TERMINAL_MSG}`)
  const updated: DraftCandidate = { ...c, status }
  writeCandidate(root, updated)
  return updated
}

/** 取消（作者/超时/请求断开）；文本与现场保留不删。 */
export function cancelCandidate(root: string, id: string): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.status !== 'streaming' && c.status !== 'partial') {
    throw new CandidateError(CANDIDATE_TERMINAL, `${CANDIDATE_TERMINAL}: ${CANDIDATE_TERMINAL_MSG}`)
  }
  const updated: DraftCandidate = { ...c, status: 'cancelled' }
  writeCandidate(root, updated)
  return updated
}

/** 采纳落地（T04 事务内调用）：候选 → accepted + acceptedRevision；不在此处写正文。 */
export function acceptDraftCandidate(root: string, id: string, acceptedRevision: number): DraftCandidate {
  const c = readOrThrow(root, id)
  if (c.status !== 'ready' && c.status !== 'partial') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${id} in status ${c.status} cannot be accepted`)
  }
  const updated: DraftCandidate = { ...c, status: 'accepted', acceptedRevision }
  writeCandidate(root, updated)
  return updated
}