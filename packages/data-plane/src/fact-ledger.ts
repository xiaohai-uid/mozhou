/**
 * 候选事实账本（Candidate Fact Ledger · 第一切片 #117）。
 *
 * 规格：.scratch/chapter-fact-ledger/spec.md（裁决：两查先行、提交后回顾）。
 * 存储先例：tasks.ts —— `<bookRoot>/.mozhou/fact-ledger/<sha256(candidateId)>.json`
 * 一候选一记录、记录只增不删（决断在原记录上落定，不新增第二条记录），
 * 运行时区、非 canon：不参与对账、不进 manifest 基线。
 *
 * 决断状态机（单向）：
 *   pending → confirmed | rejected；voided 由现场传播（同章重新提取、
 *   决断时正文版本与候选绑定版本不符），任何终态不可逆。
 * - 原始候选 payload 绝不覆写：编辑确认在同一记录写 decidedPayload，原 payload 原样保留；
 * - 已决断候选再次决断（含相反方向）按幂等重放返回首次结果（replayed: true）；
 * - 一次提取定义一个新现场：同章全部旧 pending 先作废再插入——
 *   无论正文版本是否变化、无论本批是否提出候选（空提取同样是新现场），
 *   confirmed / rejected 历史不受影响。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { newUlid } from '@mozhou/kernel'
import { atomicWriteFileSync } from './atomic-write.js'
import { RUNTIME_FACT_LEDGER_DIR, proseChapterPath } from './layout.js'
import { readProseChapter } from './chapter.js'
import { sha256Hex } from './sha256.js'

export const FACT_LEDGER_RECORD_VERSION = 1

export type FactKind = 'event' | 'psychological_state'
export type FactDecision = 'confirmed' | 'rejected'
export type FactStatus = 'pending' | 'confirmed' | 'rejected' | 'voided'

export interface FactCandidatePayload {
  readonly summary: string
  readonly detail?: string
}

export interface NewFactCandidate {
  readonly kind: FactKind
  readonly payload: FactCandidatePayload
  /** 原文依据摘句：作者判断真伪的第一依据（竞品 AI_NovelGenerator 同款证据引用）。 */
  readonly evidence: string
  readonly chapterIndex: number
  /** 正文版本身份（正文 sha256）：候选与内容版本绑定，重写即新现场。 */
  readonly proseHash: string
  readonly extractionRunId: string
}

export interface FactLedgerRecord extends NewFactCandidate {
  readonly recordVersion: typeof FACT_LEDGER_RECORD_VERSION
  readonly candidateId: string
  readonly status: FactStatus
  readonly createdAt: string
  readonly decidedAt?: string
  /** 编辑确认时的决断后内容；未编辑确认与拒绝不携带。 */
  readonly decidedPayload?: FactCandidatePayload
}

export class FactCandidateNotFoundError extends Error {
  constructor(candidateId: string) {
    super(`FACT_CANDIDATE_NOT_FOUND: ${candidateId}`)
  }
}

export class FactCandidateVoidedError extends Error {
  constructor(candidateId: string) {
    super(`FACT_CANDIDATE_VOIDED: ${candidateId} was voided by a newer extraction of the same chapter`)
  }
}

export class FactCandidateNotPendingError extends Error {
  constructor(candidateId: string, status: FactStatus) {
    super(`FACT_CANDIDATE_NOT_PENDING: ${candidateId} is already ${status}`)
  }
}

/** 批次现场与候选章号不一致：整批拒绝落账，不产生半现场。 */
export class FactBatchChapterMismatchError extends Error {
  constructor(sceneChapterIndex: number, candidateChapterIndex: number) {
    super(`FACT_BATCH_CHAPTER_MISMATCH: extraction scene is chapter ${sceneChapterIndex}, but a candidate declares chapter ${candidateChapterIndex}`)
  }
}

