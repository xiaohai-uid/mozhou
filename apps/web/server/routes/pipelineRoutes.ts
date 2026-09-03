/**
 * apps/web · 创作台、流式草稿、章节审查与回炉路由控制器。
 */
import type { RouteHandler } from '../router.js'
import {
  ChapterProductionSession,
  executeChapterReview,
  makeDraftProviderBinding,
  nextStepOf,
  QualityReworkLimitExceededError,
  recordAuthorCorrection,
  runDraftStep,
} from '@mozhou/pipeline'
import {
  CORRECTION_REASONS,
  hashProse,
  isQualityReviewCurrent,
  type CorrectionReason,
  type QualityPolicy,
  type QualityReviewReport,
} from '@mozhou/quality-engine'
import { proseChapterPath, readProseChapter } from '@mozhou/data-plane'
import { PublishBus, RuntimeEngine } from '@mozhou/runtime'
import type { CapabilityRecipe } from '@mozhou/runtime'
import { resolveChatEndpoint, streamOpenAiChat } from '../llm/openaiStream.js'
import { buildDraftContext } from '../draftContext.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIALOGUE_CAPABILITIES = [
  { id: 'continuation', label: '续写' },
  { id: 'sepia-write', label: 'sepia 架构创作' },
  { id: 'sepia-review', label: 'sepia 叙事诊断' },
  { id: 'sepia-refactor', label: 'sepia 就地去味' },
  { id: 'sepia-recreate', label: 'sepia 意图重写' },
  { id: 'suspense', label: '悬念调度' },
  { id: 'dialogue-polish', label: '对白打磨' },
  { id: 'atmosphere', label: '场景氛围' },
  { id: 'consistency', label: '一致性自查' },
]

export function hasDraftProvider(): boolean {
  const configured = process.env['MOZHOU_DRAFT_PROVIDER']
  const hasRealKey =
    Boolean(process.env['MOZHOU_API_KEY']) ||
    Boolean(process.env['DEEPSEEK_API_KEY']) ||
    Boolean(process.env['OPENAI_API_KEY'])
  if (configured !== 'mock' && !hasRealKey) return false

  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root: '/' } })
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: configured === 'mock' ? 'mock' : 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  })
  return true
}

function decoratePromptWithSkills(prompt: string, skills: readonly string[]): string {
  if (!skills || skills.length === 0) return prompt

  const constraints: string[] = []
  if (skills.includes('sepia-write')) {
    constraints.push('【sepia 架构创作】严格遵照三轮审查标准：Pass 1 消除主题说教，Pass 2 自然语篇流动，Pass 3 表层去机械套话。')
  }
  if (skills.includes('sepia-review')) {
    constraints.push('【sepia 叙事诊断】重点扫描正文中的 AI 套话特征与机械设问，输出精准段落级修改意见。')
  }
  if (skills.includes('sepia-refactor')) {
    constraints.push('【sepia 就地去味】Pass 3: 最小限度就地修正 AI 腔调，保留原有情节走向。')
  }
  if (skills.includes('sepia-recreate')) {
    constraints.push('【sepia 意图重写】依据大纲核心事实与作者意图，重构松弛自然的人类叙事。')
  }
  if (skills.includes('suspense')) {
    constraints.push('【悬念调度】强化章末留钩，前置伏笔并延迟信息揭露。')
  }
  if (skills.includes('dialogue-polish')) {
    constraints.push('【对白打磨】压缩交代性对白，增加潜台词与语调性格差异。')
  }

  if (constraints.length === 0) return prompt
  return `${constraints.join('\n')}\n\n${prompt}`
}

/**
 * 真实 provider 消费完整编译上下文；mock 仅用作者指令生成演示正文，避免把
 * ContextPacket 自身写回小说正文，但 start 帧仍暴露真实 modelPrompt 供契约审计。
 */
