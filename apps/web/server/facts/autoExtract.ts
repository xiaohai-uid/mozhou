/**
 * 章后事实提取自动触发（#119 ①）：提交链 commit 完成处的 fire-and-forget 提取任务。
 *
 * 挂钩点：/api/chapter.commit 的 runChapterCommit afterRecord 注入缝（proseRoutes，
 * 与 StyleLearner 同缝；每次成功提交恰一次）。纪律：
 * - **绝不阻塞提交响应**：调用点 `void scheduleAutoFactExtraction(...)` 同步返回，
 *   提取在响应返回后异步完成；session.advance 与提交链路零等待；
 * - **未配置 provider（且非 mock 开关）时整个任务跳过**——不写任何账本行（既有
 *   提交测试的「账本零追加」断言保持确定性）；面板靠 /api/facts.status 的
 *   draftProviderAvailability 活探针如实显示「未配置模型」与重试入口，绝不假成功；
 * - **任务进度进既有任务记录体系**：平铺领域行（TraversalStarted/Finished 同款，
 *   impact.ts jsonlAppend 先例）写入 .mozhou/events.jsonl——FactExtractionStarted /
 *   FactExtractionFinished / FactExtractionFailed；任务中心（/api/tasks 直读
 *   readPipelineLedger 事件流水）与 /api/facts.status 同源可见。手动重试
 *   （/api/facts.extract）同样落行（trigger=manual_retry），失败原因持久保留；
 * - **失败绝不静默**：任务体内一切失败都落 FactExtractionFailed{reason} 行并
 *   log('error')；只有「预检判定没模型可跑」的跳过不落行（任务从未启动）。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  RUNTIME_EVENTS_PATH,
  insertFactCandidates,
  listPendingFactCandidates,
  newExtractionRunId,
  proseChapterPath,
  readProseChapter,
  sha256Hex,
  type FactLedgerRecord,
  type NewFactCandidate,
} from '@mozhou/data-plane'
import { readPipelineLedger } from '@mozhou/pipeline'
import { resolveGenerationTarget } from '../llm/generationTarget.js'
import { DRAFT_TASK_TYPE } from '../llm/tierRouting.js'
import { streamOpenAiChat } from '../llm/openaiStream.js'
import { draftProviderAvailability, isMockDraftProviderMode } from '../routes/pipelineRoutes.js'
import { log } from '../observability.js'
import {
  buildFactExtractionUserPrompt,
  FACT_EXTRACTION_SYSTEM_PROMPT,
  mockFactExtraction,
  parseFactExtractionOutput,
  type ExtractedFactCandidate,
} from './extraction.js'

export class FactExtractionChapterMissingError extends Error {
  constructor(readonly chapterIndex: number) {
    super(`CHAPTER_NOT_FOUND: chapter ${chapterIndex} prose not found or malformed`)
  }
}

export class FactExtractionProviderUnavailableError extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string,
  ) {
    super(`PROVIDER_UNAVAILABLE: ${reason} — ${detail}`)
  }
}

export interface FactExtractionOutcome {
  readonly runId: string
  readonly proseHash: string
  readonly inserted: readonly FactLedgerRecord[]
  readonly voided: readonly string[]
}

export interface ExtractFactCandidatesOptions {
  /** hosted 主体隔离：BYOK 凭据按 principal 解析（与 /api/facts.extract 同缝）。 */
  readonly principalUserId?: string
  /** 客户端断连中止（HTTP 手动重试缝传入；自动触发不传）。 */
  readonly signal?: AbortSignal
  /** 提取批次身份；缺省自生成（自动触发传入以保证与 Started 行同 runId）。 */
  readonly runId?: string
}

/**
 * 提取核心：读正文 → 版本哈希 → mock/真实单缝（resolveGenerationTarget）→
 * 结构化解析 → 落账本。/api/facts.extract（#117 HTTP 面）与提交链自动触发共用
 * 同一实现——生成缝、mock 判据、解析口径任何一边漂移都立即全线可见。
 * 失败以类型化错误上抛，由调用方映射各自的响应形态（HTTP 状态码 / Failed 行）。
 */