function ledgerDir(root: string): string {
  const dir = join(root, RUNTIME_FACT_LEDGER_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

function recordPath(root: string, candidateId: string): string {
  return join(ledgerDir(root), `${createHash('sha256').update(candidateId).digest('hex')}.json`)
}

function readRecord(root: string, candidateId: string): FactLedgerRecord | null {
  const path = recordPath(root, candidateId)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as FactLedgerRecord
}

function writeRecord(root: string, record: FactLedgerRecord): void {
  atomicWriteFileSync(recordPath(root, record.candidateId), JSON.stringify(record, null, 2) + '\n')
}

/** 当前章正文版本身份；正文缺失或不可解析时返回 null（该章现场已不存在）。 */
function currentChapterProseHash(root: string, chapterIndex: number): string | null {
  try {
    return sha256Hex(readProseChapter(root, proseChapterPath(chapterIndex)).body)
  } catch {
    return null
  }
}

function listAllRecords(root: string): FactLedgerRecord[] {
  const dir = ledgerDir(root)
  const records: FactLedgerRecord[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    try {
      records.push(JSON.parse(readFileSync(join(dir, entry), 'utf8')) as FactLedgerRecord)
    } catch {
      // 单条记录损坏不阻断整册读取；损坏文件保留现场待人工排查。
    }
  }
  records.sort((a, b) => (a.createdAt === b.createdAt ? a.candidateId.localeCompare(b.candidateId) : a.createdAt.localeCompare(b.createdAt)))
  return records
}

function chronological(now?: string): string {
  return now ?? new Date().toISOString()
}

export interface InsertFactCandidatesResult {
  readonly inserted: readonly FactLedgerRecord[]
  /** 本次提取作废的同章旧 pending 候选 id（含不同正文版本的残留现场）。 */
  readonly voided: readonly string[]
}

/**
 * 插入一次提取的候选。chapterIndex 是本次提取的现场章号，必须显式给出——
 * 同章（chapterIndex）全部旧 pending 先作废再插入，无论正文版本是否变化、
 * 无论本批是否提出候选（空提取同样是新现场）：一次提取定义一个新现场。
 * 批次内任何候选章号与现场章号不一致即整批拒绝（FactBatchChapterMismatchError），
 * 不产生半现场。
 */
export function insertFactCandidates(
  root: string,
  chapterIndex: number,
  candidates: readonly NewFactCandidate[],
  now?: string,
): InsertFactCandidatesResult {
  for (const candidate of candidates) {
    if (candidate.chapterIndex !== chapterIndex) {
      throw new FactBatchChapterMismatchError(chapterIndex, candidate.chapterIndex)
    }
  }
  const createdAt = chronological(now)
  const voided: string[] = []
  for (const record of listAllRecords(root)) {
    if (record.chapterIndex === chapterIndex && record.status === 'pending') {
      writeRecord(root, { ...record, status: 'voided' })
      voided.push(record.candidateId)
    }
  }

  const inserted = candidates.map((candidate) => {
    // 候选 id 用 ULID（按创建时间可排序）：列表按 id 排序 = 按插入序确定，
    // 随机 hex id 会让同毫秒批次的展示顺序随机（曾在测试中实测翻车）。
    const record: FactLedgerRecord = {
      ...candidate,
      recordVersion: FACT_LEDGER_RECORD_VERSION,
      candidateId: 'fc_' + newUlid(),
      status: 'pending',
      createdAt,
    }
    writeRecord(root, record)
    return record
  })
  return { inserted, voided }
}

/** 待决候选（按章过滤可选）；确定性排序，幂等可重读。 */
export function listPendingFactCandidates(root: string, chapterIndex?: number): readonly FactLedgerRecord[] {
  return listAllRecords(root).filter(
    (record) => record.status === 'pending' && (chapterIndex === undefined || record.chapterIndex === chapterIndex),
  )
}

export interface DecideFactCandidateInput {
  readonly decision: FactDecision
  /** 编辑确认时的决断后内容；纯确认 / 拒绝不携带。 */
  readonly payload?: FactCandidatePayload
}

export interface DecideFactCandidateResult {
  readonly record: FactLedgerRecord
  /** true = 该候选此前已决断，本次为幂等重放，决断时间与结果未变化。 */
  readonly replayed: boolean
}

/**
 * 单向决断。已决断 → 幂等重放首次结果；voided → 显式拒绝；不存在 → NotFound。
 *
 * 幂等重放契约（含相反方向决断）：单向状态机不做反向翻转。已决断候选收到任意
 * 方向的再次决断时，返回账本真实状态（首次决断的 status / decidedAt / decidedPayload）
 * 并带 replayed: true——客户端必须按 record.status 判读结果，而不是凭本次请求方向；
 * replayed: true 表示「该候选早已决断，本次未产生新决断」，不区分同向重放与方向冲突。
 *
 * 正文版本身份校验：pending 候选绑定的 proseHash 与当前章正文不一致（作者改稿后
 * 未重提取），或正文已不可读，即旧现场残留——按 voided 传播并拒绝决断
 * （确认的事实必须来自当前正文现场，旧任务不能污染新现场）。
 */
export function decideFactCandidate(
  root: string,
  candidateId: string,
  decision: DecideFactCandidateInput,
  now?: string,
): DecideFactCandidateResult {
  const record = readRecord(root, candidateId)
  if (!record) {
    throw new FactCandidateNotFoundError(candidateId)
  }
  if (record.status === 'voided') {
    throw new FactCandidateVoidedError(candidateId)
  }
  if (record.status !== 'pending') {
    return { record, replayed: true }
  }
  if (currentChapterProseHash(root, record.chapterIndex) !== record.proseHash) {
    writeRecord(root, { ...record, status: 'voided' })
    throw new FactCandidateVoidedError(candidateId)
  }

  const decided: FactLedgerRecord = {
    ...record,
    status: decision.decision,
    decidedAt: chronological(now),
    ...(decision.payload !== undefined ? { decidedPayload: decision.payload } : {}),
  }
  writeRecord(root, decided)
  return { record: decided, replayed: false }
}

/**
 * 账本历史（含 voided / 已决断）；chapterIndex 过滤可选。
 * limit 取最近 N 条：必须是正整数，0 / 负数 / 非整数返回空数组（0 不表示「全部」），
 * 缺省返回全部。
 */
export function listFactLedgerHistory(
  root: string,
  filter?: { readonly chapterIndex?: number; readonly limit?: number },
): readonly FactLedgerRecord[] {
  const filtered = listAllRecords(root).filter(
    (record) => filter?.chapterIndex === undefined || record.chapterIndex === filter.chapterIndex,
  )
  const limit = filter?.limit
  if (limit === undefined) return filtered
  if (!Number.isInteger(limit) || limit <= 0) return []
  return filtered.slice(-limit)
}

/** 提取批次身份：服务端一次调用一个 runId，候选可按批追溯。 */
export function newExtractionRunId(): string {
  return 'fx_' + newUlid()
}