function makeStreamEngine(
  root: string,
  chapterIndex: number,
  modelPrompt: string,
  mockOutputSeed: string,
  onDelta: (text: string) => void,
): { engine: RuntimeEngine; recipe: CapabilityRecipe; real: boolean } {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_web_t44' })
  const recipe: CapabilityRecipe = {
    id: 'chapter-drafting',
    recipeVersion: '0.1.1',
    source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-09-03', refineNote: 'release hardening: compiled context' },
    brief: { capability: '正文草稿流式生成', runtimeSemantics: 'Context Compiler → provider；断流标 partial、半稿持久保留', triggers: ['draft'] },
    taskType: 'CHAPTER_DRAFTING',
    entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
    references: [],
    artifacts: [],
    prechecks: [],
    trackingGate: {
      authorityState: proseChapterPath(chapterIndex),
      casField: 'revision',
      transactionModes: ['append'],
      derivedViews: [],
      budgets: { hotContextBytes: 48_000, perChapterReads: [] },
      failureTaxonomy: 'validationFailed',
      hookPoint: 'postWrite',
    },
    contextBudget: { hotContextBytes: 48_000, fixedSections: [], perChapterReads: [] },
  }

  const explicitMock = process.env['MOZHOU_DRAFT_PROVIDER'] === 'mock'
  let real = false

  if (explicitMock) {
    engine.registerCapability({
      taskType: 'CHAPTER_DRAFTING',
      providerId: 'deepseek',
      providerVersion: '0.0.0',
      failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
    })
    engine.registerProviderBinding(
      'deepseek',
      makeDraftProviderBinding({
        bookRoot: root,
        chapterIndex,
        provider: 'deepseek',
        mode: 'generate',
        stream: () => mockDraftStream(mockOutputSeed, onDelta),
      }),
    )
  } else {
    const endpoint = resolveChatEndpoint(process.env)
    if (endpoint === null) {
      throw new Error('PROVIDER_UNAVAILABLE: 未配置真实 LLM Key（MOZHOU_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY）')
    }
    real = true
    engine.registerCapability({
      taskType: 'CHAPTER_DRAFTING',
      providerId: 'deepseek',
      providerVersion: '1.0.0',
      failurePolicy: { timeoutMs: 60_000, fallbackProviderIds: [] },
    })
    engine.registerProviderBinding(
      'deepseek',
      makeDraftProviderBinding({
        bookRoot: root,
        chapterIndex,
        provider: 'deepseek',
        mode: 'generate',
        stream: () =>
          (async function* () {
            const systemPrompt =
              '你是资深中文网文作者。输入已由墨舟 Context Compiler 按当前作品正典与章节状态装配。' +
              '严格遵守其中的事实、人物知识边界、承诺与作者指令；只输出本章正文，不复述上下文。' +
              '保持既有文风与节奏，禁止总结性陈词、禁止上帝视角预告、禁止否定排比与破折号滥用。'
            for await (const chunk of streamOpenAiChat(endpoint, modelPrompt, systemPrompt)) {
              if (chunk.delta.length > 0) {
                onDelta(chunk.delta)
                yield chunk.delta
              }
            }
          })(),
      }),
    )
  }

  return { engine, recipe, real }
}

function mockDraftStream(prompt: string, onDelta?: (text: string) => void): AsyncIterable<string> {
  const base = prompt.trim().length > 0 ? prompt.trim() : '夜雨敲窗，灯焰摇了三摇。'
  const chunks = [base.slice(0, 8), base.slice(8, 18) === '' ? base : base.slice(8, 18), base.slice(18)]
  return (async function* () {
    for (const chunk of chunks) {
      await Promise.resolve()
      if (chunk.length > 0) {
        onDelta?.(chunk)
        yield chunk
      }
    }
  })()
}

