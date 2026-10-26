/**
 * 候选事实账本 HTTP 面（#117 章节事件查 + #118 人物心理状态查 · 提取 / 待决 / 决断 / 历史；
 * #119 增补状态面 /api/facts.status 与共享提取缝）。
 *
 * - book 类别：root/bookId 经路由层 resolveAuthorizedBook 解析（hosted 主体隔离继承既有缝）；
 * - 提取：mock 判据与行内编辑流同源；真实分支经 resolveGenerationTarget 单缝，
 *   未配置 provider 时显式 PROVIDER_UNAVAILABLE，绝不假成功；提取核心与提交链
 *   自动触发（facts/autoExtract.ts，#119 ①）共用同一实现；
 * - 决断幂等（含相反方向决断按幂等重放返回首次结果）与现场隔离（同章重提取
 *   作废旧 pending；决断时正文版本不符同样作废）由数据面 fact-ledger 保证。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteHandler } from '../router.js'
import { decodeBookRequest } from '../bookRequest.js'
import { INVALID_BOOK_REQUEST, PROVIDER_UNAVAILABLE } from '../routeCodes.js'
import {
  decideFactCandidate,
  listPendingFactCandidates,
  listFactLedgerHistory,
  FactCandidateNotFoundError,
  FactCandidateVoidedError,
  type FactCandidatePayload,
} from '@mozhou/data-plane'
import {
  readFactExtractionStatus,
  runFactExtractionWithProgress,
  FactExtractionChapterMissingError,
  FactExtractionProviderUnavailableError,
} from '../facts/autoExtract.js'
import { draftProviderAvailability } from './pipelineRoutes.js'
import { psychStateSummary } from '../facts/extraction.js'

type RouteContext = {
  readonly path: string
  readonly body: Record<string, unknown>
  readonly json: (status: number, body: unknown) => void
  readonly bookRoot?: string | null | undefined
  readonly principal: { readonly userId: string; readonly email: string | null } | null | undefined
}

/** 提取（book 类别；mock 与真实 provider 同缝）。 */
async function handleExtract(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<boolean> {
  const { body, json, bookRoot, principal } = ctx
  const decoded = decodeBookRequest(body, bookRoot ?? null, { principal })
  if (!decoded.ok) {
    json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
    return true
  }
  const { root, chapterIndex } = decoded.value
  if (!Number.isInteger(chapterIndex) || chapterIndex < 1) {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'chapterIndex must be a positive integer' })
    return true
  }

  // 共享提取缝（facts/autoExtract.ts，#119 ①）：mock 判据、resolveGenerationTarget
  // 单缝、结构化解析、账本落定、进度行（Started/Finished/Failed，trigger=manual_retry）
  // 全部与提交链自动触发共用同一实现——两边任何口径漂移立即全线可见。
  // HTTP 侧只保留契约映射（404 / PROVIDER_UNAVAILABLE / 502）与客户端断连中止。
  const abortController = new AbortController()
  res.on('close', () => abortController.abort())
  try {
    const outcome = await runFactExtractionWithProgress({
      root,
      chapterIndex,
      trigger: 'manual_retry',
      ...(principal === null || principal === undefined || principal.userId === undefined
        ? {}
        : { principalUserId: principal.userId }),
      signal: abortController.signal,
    })
    json(200, {
      ok: true,
      runId: outcome.runId,
      proseHash: outcome.proseHash,
      inserted: outcome.inserted.length,
      voided: outcome.voided.length,
      candidates: outcome.inserted,
    })
  } catch (error) {
    if (error instanceof FactExtractionChapterMissingError) {
      json(404, { ok: false, code: 'CHAPTER_NOT_FOUND', error: error.message })
      return true
    }
    if (error instanceof FactExtractionProviderUnavailableError) {
      // 与 prose.edit.stream 前置闸同语义：真没配任何 provider 才笼统收口
      json(200, { ok: false, code: PROVIDER_UNAVAILABLE, error: 'provider unavailable: no draft provider configured' })
      return true
    }
    json(502, { ok: false, code: 'FACT_EXTRACTION_FAILED', error: (error as Error).message })
  }
  return true
}

/**
 * 章后提取状态（#119 章后回顾面板数据面）：最近一条提取进度行（账本平铺行）+
 * 待决候选数 + provider 活探针。未配置模型时 extraction 可能为 null 而
 * provider.available=false——面板据此显示「未配置模型」与重试入口，绝不假成功。
 */
async function handleStatus(ctx: RouteContext): Promise<boolean> {
  const { body, json, bookRoot, principal } = ctx
  const decoded = decodeBookRequest(body, bookRoot ?? null, { principal })
  if (!decoded.ok) {
    json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
    return true
  }
  const { root, chapterIndex } = decoded.value
  if (!Number.isInteger(chapterIndex) || chapterIndex < 1) {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'chapterIndex must be a positive integer' })
    return true
  }
  const status = readFactExtractionStatus(root, chapterIndex)
  const availability = await draftProviderAvailability(
    process.env,
    principal === null || principal === undefined ? undefined : principal.userId,
  )
  json(200, {
    ok: true,
    chapterIndex,
    extraction: status.latest,
    pendingCount: status.pendingCount,
    provider: {
      available: availability.available,
      ...(availability.available ? {} : { reason: availability.reason, detail: availability.detail }),
    },
  })
  return true
}

