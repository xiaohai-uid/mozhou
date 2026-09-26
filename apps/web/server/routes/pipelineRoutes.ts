/**
 * apps/web · 创作台、流式草稿、章节审查与回炉路由控制器。
 *
 * 步 8 提案队列确认面（chapter-pipeline-spec §1 表第 8 行 / S6）：
 * 管线 Canon 提案（.mozhou/proposals/prp_*.json）经 ProposalPort 统一确认面
 * 逐条 confirm / reject / editAccept——headless 等价 panel。提交路由在待决时
 * 以 409 挂起，作者在此逐条决毕后重提提交；Commit 只写已确认集。
 * 三动词的语义（含 editAccept 空 patch 违例、已决条目拒改）全部归 Port，
 * 本路由只做请求形状校验与错误码映射，不复制确认协议。
 */
import type { RouteHandler } from '../router.js'
import {
  AcceptConflictError,
  CandidateError,
  ChapterProductionSession,
  ProposalPort,
  ProposalPortError,
  acceptDraft,
  cancelCandidate,
  createCandidateId,
  executeChapterReview,
  loadCanonProposal,
  makeDraftProviderBinding,
  nextStepOf,
  QualityReworkLimitExceededError,
  readDraftCandidate,
  recordAuthorCorrection,
  runDraftStep,
  type CandidateMode,
  type WriteBase,
} from '@mozhou/pipeline'
import {
  CORRECTION_REASONS,
  hashProse,
  queryChapterQualityStatus,
  type CorrectionReason,
  type QualityPolicy,
} from '@mozhou/quality-engine'
import { proseChapterPath, readProseChapter } from '@mozhou/data-plane'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PublishBus, RuntimeEngine, createDraftRecipe, toProviderOverride } from '@mozhou/runtime'
import type { CapabilityRecipe } from '@mozhou/runtime'
import { resolveChatEndpoint, streamOpenAiChat } from '../llm/openaiStream.js'
import {
  resolveTierEndpoint,
  resolveDraftTierRoute,
  tierConfigPath,
  tierRouteTraceLine,
} from '../llm/tierRouting.js'
import type { ResolvedEndpoint } from '../llm/types.js'
import { buildDraftContext } from '../draftContext.js'
import { assertSafeBookRoot } from '../security.js'
import { canonProposalView } from '../proposals.js'

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

/** BYOK 密钥判据（与 providerSettings.resolveEndpointForUser 的候选变量同源）。 */
function hasByokDraftKey(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(env['MOZHOU_API_KEY']) ||
    Boolean(env['DEEPSEEK_API_KEY']) ||
    Boolean(env['OPENAI_API_KEY'])
  )
}

/**
 * 覆盖层能否解析出一条**可用**的 providerId → 端点路由（注册表能力独立可用的判据）。
 * 任何失败（结构非法 / 多叶子歧义 / api_key_ref / providerId 未登记 / baseURL 未过 SSRF 门禁 /
 * apiKeyEnv 缺失）都收敛成 false——本函数只回答「能不能生成」，病因留给真正生成时上抛。
 */
async function hasResolvableTierRoute(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const route = await resolveDraftTierRoute(env)
    if (route === null) return false
    resolveTierEndpoint(route, env)
    return true
  } catch {
    return false
  }
}

/**
 * 草稿 provider 可用性判据（`/api/capabilities`、`/api/capability-square` 的 `providerAvailable`
 * 与 `/api/draft.stream` 前置闸共用）——回答「现在能不能真的生成」：
 *   - `MOZHOU_DRAFT_PROVIDER=mock` ⇒ true（既有显式开关，不参与分级路由选档）；
 *   - BYOK 密钥齐备 ⇒ true（既有语义不变）；
 *   - 否则看覆盖层 `~/.mozhou/settings.yaml`：无该文件 ⇒ false（维持 BYOK 判据，行为不变）；
 *     有该文件且叶子 providerId 能经 `providers:` 注册表解析出可用端点 ⇒ true。
 *
 * 为什么要认注册表：端点身份已由 providerId 决定（见 llm/tierRouting.ts），所以「有没有可用的
 * 草稿 provider」的判据必须把注册表算进去——否则「只用注册表、不配 BYOK」的部署会被挡在门外，
 * 等于注册表能力独立不可用。判据取**可解析性**而非「文件存在」：配了但解析不出来时返回 false，
 * 不让 UI 报出与实际不符的能力声明。
 *
 * 同步 → 异步：判据要读 YAML 才能回答，故本函数与它的 3 个调用点一并改为 async（改动面：
 * 本文件的 `/api/capabilities` 与 `/api/draft.stream` 前置闸，以及 `systemRoutes.ts` 的
 * `/api/capability-square`——三处均已在 async 路由处理器内，`router.ts` 的 dispatch 会 await）。
 */