export const pipelineRoutes: RouteHandler = async (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/session.open') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (root === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
      return true
    }
    try {
      const session = ChapterProductionSession.start({ bus: new PublishBus(), root, chapterIndex })
      json(200, { ok: true, taskRef: session.taskRef, currentStep: session.currentStep, chapterIndex })
    } catch (error) {
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  if (path === '/api/session.advance') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (root === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
      return true
    }
    const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
    if (session === null) {
      json(409, { ok: false, error: 'chapter ' + chapterIndex + ' has no open production session' })
      return true
    }
    try {
      const target = nextStepOf(session.currentStep)
      if (target === null) {
        json(409, { ok: false, error: 'session already at terminal step ' + session.currentStep })
        return true
      }
      const previousStep = session.currentStep
      session.advance(target)
      json(200, { ok: true, previousStep, currentStep: session.currentStep })
    } catch (error) {
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  if (path === '/api/capabilities') {
    json(200, { ok: true, capabilities: DIALOGUE_CAPABILITIES, providerAvailable: hasDraftProvider() })
    return true
  }

  if (path === '/api/draft.question') {
    const prompt = typeof body['prompt'] === 'string' ? body['prompt'].trim() : ''
    const defaultQuestions = [
      {
        id: 'q1',
        title: '场景主基调与冲突烈度',
        hint: '决定本段节奏与动作展开形式',
        choices: ['平静暗涌·细节伏笔', '正面交锋·剑拔弩张', '突发异变·惊悚悬疑', '日常幽默·性格反差'],
      },
      {
        id: 'q2',
        title: '主角行动决策',
        hint: '影响后续叙事因果与收益',
        choices: ['果断出手·斩草除根', '隐忍蛰伏·借刀杀人', '佯装不知·反向做局', '顺水推舟·试探虚实'],
      },
    ]

    json(200, {
      ok: true,
      prompt,
      question: '请先确定本段主基调与节奏方向：',
      choices: defaultQuestions[0]?.choices ?? [],
      questions: defaultQuestions,
    })
    return true
  }

  if (path === '/api/draft.stream') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const rawPrompt = typeof body['prompt'] === 'string' ? body['prompt'].trim() : ''
    const activeSkills = Array.isArray(body['activeSkills'])
      ? (body['activeSkills'] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : []
    const authorPrompt = decoratePromptWithSkills(rawPrompt, activeSkills)

    if (root === null || chapterIndex === null || !Number.isInteger(chapterIndex) || chapterIndex < 1) {
      json(400, { ok: false, error: 'valid root and chapterIndex required' })
      return true
    }

    if (!hasDraftProvider()) {
      json(200, {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        error: 'provider unavailable: no draft provider configured',
      })
      return true
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    const ndjson = (payload: unknown) => { res.write(JSON.stringify(payload) + '\n') }

    try {
      const context = await buildDraftContext({ root, chapterIndex, authorPrompt })
      const { engine, recipe, real } = makeStreamEngine(
        root,
        chapterIndex,
        context.packet.text,
        authorPrompt,
        (delta) => ndjson({ ok: true, event: 'delta', text: delta }),
      )

      ndjson({
        ok: true,
        event: 'start',
        prompt: context.packet.text,
        contextMode: context.mode,
        contextTokens: context.packet.totalTokens,
        provider: real ? 'real-openai-compatible' : 'mock',
      })
      const outcome = await runDraftStep({
        engine,
        bookRoot: root,
        chapterIndex,
        packet: context.packet,
        recipe,
      })
      ndjson({ ok: true, event: 'done', outcome: outcome.outcome, partial: outcome.partial, chars: outcome.chars })
      res.end()
    } catch (error) {
      ndjson({ ok: false, event: 'error', error: (error as Error).message })
      res.end()
    }
    return true
  }

  /* ---- 文学质量审查与回炉 ---- */
  if (path === '/api/chapter.review') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (root === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
      return true
    }
    const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
    if (session === null) {
      json(409, { ok: false, error: 'chapter ' + chapterIndex + ' has no open production session' })
      return true
    }
    if (session.currentStep === 'draft') session.advance('review')
    if (session.currentStep !== 'review') {
      json(409, { ok: false, error: 'review requires session at draft|review, got ' + session.currentStep })
      return true
    }
    const receiptId = session.project().lastReceiptId ?? 'rcpt_web_' + String(chapterIndex)
    const rawPolicy = body['policy'] as QualityPolicy | undefined
    const policy =
      rawPolicy !== undefined &&
      rawPolicy.schemaVersion === 1 &&
      rawPolicy.maxAutomaticReworks === 2 &&
      Array.isArray(rawPolicy.rules)
        ? rawPolicy
        : undefined

    const outcome = await executeChapterReview({
      bookRoot: root,
      chapterIndex,
      session,
      receiptId,
      reviewer: { providerId: 'web', model: 'web-direct', recipeVersion: '0.0.0' },
      ...(policy !== undefined ? { policy } : {}),
      autoHarvestQuotes: true,
      autoAbsorbCounterexamples: true,
    })
    const projection = session.project()
    const failed = outcome.report.evaluations.filter((e) => e.verdict === 'fail')

    json(200, {
      ok: true,
      verdict: outcome.report.verdict,
      reportId: outcome.report.reportId,
      reportPath: outcome.reportRelPath,
      draftRevision: outcome.input.revision,
      draftContentHash: outcome.report.anchor.draftContentHash,
      reworkCount: projection.qualityReworkCount,
      current: true,
      blockingFailures: failed.filter((e) => e.severity === 'blocking'),
      advisories: failed.filter((e) => e.severity === 'advisory'),
      semanticReviewer: 'unavailable',
      mechanicalGate: outcome.mechanicalGate,
    })
    return true
  }

  if (path === '/api/chapter.rework') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (root === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
      return true
    }
    const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
    if (session === null) {
      json(409, { ok: false, error: 'chapter ' + chapterIndex + ' has no open production session' })
      return true
    }
    try {
      session.requestQualityRework()
    } catch (error) {
      if (error instanceof QualityReworkLimitExceededError) {
        json(422, { ok: false, code: 'QualityReworkLimitExceeded', error: error.message })
        return true
      }
      throw error
    }
    json(200, { ok: true, currentStep: session.currentStep, reworkCount: session.project().qualityReworkCount })
    return true
  }

  if (path === '/api/chapter.corrections') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const reasons = Array.isArray(body['reasons']) ? (body['reasons'] as string[]) : []
    const note = typeof body['note'] === 'string' ? body['note'] : undefined

    if (root === null || chapterIndex === null || reasons.length === 0) {
      json(400, { ok: false, error: 'root, chapterIndex, and non-empty reasons required' })
      return true
    }

    const isCorrectionReason = (r: unknown): r is CorrectionReason =>
      typeof r === 'string' && (CORRECTION_REASONS as readonly string[]).includes(r)

    const invalid = reasons.filter((r) => !isCorrectionReason(r))
    if (invalid.length > 0) {
      json(400, { ok: false, error: 'invalid correction reasons: ' + invalid.map(String).join(', ') })
      return true
    }

    const typedReasons = reasons as CorrectionReason[]
    const bus = new PublishBus()
    const outcome = recordAuthorCorrection({
      bus,
      bookRoot: root,
      taskRef: 'tsk_web_correction_' + String(chapterIndex),
      chapterIndex,
      reasons: typedReasons,
      ...(note ? { note } : {}),
    })

    json(200, {
      ok: true,
      recorded: 1,
      reportId: outcome.reportId,
      revision: outcome.revision,
      ...(outcome.noteDigest ? { noteDigest: outcome.noteDigest } : {}),
    })
    return true
  }

  if (path === '/api/chapter.quality') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (root === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
      return true
    }

    const reviewsDir = join(root, '.mozhou', 'quality-reviews', `chapter_${chapterIndex}`)
    if (!existsSync(reviewsDir)) {
      json(200, { ok: true, status: 'no_review', report: null, current: false })
      return true
    }

    const files = readdirSync(reviewsDir).filter((f) => f.startsWith('report_') && f.endsWith('.json')).sort()
    if (files.length === 0) {
      json(200, { ok: true, status: 'no_review', report: null, current: false })
      return true
    }

    const latestFile = files[files.length - 1]!
    const report = JSON.parse(readFileSync(join(reviewsDir, latestFile), 'utf8')) as QualityReviewReport
    const proseObj = readProseChapter(root, proseChapterPath(chapterIndex))
    const current = isQualityReviewCurrent(report, {
      draftRevision: proseObj.revision,
      draftContentHash: hashProse(proseObj.body),
    })

    json(200, {
      ok: true,
      status: current ? 'current' : 'stale',
      report,
      current,
    })
    return true
  }

  return false
}