export async function extractAndInsertFactCandidates(
  root: string,
  chapterIndex: number,
  options: ExtractFactCandidatesOptions = {},
): Promise<FactExtractionOutcome> {
  let proseBody: string
  try {
    proseBody = readProseChapter(root, proseChapterPath(chapterIndex)).body
  } catch {
    throw new FactExtractionChapterMissingError(chapterIndex)
  }
  const proseHash = sha256Hex(proseBody)
  const runId = options.runId ?? newExtractionRunId()
  let extracted: readonly ExtractedFactCandidate[]
  if (isMockDraftProviderMode(process.env)) {
    extracted = mockFactExtraction(chapterIndex, proseBody)
  } else {
    const target = await resolveGenerationTarget({
      taskType: DRAFT_TASK_TYPE,
      ...(options.principalUserId === undefined ? {} : { principal: { userId: options.principalUserId } }),
      env: process.env,
    })
    if (!target.available) {
      if (target.reason === 'no_provider_configured') {
        throw new FactExtractionProviderUnavailableError(target.reason, target.detail)
      }
      throw new Error(`PROVIDER_UNAVAILABLE: ${target.detail}`)
    }
    let raw = ''
    for await (const chunk of streamOpenAiChat(
      target.endpoint,
      buildFactExtractionUserPrompt(chapterIndex, proseBody),
      FACT_EXTRACTION_SYSTEM_PROMPT,
      options.signal,
    )) {
      raw += chunk.delta
    }
    if (raw.trim().length === 0) {
      throw new Error('FACT_EXTRACTION_PARSE_FAILED: provider returned an empty stream')
    }
    extracted = parseFactExtractionOutput(raw)
  }

  const payload: readonly NewFactCandidate[] = extracted.map((candidate) => ({
    kind: candidate.kind,
    payload: candidate.payload,
    evidence: candidate.evidence,
    chapterIndex,
    proseHash,
    extractionRunId: runId,
  }))
  const result = insertFactCandidates(root, chapterIndex, payload)
  return { runId, proseHash, inserted: result.inserted, voided: result.voided }
}

/** 提取任务的账本进度行（平铺领域行，TraversalStarted 同款形状）。 */
export type FactExtractionEventRowType = 'FactExtractionStarted' | 'FactExtractionFinished' | 'FactExtractionFailed'

export interface FactExtractionEventRow {
  readonly type: FactExtractionEventRowType
  readonly at: string
  readonly chapterIndex: number
  readonly runId: string
  readonly trigger: 'auto_commit' | 'manual_retry'
  readonly inserted?: number
  readonly voided?: number
  readonly reason?: string
}

function appendExtractionRow(root: string, row: FactExtractionEventRow): void {
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  appendFileSync(join(root, RUNTIME_EVENTS_PATH), JSON.stringify(row) + '\n')
}

export interface ScheduleAutoFactExtractionInput {
  readonly root: string
  readonly chapterIndex: number
  readonly principalUserId?: string
  readonly trigger?: 'auto_commit' | 'manual_retry'
}

export interface FactExtractionRunInput {
  readonly root: string
  readonly chapterIndex: number
  readonly trigger: 'auto_commit' | 'manual_retry'
  readonly principalUserId?: string
  readonly signal?: AbortSignal
}

/**
 * 带进度行的提取执行：Started → 提取核心 → Finished / Failed（同一 runId 贯穿）。
 * 自动触发（提交链）与手动重试（/api/facts.extract）共用——手动路径的失败原因
 * 由此持久化为 Failed 行（规格 User Story 13「保留失败原因」），不再只活在 HTTP 响应里。
 * 进度行写失败只 log 降级，不阻断提取本体（派生面纪律，S12 同款）。
 */
export async function runFactExtractionWithProgress(input: FactExtractionRunInput): Promise<FactExtractionOutcome> {
  const { root, chapterIndex, trigger, principalUserId, signal } = input
  const logFields = { chapterIndex, trigger }
  const runId = newExtractionRunId()
  try {
    appendExtractionRow(root, { type: 'FactExtractionStarted', at: new Date().toISOString(), chapterIndex, runId, trigger })
  } catch (cause) {
    log('warn', 'facts.extraction_started_row_failed', { ...logFields, detail: (cause as Error).message })
  }
  try {
    const outcome = await extractAndInsertFactCandidates(root, chapterIndex, {
      ...(principalUserId === undefined ? {} : { principalUserId }),
      ...(signal === undefined ? {} : { signal }),
      runId,
    })
    appendExtractionRow(root, {
      type: 'FactExtractionFinished',
      at: new Date().toISOString(),
      chapterIndex,
      runId,
      trigger,
      inserted: outcome.inserted.length,
      voided: outcome.voided.length,
    })
    log('info', 'facts.extraction_finished', {
      ...logFields,
      runId,
      inserted: outcome.inserted.length,
      voided: outcome.voided.length,
    })
    return outcome
  } catch (cause) {
    const reason = (cause as Error).message
    try {
      appendExtractionRow(root, {
        type: 'FactExtractionFailed',
        at: new Date().toISOString(),
        chapterIndex,
        runId,
        trigger,
        reason,
      })
    } catch (rowCause) {
      log('warn', 'facts.extraction_failed_row_failed', { ...logFields, detail: (rowCause as Error).message })
    }
    log('error', 'facts.extraction_failed', { ...logFields, runId, reason })
    throw cause
  }
}

