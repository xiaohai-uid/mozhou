/**
 * 行内选区 AI 编辑契约（CHG-20261006-02 /api/prose.edit.stream）。
 *
 * 契约语义（specs/002 FR-3 行内 AI 链路）：
 * - 入参：root + chapterIndex + action + selectedText + selectionRange +
 *   surroundingContext（可选）+ customInstruction（action=custom 时必填）；
 * - 四个预设动作（描写强化/情绪提纯/对白调优/剧情反转）与自定义指令进**同一契约**；
 * - 输出只产生 Candidate（NDJSON 流式文本帧）——**绝不写盘、绝不自动覆盖正文**；
 *   Accept/Reject 由作者在前端 InlineDiffViewer 决断，落稿走既有 revision-safe save。
 *
 * Provider 接缝（与 /api/draft.stream 单缝同源）：
 * - mock 判据共用 pipelineRoutes.isMockDraftProviderMode（仅非生产成立）；
 * - 真实分支走 resolveGenerationTarget（注册表→BYOK 单缝）+ streamOpenAiChat
 *   （内置 HTTPS-only + 私有/环回地址 SSRF 门，满足服务端 URL 约束）；
 * - 仅 no_provider_configured 用笼统 PROVIDER_UNAVAILABLE 收口（draft.stream 前置闸同语义），
 *   配了但解析不出的病因进 NDJSON error 帧，不用笼统码掩盖。
 */
import type { RouteHandler } from '../router.js'
import { decodeBookRequest } from '../bookRequest.js'
import { INVALID_BOOK_REQUEST, PROVIDER_UNAVAILABLE } from '../routeCodes.js'
import { createCandidateId, presentCandidates, recordCandidateDecision } from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'
import { runPreferenceLearning } from '@mozhou/flywheel'
import { resolveGenerationTarget } from '../llm/generationTarget.js'
import { DRAFT_TASK_TYPE } from '../llm/tierRouting.js'
import { streamOpenAiChat } from '../llm/openaiStream.js'
import { isMockDraftProviderMode } from './pipelineRoutes.js'
import { emptyDraftStream, mockProseEditStream } from './draftStreamEmulation.js'

/** 行内编辑动作族：四预设 + 自定义，一个契约。 */
export const PROSE_EDIT_ACTIONS = ['sensory_expansion', 'deslop_sharpen', 'dialogue_polish', 'plot_twist', 'custom'] as const
export type ProseEditAction = (typeof PROSE_EDIT_ACTIONS)[number]

/** 防滥用与成本护栏上限（纯文本字符数）。 */
export const PROSE_EDIT_LIMITS = {
  selectedText: 20_000,
  surroundingContext: 4_000,
  customInstruction: 2_000,
} as const

/** 动作 → 中文编辑指令模板（四预设的语义收敛点；自定义动作指令来自作者输入）。 */
export function proseEditActionPrompt(action: ProseEditAction, customInstruction: string | undefined): string {
  switch (action) {
    case 'sensory_expansion':
      return '增强选中片段的感官细节（视觉、听觉、嗅觉、触觉），以具体意象替代抽象陈述；不得引入原片段没有的情节数据。'
    case 'deslop_sharpen':
      return '删除选中片段中的空洞修辞、重复形容词与套话，压缩为更锋利的表达；情节信息一项不丢。'
    case 'dialogue_polish':
      return '强化选中片段中的人物声线与潜台词，压缩交代性对白；保持人物关系与已知设定不变。'
    case 'plot_twist':
      return '在选中片段基础上引入一个冲突变数或反转伏笔；不得新增人物、能力或与前文矛盾的事实。'
    case 'custom':
      return `按作者指令修改选中片段：${customInstruction ?? ''}`
  }
}

const SYSTEM_PROMPT =
  '你是资深中文网文编辑。只输出替换后的正文片段本身：不要解释、不要引号包裹、不要前缀或后缀、不要复述指令。' +
  '保持与上下文一致的叙事人称与文风；不得增删选中片段之外的情节数据。'

/** 请求形状校验结果（合法 → 归一化载荷；非法 → 400 理由）。 */
export interface ProseEditPayload {
  readonly root: string
  readonly chapterIndex: number
  readonly action: ProseEditAction
  readonly selectedText: string
  readonly selectionRange: { readonly from: number; readonly to: number }
  readonly surroundingContext: string
  readonly customInstruction?: string
}