export async function hasDraftProvider(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const configured = env['MOZHOU_DRAFT_PROVIDER']
  const hasRealKey = hasByokDraftKey(env)
  if (configured !== 'mock' && !hasRealKey) {
    if (!(await hasResolvableTierRoute(env))) return false
  }

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

/** 正文 raw 文件 sha256（与 accept 落盘校验同源；base.sha256 的唯一合法默认）。 */
function hashProseRaw(root: string, chapterIndex: number): string {
  return createHash('sha256').update(readFileSync(join(root, proseChapterPath(chapterIndex)))).digest('hex')
}

/**
 * 真实 provider 消费完整编译上下文；mock 仅用作者指令生成演示正文，避免把
 * ContextPacket 自身写回小说正文，但 start 帧仍暴露真实 modelPrompt 供契约审计。
 * C2（T04）：stream 只 append 候选（candidate 上下文必传，缺省拒绝绑定）；
 * signal 在请求断开/显式取消时中止上游。
 *
 * T14 接线：真实分支的 providerId/model/端点不再硬编码——先读全局覆盖层
 * （`~/.mozhou/settings.yaml`，见 llm/tierRouting.ts）解析 CHAPTER_DRAFTING 的活动路由：
 *   - providerId ⇒ CapabilityRegistry.setGlobalOverride（包内默认 'deepseek' 仍是注册项，
 *     覆盖层只改解析结果，且覆盖后 GenerationStarted.snapshot.providerId 记的就是配置值）；
 *   - 端点（baseURL + 密钥）⇒ providers 注册表按**同一个** providerId 解析
 *     （resolveTierEndpoint）。账本 providerId 与实际出站端点因此同源，不再出现
 *     「账本说走 X、请求发往 BYOK 端点 Y」；未登记 / baseURL 非法 / apiKeyEnv 缺失 ⇒ 显式抛错；
 *   - 无配置文件 ⇒ 解析返回 null，本函数行为与接线前逐字节一致（BYOK 解析）。
 * mock 是显式「不调真实 provider」开关（测试/演示），不参与分级路由选档。
 */
async function makeStreamEngine(
  root: string,
  chapterIndex: number,
  modelPrompt: string,
  mockOutputSeed: string,
  onDelta: (text: string) => void,
  candidate: {
    id: string
    operationId: string
    bookId: string
    base: WriteBase
    mode: CandidateMode
    seedText?: string
    selection?: { readonly from: number; readonly to: number; readonly selectedTextHash: string }
  },
  signal?: AbortSignal,
): Promise<{ engine: RuntimeEngine; recipe: CapabilityRecipe; real: boolean }> {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_web_t44' })
  const recipe = createDraftRecipe({ proseRelPath: proseChapterPath(chapterIndex) })

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
        candidate,
        ...(signal === undefined ? {} : { signal }),
      }),
    )
  } else {
    // 包内默认（规格 §6 两级：包内默认 ← 全局覆盖）。默认项始终注册，覆盖层只改解析结果。
    const defaultProviderId = 'deepseek'
    const providerVersion = '1.0.0'

    const tierRoute = await resolveDraftTierRoute()
    let providerId: string
    let effectiveEndpoint: ResolvedEndpoint
    if (tierRoute === null) {
      // 无覆盖层文件 ⇒ 与接线前逐字节一致：BYOK 解析 + 包内默认 providerId。
      const endpoint = resolveChatEndpoint(process.env)
      if (endpoint === null) {
        throw new Error('PROVIDER_UNAVAILABLE: 未配置真实 LLM Key（MOZHOU_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY）')
      }
      providerId = defaultProviderId
      effectiveEndpoint = endpoint
    } else {
      // 有覆盖层文件 ⇒ 端点由 providers 注册表按 providerId 解析：**同一个** providerId 既作
      // 绑定键与账本快照（下方 registerProviderBinding + setGlobalOverride），又决定实际出站
      // baseURL 与 apiKey（resolveTierEndpoint 查同一份注册表）。二者同源 ⇒ 账本记的
      // providerId 就是实际服务的那一家，不存在「账本说 X、请求发 Y」。
      // 未登记 / baseURL 未过 SSRF 门禁 / apiKeyEnv 缺失一律显式抛错，绝不回落 BYOK
      // （见 llm/tierRouting.ts 的 TierProviderError）。
      providerId = tierRoute.selection.route.providerId
      effectiveEndpoint = resolveTierEndpoint(tierRoute, process.env)
      // 不许静默生效：留痕把 providerId 与实际出站端点并排写出（注册表落地后二者强制一致）。
      console.log(
        tierRouteTraceLine(tierRoute, {
          defaultProviderId,
          endpointBaseUrl: effectiveEndpoint.baseUrl,
        }),
      )
    }
    real = true

    engine.registerCapability({
      taskType: 'CHAPTER_DRAFTING',
      providerId: defaultProviderId,
      providerVersion,
      failurePolicy: { timeoutMs: 60_000, fallbackProviderIds: [] },
    })
    if (tierRoute !== null) {
      engine.registry.setGlobalOverride(toProviderOverride(tierRoute.selection, providerVersion))
    }
    engine.registerProviderBinding(
      providerId,
      makeDraftProviderBinding({
        bookRoot: root,
        chapterIndex,
        // 绑定键 = 路由解析出的 providerId（账本快照同源），也是 resolveTierEndpoint 查
        // providers 注册表用的那个 key ⇒ 绑定身份与实际出站端点由同一个字符串决定。
        // 但 opts.provider 只作**错误分类学**选择器（draft-step.ts:260 →
        // normalizeProviderError 三家表），本接线不改传输层知识：OpenAI-compatible 上游
        // 沿用既有 'deepseek' 直码档。
        provider: 'deepseek',
        mode: 'generate',
        stream: () =>
          (async function* () {
            const systemPrompt =
              '你是资深中文网文作者。输入已由墨舟 Context Compiler 按当前作品正典与章节状态装配。' +
              '严格遵守其中的事实、人物知识边界、承诺与作者指令；只输出本章正文，不复述上下文。' +
              '保持既有文风与节奏，禁止总结性陈词、禁止上帝视角预告、禁止否定排比与破折号滥用。'
            for await (const chunk of streamOpenAiChat(effectiveEndpoint, modelPrompt, systemPrompt, signal)) {
              if (chunk.delta.length > 0) {
                onDelta(chunk.delta)
                yield chunk.delta
              }
            }
          })(),
        candidate,
        ...(signal === undefined ? {} : { signal }),
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

export const pipelineRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  if (path === '/api/session.open') {
    const root = resolvedRoot
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
    const root = resolvedRoot
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

  /**
   * 会话窗口作废（S9 收口）：显式清掉本章挂起的活动会话窗口。
   *
   * 为何需要：requestResubmit / session.open 开的窗口只能由本会话第 9 步
   * CanonCommitted 或 TaskFinished 闭合，而 web 侧没有会话内 commit/finish 路由
   * （session.advance 也不携带门禁 verdict，故 continuity_gate→canon_proposal 恒被
   * GateNotPassedError 拒）——窗口一旦开出就占住 V1 全局单飞，别章开卷恒 409。
   * 作废是「放弃未完成」，与「完成」正交：发布 TaskFinished{outcome:'abandoned', reason}
   * 闭合 TaskStarted 配对并释放单飞，**绝不发 CanonCommitted**（完成态语义不动）。
   *
   * 幂等：无活动窗口、或活动窗口属别章 ⇒ abandoned:false 的空操作 200（运维可重复
   * 调用清理）；reason 落账留痕（缺省 author_abandoned），显式给空串即 400。
   */
  if (path === '/api/session.abandon') {
    const root = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (root === null || chapterIndex === null || chapterIndex < 1) {
      json(400, { ok: false, error: 'root and integer chapterIndex >= 1 required' })
      return true
    }
    const rawReason = body['reason']
    if (rawReason !== undefined && (typeof rawReason !== 'string' || rawReason.trim().length === 0)) {
      json(400, { ok: false, error: 'reason must be a non-empty string when provided' })
      return true
    }
    const reason = typeof rawReason === 'string' ? rawReason.trim() : 'author_abandoned'
    try {
      const taskRef = ChapterProductionSession.abandonOpenWindow(
        { bus: new PublishBus(), root, chapterIndex },
        reason,
      )
      json(200, { ok: true, chapterIndex, abandoned: taskRef !== null, taskRef, reason })
    } catch (error) {
      json(500, { ok: false, error: (error as Error).message })
    }
    return true
  }

  if (path === '/api/capabilities') {
    json(200, { ok: true, capabilities: DIALOGUE_CAPABILITIES, providerAvailable: await hasDraftProvider() })
    return true
  }

  // 预设写作方向选项：本地模板提供，UI 以 choice-row 呈现为快捷回答（契约字段
  // DraftQuestionResponse.hint 的语义即「原型 choice-row」）。本端点不调用模型，
  // 也不按 prompt 生成追问——prompt 仅回显。
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
      hint: '预设写作方向选项（本地模板，非模型生成）',
      choices: defaultQuestions[0]?.choices ?? [],
      questions: defaultQuestions,
    })
    return true
  }

  if (path === '/api/draft.stream') {
    const root = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    const rawPrompt = typeof body['prompt'] === 'string' ? body['prompt'].trim() : ''
    const activeSkills = Array.isArray(body['activeSkills'])
      ? (body['activeSkills'] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : []
    const authorPrompt = decoratePromptWithSkills(rawPrompt, activeSkills)

    // C2（T04）：候选请求字段
    const rawMode = body['mode']
    const mode: CandidateMode =
      rawMode === 'replace' || rawMode === 'continue' || rawMode === 'insert' || rawMode === 'replace-selection'
        ? rawMode
        : 'replace'
    const rawBase = body['base'] as { revision?: unknown; sha256?: unknown } | undefined
    const hasClientBase = rawBase !== null && typeof rawBase === 'object'
    const rawSelection = body['selection'] as { from?: unknown; to?: unknown; selectedTextHash?: unknown } | undefined
    const selection =
      rawSelection !== null && typeof rawSelection === 'object'
        ? { from: Number(rawSelection.from), to: Number(rawSelection.to), selectedTextHash: String(rawSelection.selectedTextHash) }
        : undefined

    if (root === null || chapterIndex === null || !Number.isInteger(chapterIndex) || chapterIndex < 1) {
      json(400, { ok: false, error: 'valid root and chapterIndex required' })
      return true
    }
    const safeRoot = assertSafeBookRoot(root)
    if (mode === 'replace-selection') {
      if (!selection || !Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to < selection.from) {
        json(400, { ok: false, error: 'replace-selection requires valid selection { from, to, selectedTextHash }' })
        return true
      }
    }

    if (!(await hasDraftProvider())) {
      // 覆盖层文件存在却判否 ⇒ 是「配了但解析不出来」，不是「没配任何 provider」。
      // 放行进真实分支，让 resolveDraftTierRoute / resolveTierEndpoint 抛出带键路径的精确
      // 错误（NDJSON error 帧），而不是用笼统的 PROVIDER_UNAVAILABLE 掩盖病因。
      if (!existsSync(tierConfigPath())) {
        json(200, {
          ok: false,
          code: 'PROVIDER_UNAVAILABLE',
          error: 'provider unavailable: no draft provider configured',
        })
        return true
      }
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    const ndjson = (payload: unknown) => { res.write(JSON.stringify(payload) + '\n') }

    try {
      const context = await buildDraftContext({ root: safeRoot, chapterIndex, authorPrompt })
      // base：缺省取盘面现场（旧客户端/回归脚本兼容）；sha256 与 accept 落盘校验
      // 同源（正文 raw 文件指纹），避免规范化差异导致 accept 假冲突
      const onDisk = readProseChapter(safeRoot, proseChapterPath(chapterIndex))
      const rawFileHash = hashProseRaw(safeRoot, chapterIndex)
      const base: WriteBase = {
        revision: hasClientBase ? Number(rawBase?.revision) : onDisk.revision,
        sha256: hasClientBase ? String(rawBase?.sha256) : rawFileHash,
      }
      const candidateId = createCandidateId()
      const abortController = new AbortController()
      res.on('close', () => abortController.abort())
      const { engine, recipe, real } = await makeStreamEngine(
        safeRoot,
        chapterIndex,
        context.packet.text,
        authorPrompt,
        (delta) => ndjson({ ok: true, event: 'delta', candidateId, text: delta }),
        {
          id: candidateId,
          operationId: 'op_web_' + candidateId,
          bookId: 'book-local',
          base,
          mode,
          ...(selection === undefined ? {} : { selection }),
        },
        abortController.signal,
      )

      ndjson({
        ok: true,
        event: 'start',
        candidateId,
        prompt: context.packet.text,
        contextMode: context.mode,
        contextTokens: context.packet.totalTokens,
        provider: real ? 'real-openai-compatible' : 'mock',
        base,
      })
      const outcome = await runDraftStep({
        engine,
        bookRoot: safeRoot,
        chapterIndex,
        packet: context.packet,
        recipe,
      })
      ndjson({ ok: true, event: 'done', candidateId, outcome: outcome.outcome, partial: outcome.partial, chars: outcome.chars })
      res.end()
    } catch (error) {
      ndjson({ ok: false, event: 'error', error: (error as Error).message })
      res.end()
    }
    return true
  }

  /* ---- C2（T04）：候选查询/取消/采纳 ---- */
  if (path === '/api/draft.candidate') {
    const root = resolvedRoot
    const candidateId = typeof body['candidateId'] === 'string' ? body['candidateId'] : null
    if (root === null || candidateId === null) {
      json(400, { ok: false, error: 'root and candidateId required' })
      return true
    }
    const candidate = readDraftCandidate(assertSafeBookRoot(root), candidateId)
    if (candidate === null) {
      json(404, { ok: false, code: 'CANDIDATE_NOT_FOUND', error: 'candidate not found' })
      return true
    }
    json(200, { ok: true, candidate })
    return true
  }

  if (path === '/api/draft.cancel') {
    const root = resolvedRoot
    const candidateId = typeof body['candidateId'] === 'string' ? body['candidateId'] : null
    if (root === null || candidateId === null) {
      json(400, { ok: false, error: 'root and candidateId required' })
      return true
    }
    try {
      const candidate = cancelCandidate(assertSafeBookRoot(root), candidateId)
      json(200, { ok: true, candidateId, status: candidate.status })
    } catch (error) {
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  if (path === '/api/draft.accept') {
    const root = resolvedRoot
    const candidateId = typeof body['candidateId'] === 'string' ? body['candidateId'] : null
    const idempotencyKey = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : null
    const rawBase = body['base'] as { revision?: unknown; sha256?: unknown } | undefined
    if (root === null || candidateId === null || idempotencyKey === null || rawBase === null || typeof rawBase !== 'object') {
      json(400, { ok: false, error: 'root, candidateId, base and idempotencyKey required' })
      return true
    }
    const bookId = typeof body['bookId'] === 'string' ? body['bookId'] : undefined
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : undefined
    const allowPartial = Boolean(body['allowPartial'] ?? body['confirmPartial'])
    try {
      const result = acceptDraft({
        bookRoot: assertSafeBookRoot(root),
        candidateId,
        base: { revision: Number(rawBase.revision), sha256: String(rawBase.sha256) },
        idempotencyKey,
        bookId,
        chapterIndex,
        allowPartial,
        confirmPartial: allowPartial,
      })
      json(200, { ok: true, ...result })
    } catch (error) {
      if (error instanceof AcceptConflictError) {
        json(409, { ok: false, code: error.code, error: error.message })
        return true
      }
      if (error instanceof CandidateError) {
        json(409, { ok: false, code: error.code, error: error.message })
        return true
      }
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  /* ---- 文学质量审查与回炉 ---- */
  if (path === '/api/chapter.review') {
    const root = resolvedRoot
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
    const root = resolvedRoot
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
    const root = resolvedRoot
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
    const rawRoot = resolvedRoot
    const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
    if (rawRoot === null || chapterIndex === null) {
      json(400, { ok: false, error: 'root and chapterIndex required' })
      return true
    }
    const root = assertSafeBookRoot(rawRoot)

    // 章节文件不存在（新书/未建章）≠ 结构违例：诚实返回 no_review，而非 500。
    let draftIdentity: { draftRevision: number; draftContentHash: string }
    try {
      const proseObj = readProseChapter(root, proseChapterPath(chapterIndex))
      draftIdentity = {
        draftRevision: proseObj.revision,
        draftContentHash: hashProse(proseObj.body),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        json(200, { ok: true, status: 'no_review', report: null, current: false })
        return true
      }
      throw error
    }
    const result = queryChapterQualityStatus(root, chapterIndex, draftIdentity)

    json(200, {
      ok: true,
      status: result.status,
      report: result.report,
      current: result.current,
    })
    return true
  }

  /* ---- 步 8 提案队列确认面（S6）：ProposalPort 逐条 confirm / reject / editAccept ---- */

  // 待决提案队列（恢复入口同款扫描：管线 open 记录中仍有 pending 条目的那些）。
  // 跨重启保持待决——提案记录在 .mozhou/proposals/，本端点即「盘面凭据」的读取面。
  if (path === '/api/proposal.list') {
    const rawRoot = resolvedRoot
    if (rawRoot === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const port = new ProposalPort({ root })
      const proposals = port
        .listPendingRefs()
        .filter((ref): ref is { readonly port: 'pipeline'; readonly proposalId: string } => ref.port === 'pipeline')
        .map((ref) => loadCanonProposal(root, ref.proposalId))
        .filter((record): record is NonNullable<typeof record> => record !== null)
        .map(canonProposalView)
      json(200, { ok: true, proposals })
    } catch (error) {
      json(500, { ok: false, error: (error as Error).message })
    }
    return true
  }

  // 逐条决策：confirm = 原样入确认集；reject = 排除；editAccept = patch 顶层浅合并后入集。
  if (path === '/api/proposal.decide') {
    const rawRoot = resolvedRoot
    const proposalId = typeof body['proposalId'] === 'string' ? body['proposalId'] : null
    const itemId = typeof body['itemId'] === 'string' ? body['itemId'] : null
    const action = body['action']
    if (
      rawRoot === null ||
      proposalId === null ||
      itemId === null ||
      (action !== 'confirm' && action !== 'reject' && action !== 'editAccept')
    ) {
      json(400, {
        ok: false,
        error: "root, proposalId, itemId and action ('confirm'|'reject'|'editAccept') required",
      })
      return true
    }
    const rawPatch = body['patch']
    if (action === 'editAccept') {
      // 空 patch 是 confirm 语义违例（Port 同样拒绝）；形状错误在边界拦下，给出可读 400
      if (
        rawPatch === null ||
        typeof rawPatch !== 'object' ||
        Array.isArray(rawPatch) ||
        Object.keys(rawPatch).length === 0
      ) {
        json(400, { ok: false, error: 'editAccept requires a non-empty patch object (empty patch is a confirm)' })
        return true
      }
    } else if (rawPatch !== undefined) {
      json(400, { ok: false, error: 'patch is only accepted for editAccept' })
      return true
    }

    try {
      const root = assertSafeBookRoot(rawRoot)
      const port = new ProposalPort({ root })
      const ref = { port: 'pipeline', proposalId } as const
      const outcome =
        action === 'confirm'
          ? port.confirm(ref, itemId)
          : action === 'reject'
            ? port.reject(ref, itemId)
            : port.editAccept(ref, itemId, rawPatch as Readonly<Record<string, unknown>>)
      const record = loadCanonProposal(root, proposalId)
      json(200, {
        ok: true,
        action: outcome.action,
        itemId: outcome.itemId,
        pendingItems: outcome.pendingItems,
        finalized: outcome.finalized,
        proposal: record === null ? null : canonProposalView(record),
      })
    } catch (error) {
      if (error instanceof ProposalPortError) {
        json(409, { ok: false, code: 'PROPOSAL_DECISION_REJECTED', error: error.message })
        return true
      }
      json(500, { ok: false, error: (error as Error).message })
    }
    return true
  }

  // 显式放弃整份提案（正文改过 / 提取不可用时的收口出口）：逐条 reject 后收口。
  // 放弃 ≠ 回滚：提案从未进 Commit，正典零字节触碰；账面 CanonProposalCreated
  // 无 CanonCommitted 配对尾——如实表示「该提案从未被提交」。
  if (path === '/api/proposal.discard') {
    const rawRoot = resolvedRoot
    const proposalId = typeof body['proposalId'] === 'string' ? body['proposalId'] : null
    if (rawRoot === null || proposalId === null) {
      json(400, { ok: false, error: 'root and proposalId required' })
      return true
    }
    try {
      const root = assertSafeBookRoot(rawRoot)
      const port = new ProposalPort({ root })
      const ref = { port: 'pipeline', proposalId } as const
      for (const itemId of port.pendingItemsOf(ref)) port.reject(ref, itemId)
      port.markConsumed(ref)
      const record = loadCanonProposal(root, proposalId)
      json(200, { ok: true, discarded: true, proposal: record === null ? null : canonProposalView(record) })
    } catch (error) {
      if (error instanceof ProposalPortError) {
        json(409, { ok: false, code: 'PROPOSAL_DISCARD_REJECTED', error: error.message })
        return true
      }
      json(500, { ok: false, error: (error as Error).message })
    }
    return true
  }

  return false
}
