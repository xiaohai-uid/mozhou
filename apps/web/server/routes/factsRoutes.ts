/**
 * 章后事实账本 HTTP 面（#117 · 提取 / 待决 / 决断 / 历史）。
 *
 * - book 类别：root/bookId 经路由层 resolveAuthorizedBook 解析（hosted 主体隔离继承既有缝）；
 * - 提取：mock 判据与行内编辑流同源；真实分支经 resolveGenerationTarget 单缝，
 *   未配置 provider 时显式 PROVIDER_UNAVAILABLE，绝不假成功；
 * - 决断幂等与现场隔离（同章重提取作废旧 pending）由数据面 fact-ledger 保证。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteHandler } from '../router.js'
import { decodeBookRequest } from '../bookRequest.js'
import { INVALID_BOOK_REQUEST, PROVIDER_UNAVAILABLE } from '../routeCodes.js'
import {
  insertFactCandidates,
  decideFactCandidate,
  listPendingFactCandidates,
  listFactLedgerHistory,
  newExtractionRunId,
  readProseChapter,
  proseChapterPath,
  sha256Hex,
  FactCandidateNotFoundError,
  FactCandidateVoidedError,
  type FactCandidatePayload,
  type NewFactCandidate,
} from '@mozhou/data-plane'
import { resolveGenerationTarget } from '../llm/generationTarget.js'
import { DRAFT_TASK_TYPE } from '../llm/tierRouting.js'
import { streamOpenAiChat } from '../llm/openaiStream.js'
import { isMockDraftProviderMode } from './pipelineRoutes.js'
import {
  buildFactExtractionUserPrompt,
  FACT_EXTRACTION_SYSTEM_PROMPT,
  mockFactExtraction,
  parseFactExtractionOutput,
} from '../facts/extraction.js'

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

  let proseBody: string
  try {
    proseBody = readProseChapter(root, proseChapterPath(chapterIndex)).body
  } catch {
    json(404, { ok: false, code: 'CHAPTER_NOT_FOUND', error: `chapter ${chapterIndex} prose not found or malformed` })
    return true
  }
  const proseHash = sha256Hex(proseBody)
  const runId = newExtractionRunId()

  try {
    let extracted
    if (isMockDraftProviderMode(process.env)) {
      extracted = mockFactExtraction(chapterIndex, proseBody)
    } else {
      const target = await resolveGenerationTarget({
        taskType: DRAFT_TASK_TYPE,
        principal: principal === null || principal === undefined ? undefined : { userId: principal.userId },
        env: process.env,
      })
      if (!target.available) {
        if (target.reason === 'no_provider_configured') {
          // 与 prose.edit.stream 前置闸同语义：真没配任何 provider 才笼统收口
          json(200, { ok: false, code: PROVIDER_UNAVAILABLE, error: 'provider unavailable: no draft provider configured' })
          return true
        }
        throw new Error(`PROVIDER_UNAVAILABLE: ${target.detail}`)
      }
      const abortController = new AbortController()
      res.on('close', () => abortController.abort())
      let raw = ''
      for await (const chunk of streamOpenAiChat(target.endpoint, buildFactExtractionUserPrompt(chapterIndex, proseBody), FACT_EXTRACTION_SYSTEM_PROMPT, abortController.signal)) {
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
    const result = insertFactCandidates(root, payload)
    json(200, {
      ok: true,
      runId,
      proseHash,
      inserted: result.inserted.length,
      voided: result.voided.length,
      candidates: result.inserted,
    })
  } catch (error) {
    json(502, { ok: false, code: 'FACT_EXTRACTION_FAILED', error: (error as Error).message })
  }
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

/** 从决断载荷解析编辑后内容；非法即 400。 */
function parseDecidePayload(raw: unknown): FactCandidatePayload | undefined | 'INVALID' {
  if (raw === null || typeof raw !== 'object') {
    return undefined
  }
  const item = raw as Record<string, unknown>
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
  if (path === '/api/facts.candidates') return handleCandidates(ctx)
  if (path === '/api/facts.decide') return handleDecide(ctx)
  if (path === '/api/facts.history') return handleHistory(ctx)
  return false
}