export function validateProseEditRequest(body: Record<string, unknown>): { ok: true; value: Omit<ProseEditPayload, 'root' | 'chapterIndex'> } | { ok: false; error: string } {
  const action = body['action']
  if (typeof action !== 'string' || !(PROSE_EDIT_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: `action must be one of: ${PROSE_EDIT_ACTIONS.join(', ')}` }
  }
  const selectedText = body['selectedText']
  if (typeof selectedText !== 'string' || selectedText.trim().length === 0) {
    return { ok: false, error: 'selectedText must be a non-empty string' }
  }
  if (selectedText.length > PROSE_EDIT_LIMITS.selectedText) {
    return { ok: false, error: `selectedText exceeds ${PROSE_EDIT_LIMITS.selectedText} chars` }
  }
  const rawRange = body['selectionRange']
  const range = rawRange !== null && typeof rawRange === 'object' ? (rawRange as Record<string, unknown>) : undefined
  const from = range === undefined ? Number.NaN : Number(range['from'])
  const to = range === undefined ? Number.NaN : Number(range['to'])
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    return { ok: false, error: 'selectionRange must be { from, to } integers with 0 <= from <= to' }
  }
  const surroundingContext = body['surroundingContext']
  if (surroundingContext !== undefined && (typeof surroundingContext !== 'string' || surroundingContext.length > PROSE_EDIT_LIMITS.surroundingContext)) {
    return { ok: false, error: `surroundingContext must be a string within ${PROSE_EDIT_LIMITS.surroundingContext} chars` }
  }
  const customInstruction = body['customInstruction']
  if (action === 'custom' && (typeof customInstruction !== 'string' || customInstruction.trim().length === 0)) {
    return { ok: false, error: 'customInstruction is required when action is custom' }
  }
  if (typeof customInstruction === 'string' && customInstruction.length > PROSE_EDIT_LIMITS.customInstruction) {
    return { ok: false, error: `customInstruction exceeds ${PROSE_EDIT_LIMITS.customInstruction} chars` }
  }
  return {
    ok: true,
    value: {
      action: action as ProseEditAction,
      selectedText,
      selectionRange: { from, to },
      surroundingContext: typeof surroundingContext === 'string' ? surroundingContext : '',
      ...(typeof customInstruction === 'string' ? { customInstruction } : {}),
    },
  }
}

/** 真实 provider 的用户提示词装配（四动作 + 自定义同构）。 */
export function buildProseEditUserPrompt(payload: Omit<ProseEditPayload, 'root' | 'chapterIndex'>): string {
  const parts = [
    `【任务】${proseEditActionPrompt(payload.action, payload.customInstruction)}`,
    `【选中片段】\n${payload.selectedText}`,
  ]
  if (payload.surroundingContext.trim().length > 0) {
    parts.push(`【上下文】\n${payload.surroundingContext}`)
  }
  if (payload.action !== 'custom' && payload.customInstruction !== undefined && payload.customInstruction.trim().length > 0) {
    parts.push(`【作者补充指令】${payload.customInstruction.trim()}`)
  }
  return parts.join('\n\n')
}