/** 待决候选列表（chapterIndex 可选过滤）。 */
function handleCandidates(ctx: RouteContext): boolean {
  const { body, json, bookRoot, principal } = ctx
  const decoded = decodeBookRequest(body, bookRoot ?? null, { principal, chapter: 'optional' })
  if (!decoded.ok) {
    json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
    return true
  }
  const { root, chapterIndex } = decoded.value
  const candidates = listPendingFactCandidates(root, typeof chapterIndex === 'number' ? chapterIndex : undefined)
  json(200, { ok: true, candidates })
  return true
}

/** 从决断载荷解析编辑后内容；非法即 400。载荷出现 character 即按心理状态候选口径校验。 */
function parseDecidePayload(raw: unknown): FactCandidatePayload | undefined | 'INVALID' {
  if (raw === null || typeof raw !== 'object') {
    return undefined
  }
  const item = raw as Record<string, unknown>
  // 人物心理状态候选（#118）的编辑确认走结构化字段：character / before / after 必填，
  // 摘要由三字段派生（与提取缝 psychStateSummary 同口径）。
  const character = typeof item['character'] === 'string' ? item['character'].trim() : ''
  if (character.length > 0) {
    const before = typeof item['before'] === 'string' ? item['before'].trim() : ''
    const after = typeof item['after'] === 'string' ? item['after'].trim() : ''
    if (before.length === 0 || after.length === 0) {
      return 'INVALID'
    }
    return { summary: psychStateSummary(character, before, after), character, before, after }
  }
  // 事件候选（#117 口径不变）：summary 必填。
  const summary = typeof item['summary'] === 'string' ? item['summary'].trim() : ''
  if (summary.length === 0) {
    return 'INVALID'
  }
  const detail = typeof item['detail'] === 'string' && item['detail'].trim().length > 0 ? item['detail'].trim() : undefined
  return { summary, ...(detail !== undefined ? { detail } : {}) }
}

/** 决断：确认 / 拒绝 / 编辑确认（幂等；voided 409；未知 404）。 */
function handleDecide(ctx: RouteContext): boolean {
  const { body, json, bookRoot, principal } = ctx
  const decoded = decodeBookRequest(body, bookRoot ?? null, { principal, chapter: 'optional' })
  if (!decoded.ok) {
    json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
    return true
  }
  const { root } = decoded.value
  // 字段名用 factCandidateId 而非 candidateId：路由层 assertResourceOwnership 对带
  // candidateId 的 book 请求按草稿候选目录（.mozhou/candidates/）做归属校验，
  // 候选事实不在该目录，撞名会被截胡 404。
  const candidateId = typeof body['factCandidateId'] === 'string' ? body['factCandidateId'].trim() : ''
  const decision = body['decision']
  if (candidateId.length === 0) {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'factCandidateId is required' })
    return true
  }
  if (decision !== 'confirmed' && decision !== 'rejected') {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: "decision must be 'confirmed' or 'rejected'" })
    return true
  }
  const payload = parseDecidePayload(body['payload'])
  if (payload === 'INVALID') {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'payload.summary must be a non-empty string' })
    return true
  }

  try {
    const outcome = decideFactCandidate(root, candidateId, { decision, ...(payload !== undefined ? { payload } : {}) })
    json(200, { ok: true, replayed: outcome.replayed, record: outcome.record })
  } catch (error) {
    if (error instanceof FactCandidateVoidedError) {
      json(409, { ok: false, code: 'FACT_CANDIDATE_VOIDED', error: error.message })
      return true
    }
    if (error instanceof FactCandidateNotFoundError) {
      json(404, { ok: false, code: 'FACT_CANDIDATE_NOT_FOUND', error: error.message })
      return true
    }
    json(500, { ok: false, code: 'FACT_DECIDE_FAILED', error: (error as Error).message })
  }
  return true
}

/** 历史（含 voided / 已决断，append-only 可翻旧账）。 */
function handleHistory(ctx: RouteContext): boolean {
  const { body, json, bookRoot, principal } = ctx
  const decoded = decodeBookRequest(body, bookRoot ?? null, { principal, chapter: 'optional' })
  if (!decoded.ok) {
    json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
    return true
  }
  const { root, chapterIndex } = decoded.value
  const rawLimit = body['limit']
  const limit = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined
  const chapterFilter = typeof chapterIndex === 'number' ? chapterIndex : undefined
  const records = listFactLedgerHistory(root, {
    ...(chapterFilter !== undefined ? { chapterIndex: chapterFilter } : {}),
    ...(limit !== undefined ? { limit } : {}),
  })
  json(200, { ok: true, records })
  return true
}

export const factsRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot, principal }) => {
  if (req.method !== 'POST') return false
  const ctx: RouteContext = { path, body, json, bookRoot, principal }

  if (path === '/api/facts.extract') return handleExtract(req, res, ctx)
  if (path === '/api/facts.status') return handleStatus(ctx)
  if (path === '/api/facts.candidates') return handleCandidates(ctx)
  if (path === '/api/facts.decide') return handleDecide(ctx)
  if (path === '/api/facts.history') return handleHistory(ctx)
  return false
}