/**
 * 自动触发一次章后事实提取。fire-and-forget：调用点 void 即返回；本函数自身
 * 不抛（一切失败落 Failed 行 + log）。provider 预检不可用（非 mock）⇒ 静默跳过，
 * 不写任何行——「没模型可跑」不是任务失败，面板经活探针如实呈现。
 */
export async function scheduleAutoFactExtraction(input: ScheduleAutoFactExtractionInput): Promise<void> {
  const { root, chapterIndex, principalUserId, trigger = 'auto_commit' } = input
  const logFields = { chapterIndex, trigger }
  try {
    const availability = await draftProviderAvailability(process.env, principalUserId)
    if (!availability.available) {
      log('info', 'facts.auto_extraction_skipped', { ...logFields, reason: availability.reason })
      return
    }
  } catch (cause) {
    // 预检自身故障 ≠ provider 缺失：照常启动任务，任务体失败路径如实落行。
    log('warn', 'facts.auto_extraction_probe_failed', { ...logFields, detail: (cause as Error).message })
  }
  try {
    await runFactExtractionWithProgress({
      root,
      chapterIndex,
      trigger,
      ...(principalUserId === undefined ? {} : { principalUserId }),
    })
  } catch {
    // 失败已由 runFactExtractionWithProgress 落 Failed 行 + log('error')；
    // fire-and-forget 语义在此收口，绝不让提交链 afterRecord 感知到拒绝。
  }
}

/** 从账本平铺行收敛提取进度行的严格形状（字段缺失/类型不符的行丢弃，宁缺不猜）。 */
function normalizeExtractionRow(row: Readonly<Record<string, unknown>>): FactExtractionEventRow | null {
  const type = row['type']
  const at = row['at']
  const chapterIndex = row['chapterIndex']
  const runId = row['runId']
  const trigger = row['trigger']
  if (typeof type !== 'string' || typeof at !== 'string' || typeof runId !== 'string' || typeof trigger !== 'string') {
    return null
  }
  if (type !== 'FactExtractionStarted' && type !== 'FactExtractionFinished' && type !== 'FactExtractionFailed') {
    return null
  }
  if (typeof chapterIndex !== 'number' || !Number.isInteger(chapterIndex)) return null
  if (trigger !== 'auto_commit' && trigger !== 'manual_retry') return null
  const inserted = row['inserted']
  const voided = row['voided']
  const reason = row['reason']
  return {
    type,
    at,
    chapterIndex,
    runId,
    trigger,
    ...(typeof inserted === 'number' ? { inserted } : {}),
    ...(typeof voided === 'number' ? { voided } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  }
}

export interface FactExtractionStatusView {
  /** 本章最近一条提取进度行；从未触发过 → null。 */
  readonly latest: FactExtractionEventRow | null
  /** 本章待决候选数（与 /api/facts.candidates 同源，listPendingFactCandidates 直读账本）。 */
  readonly pendingCount: number
}

/** 章后提取状态（/api/facts.status 数据面）：最近一条进度行 + 待决候选数。 */
export function readFactExtractionStatus(root: string, chapterIndex: number): FactExtractionStatusView {
  let latest: FactExtractionEventRow | null = null
  for (const ledgerRow of readPipelineLedger(root)) {
    if (ledgerRow.kind !== 'domain') continue
    const normalized = normalizeExtractionRow(ledgerRow.row)
    if (normalized === null || normalized.chapterIndex !== chapterIndex) continue
    latest = normalized
  }
  return { latest, pendingCount: listPendingFactCandidates(root, chapterIndex).length }
}