export const proseEditRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot, principal }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  if (path === '/api/prose.edit.decision') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const rawCandidateId = body['editCandidateId'] ?? body['candidateId']
    const candidateId = typeof rawCandidateId === 'string' ? rawCandidateId.trim() : ''
    const decision = body['decision']
    if (candidateId.length === 0) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'editCandidateId or candidateId is required' })
      return true
    }
    if (decision !== 'accepted' && decision !== 'rejected') {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: "decision must be 'accepted' or 'rejected'" })
      return true
    }
    const selectedText = typeof body['selectedText'] === 'string' ? body['selectedText'] : ''
    const proposedText = typeof body['proposedText'] === 'string' ? body['proposedText'] : ''
    const rawLevel = body['level']
    const level = rawLevel === 'cursor' || rawLevel === 'selection' ? rawLevel : 'selection'

    try {
      const outcome = recordProseEditDecision({
        root,
        chapterIndex,
        candidateId,
        decision,
        selectedText,
        proposedText,
        level,
      })
      json(200, {
        ok: true,
        candidateId,
        editCandidateId: candidateId,
        decision,
        taskRef: outcome.taskRef,
        acceptedOptionIds: outcome.decisionResult.acceptedOptionIds,
        rejectedOptionIds: outcome.decisionResult.rejectedOptionIds,
      })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  if (path !== '/api/prose.edit.stream') return false

  const validated = validateProseEditRequest(body)
  if (!validated.ok) {
    json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: validated.error })
    return true
  }
  const payload = validated.value

  const candidateId = createCandidateId()

  // 前置闸：仅「真没配任何 provider」笼统收口；配了但解析不出放行进流，病因走 error 帧。
  if (!isMockDraftProviderMode(process.env)) {
    const probe = await resolveGenerationTarget({
      taskType: DRAFT_TASK_TYPE,
      principal: principal === null || principal === undefined ? undefined : { userId: principal.userId },
      env: process.env,
    })
    if (!probe.available && probe.reason === 'no_provider_configured') {
      json(200, { ok: false, code: PROVIDER_UNAVAILABLE, error: 'provider unavailable: no draft provider configured' })
      return true
    }
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  const ndjson = (frame: Record<string, unknown>) => {
    res.write(JSON.stringify(frame) + '\n')
  }
  const abortController = new AbortController()
  res.on('close', () => abortController.abort())

  try {
    const mock = isMockDraftProviderMode(process.env)
    // mock-empty = 「上游 HTTP 200 但零 delta」的静默空输出回归缝（与 draft.stream 同语义，
    // 仅非生产成立）：走空流，让空流门产出 error 帧——不给「完成的空候选」。
    const emptyMock =
      process.env['MOZHOU_DRAFT_PROVIDER'] === 'mock-empty' && process.env['NODE_ENV'] !== 'production'
    ndjson({ ok: true, event: 'start', candidateId, action: payload.action, provider: mock ? 'mock' : 'real-openai-compatible' })

    let produced = 0
    if (mock) {
      const onDelta = (d: string): void => {
        produced += d.length
        ndjson({ ok: true, event: 'delta', candidateId, text: d })
      }
      const source = emptyMock ? emptyDraftStream() : mockProseEditStream(payload.selectedText, onDelta)
      for await (const chunk of source) {
        void chunk
      }
    } else {
      const target = await resolveGenerationTarget({
        taskType: DRAFT_TASK_TYPE,
        principal: principal === null || principal === undefined ? undefined : { userId: principal.userId },
        env: process.env,
      })
      if (!target.available) {
        throw new Error(`PROVIDER_UNAVAILABLE: ${target.detail}`)
      }
      const userPrompt = buildProseEditUserPrompt(payload)
      for await (const chunk of streamOpenAiChat(target.endpoint, userPrompt, SYSTEM_PROMPT, abortController.signal)) {
        if (chunk.delta.length > 0) {
          produced += chunk.delta.length
          ndjson({ ok: true, event: 'delta', candidateId, text: chunk.delta })
        }
      }
    }

    // 空流门（与 draft.stream 判帧纪律一致：没给出正文就是失败，不给「完成的空候选」）。
    if (produced === 0) {
      ndjson({ ok: false, event: 'error', candidateId, error: 'provider returned an empty stream' })
    } else {
      ndjson({ ok: true, event: 'done', candidateId, action: payload.action, chars: produced })
    }
    res.end()
  } catch (error) {
    ndjson({ ok: false, event: 'error', candidateId, error: (error as Error).message })
    res.end()
  }
  return true
}

export interface ProseEditDecisionPayload {
  readonly root: string
  readonly chapterIndex: number
  readonly candidateId: string
  readonly decision: 'accepted' | 'rejected'
  readonly selectedText: string
  readonly proposedText: string
  readonly level?: 'selection' | 'cursor'
}

export function recordProseEditDecision(payload: ProseEditDecisionPayload): {
  taskRef: string
  decisionResult: { readonly acceptedOptionIds: readonly string[]; readonly rejectedOptionIds: readonly string[] }
} {
  const bus = new PublishBus()
  const taskRef = `inline_edit_ch${payload.chapterIndex}_${payload.candidateId}`
  const level = payload.level ?? 'selection'
  const origCandidateId = `orig_${payload.candidateId}`

  presentCandidates(
    { bus, bookRoot: payload.root, taskRef, chapterIndex: payload.chapterIndex },
    {
      level,
      options: [
        { candidateId: origCandidateId, text: payload.selectedText },
        { candidateId: payload.candidateId, text: payload.proposedText },
      ],
    },
  )

  const decisionResult = recordCandidateDecision(
    { bus, bookRoot: payload.root, taskRef, chapterIndex: payload.chapterIndex },
    {
      level,
      acceptedOptionIds: payload.decision === 'accepted' ? [payload.candidateId] : [origCandidateId],
      rejectedOptionIds: payload.decision === 'accepted' ? [origCandidateId] : [payload.candidateId],
    },
  )

  try {
    runPreferenceLearning(payload.root)
  } catch {
    // 偏好折叠失败不阻断决策记录
  }

  return { taskRef, decisionResult }
}
