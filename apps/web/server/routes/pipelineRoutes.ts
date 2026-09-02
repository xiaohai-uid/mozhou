/**
 * apps/web · 创作台、流式草稿、章节审查与回炉路由控制器。
 */
import type { RouteHandler } from '../router.js'
import {
  ChapterProductionSession,
  executeChapterReview,
  makeDraftProviderBinding,
  QualityReworkLimitExceededError,
  recordAuthorCorrection,
  runDraftStep,
} from '@mozhou/pipeline'
import { CORRECTION_REASONS, hashProse, isQualityReviewCurrent, type QualityPolicy } from '@mozhou/quality-engine'
import { proseChapterPath, readProseChapter } from '@mozhou/data-plane'
import { NoProviderError, PublishBus, RuntimeEngine } from '@mozhou/runtime'
import type { CapabilityRecipe } from '@mozhou/runtime'
import type { ContextPacket } from '@mozhou/context-compiler'
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

function makeMockEngine(
  root: string,
  chapterIndex: number,
  prompt: string,
  onDelta: (text: string) => void,
): { engine: RuntimeEngine; recipe: CapabilityRecipe } {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_web_t44' })
  const recipe: CapabilityRecipe = {
    id: 'chapter-drafting',
    recipeVersion: '0.1.0',
    source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-08-25', refineNote: 'T44 web mock' },
    brief: { capability: '正文草稿流式生成', runtimeSemantics: '断流标 partial、半稿持久保留', triggers: ['draft'] },
    taskType: 'CHAPTER_DRAFTING',
    entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
    references: [],
    artifacts: [],
    prechecks: [],
    trackingGate: {
      authorityState: '正文/第一卷/第0001章.md',
      casField: 'revision',
      transactionModes: ['append'],
      derivedViews: [],
      budgets: { hotContextBytes: 8192, perChapterReads: [] },
      failureTaxonomy: 'validationFailed',
      hookPoint: 'postWrite',
    },
    contextBudget: { hotContextBytes: 8192, fixedSections: [], perChapterReads: [] },
  }
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'mock',
    providerVersion: '0.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  })
  engine.registerProviderBinding(
    'mock',
    makeDraftProviderBinding({ bookRoot: root, chapterIndex, provider: 'deepseek', mode: 'generate', stream: () => mockDraftStream(prompt, onDelta) }),
  )
  return { engine, recipe }
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

  if (path === '/api/capabilities') {
    json(200, {
      ok: true,
      capabilities: DIALOGUE_CAPABILITIES,
      providerAvailable: hasDraftProvider(),
    })
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
    const activeSkills = Array.isArray(body['activeSkills']) ? (body['activeSkills'] as string[]) : []
    const prompt = decoratePromptWithSkills(rawPrompt, activeSkills)

    if (root === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
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

    const ndjson = (payload: unknown) => {
      res.write(JSON.stringify(payload) + '\n')
    }

    try {
      const { engine, recipe } = makeMockEngine(root, chapterIndex, prompt, (delta) => {
        ndjson({ ok: true, event: 'delta', text: delta })
      })

      ndjson({ ok: true, event: 'start', prompt })
      const outcome = await runDraftStep({
        engine,
        bookRoot: root,
        chapterIndex,
        packet: {
          taskType: 'CHAPTER_DRAFTING',
          chapterIndex,
          structural: [],
          settings: [],
          story: { text: '', tokens: 0, trimType: 'none' },
          text: prompt,
          totalTokens: prompt.length,
        } satisfies ContextPacket,
        recipe,
      })
      ndjson({ ok: true, event: 'done', outcome: outcome.outcome, partial: outcome.partial, chars: outcome.chars })
      res.end()
    } catch (error) {
      ndjson({ ok: true, event: 'error', error: (error as Error).message })
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
    json(200, {
      ok: true,
      currentStep: session.currentStep,
      reworkCount: session.project().qualityReworkCount,
    })
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

    const invalid = reasons.filter((r) => !CORRECTION_REASONS.includes(r as any))
    if (invalid.length > 0) {
      json(400, { ok: false, error: 'invalid correction reasons: ' + invalid.join(', ') })
      return true
    }

    const bus = new PublishBus()
    const outcome = recordAuthorCorrection({
      bus,
      bookRoot: root,
      taskRef: 'tsk_web_correction_' + String(chapterIndex),
      chapterIndex,
      reasons: reasons as any,
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
    const report = JSON.parse(readFileSync(join(reviewsDir, latestFile), 'utf8'))
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
