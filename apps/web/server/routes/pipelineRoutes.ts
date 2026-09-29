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
  CANDIDATE_NOT_FOUND,
  CHAPTER_SCAFFOLD_FAILED,
  INVALID_BOOK_REQUEST,
  NO_COMPILED_RECEIPT,
  PROVIDER_UNAVAILABLE,
  PROPOSAL_DECISION_REJECTED,
  PROPOSAL_DISCARD_REJECTED,
  QUALITY_REWORK_LIMIT_EXCEEDED,
} from '../routeCodes.js'
import { decodeBookRequest, noOpenProductionSessionError } from '../bookRequest.js'
import { emptyDraftStream, mockDraftStream } from './draftStreamEmulation.js'
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
  NoCompiledReceiptAnchorError,
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
import { resolveCompiledAnchor } from '../compiledAnchor.js'
import {
  ChapterExistsError,
  chapterOutlinePath,
  proseChapterPath,
  readProseChapter,
  withStrictBook,
} from '@mozhou/data-plane'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PublishBus, RuntimeEngine, createDraftRecipe, toProviderOverride } from '@mozhou/runtime'
import type { CapabilityRecipe } from '@mozhou/runtime'
import { streamOpenAiChat } from '../llm/openaiStream.js'
import { DRAFT_TASK_TYPE, tierRouteTraceLine } from '../llm/tierRouting.js'
import { resolveGenerationTarget } from '../llm/generationTarget.js'
import type { GenerationUnavailableReason } from '../llm/generationTarget.js'
import { buildDraftContext } from '../draftContext.js'
import { assertSafeBookRoot } from '../security.js'
import { defaultBookAccessManager } from '../bookAccess.js'
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


/**
 * mock 开关族判据（hasDraftProvider / draft.stream 前置闸 / makeStreamEngine 三处共用，
 * 工单06 收敛）：`MOZHOU_DRAFT_PROVIDER=mock` 恒成立；`mock-empty` 仅非生产成立
 * （空流回归测试缝，生产不生效以免「探针报可用、生成都失败」的假可用）。
 */
function isMockDraftProviderMode(env: NodeJS.ProcessEnv): boolean {
  const configured = env['MOZHOU_DRAFT_PROVIDER']
  return configured === 'mock' || (configured === 'mock-empty' && env['NODE_ENV'] !== 'production')
}

/**
 * 能力探针的**完整**结论：可用性 + 病因分类。
 *
 * reason 直接复用 resolveGenerationTarget 的 GenerationUnavailableReason，另加两个
 * 可用态（'available' / 'mock'）。**不另造一套枚举**——探针与生成闸共用同一个解析缝，
 * 两边若各有一套 reason，「UI 说的原因」与「生成时报的原因」就会漂移，那正是本缺陷
 * 想消灭的东西。
 *
 * 这是**加法**而非替换：hasDraftProvider 的布尔签名与全部既有调用点不变
 * （/api/capability-square 的 providerAvailable 等），UI 只在需要指引时才读 reason。
 */
export type DraftProviderAvailabilityReason = 'available' | 'mock' | GenerationUnavailableReason

export interface DraftProviderAvailability {
  readonly available: boolean
  /** available=true ⇒ 'available' | 'mock'；false ⇒ 解析缝给出的三类病因之一。 */
  readonly reason: DraftProviderAvailabilityReason
  /** 带键路径的病因原文（available 时为空串）。UI 展示用，判据用 reason。 */
  readonly detail: string
  /** reason='provider_endpoint_blocked' 时为被拒主机，否则 undefined。 */
  readonly blockedHost?: string | undefined
}

/**
 * 草稿 provider 可用性判据（`/api/capabilities`、`/api/capability-square` 的 `providerAvailable`
 * 与 `/api/draft.stream` 前置闸共用）——回答「现在能不能真的生成」：
 *   - `MOZHOU_DRAFT_PROVIDER=mock` ⇒ true（既有显式开关，不参与分级路由选档）；
 *   - `MOZHOU_DRAFT_PROVIDER=mock-empty` ⇒ true，**但仅非生产环境**（空流回归测试缝）；
 *   - 否则 = `resolveGenerationTarget` 是否可用（工单06 单缝）：注册表可解析 ∥ BYOK 凭据齐备。
 *
 * 为什么要认注册表：端点身份已由 providerId 决定（见 llm/tierRouting.ts），所以「有没有可用的
 * 草稿 provider」的判据必须把注册表算进去——否则「只用注册表、不配 BYOK」的部署会被挡在门外，
 * 等于注册表能力独立不可用。判据取**可解析性**而非「文件存在」：配了但解析不出来
 * （provider_config_invalid）时返回 false，不让 UI 报出与实际不符的能力声明；病因
 * （带键路径的 detail）由真正生成时的同一次解析上抛。
 */
export async function hasDraftProvider(env: NodeJS.ProcessEnv = process.env, userId?: string): Promise<boolean> {
  return (await draftProviderAvailability(env, userId)).available
}

/**
 * 与 hasDraftProvider 同一次解析，但**不丢掉病因**。
 *
 * 为什么需要（P2 缺陷「本机模型接入指引误导」）：hasDraftProvider 回答的是布尔量，
 * 而 UI 要回答「下一步做什么」。真没配 provider（该去设置页填密钥）与端点被 SSRF
 * 门禁按设计拒绝（该让部署者显式放行本机网络）的下一步**相反**；压成 false 之后
 * 两者共用一句话，于是本机部署的用户被指引去填 BYOK 密钥——本机部署根本不该走那条
 * 路，照着做也接不上本地模型。
 *
 * 探针不重跑解析、不重跑门禁：只是把 resolveGenerationTarget 本来就算好的
 * reason / detail / blockedHost 如实带出来。故 mock 档没有「病因」可言，
 * 按 available=true、reason='mock' 报（mock 是显式测试/演示开关，不是诊断类别）。
 */
export async function draftProviderAvailability(
  env: NodeJS.ProcessEnv = process.env,
  userId?: string,
): Promise<DraftProviderAvailability> {
  if (isMockDraftProviderMode(env)) {
    return { available: true, reason: 'mock', detail: '', blockedHost: undefined }
  }
  const resolution = await resolveGenerationTarget({
    taskType: DRAFT_TASK_TYPE,
    principal: userId === undefined ? undefined : { userId },
    env,
  })
  if (resolution.available) {
    return { available: true, reason: 'available', detail: '', blockedHost: undefined }
  }
  return {
    available: false,
    reason: resolution.reason,
    detail: resolution.detail,
    blockedHost: resolution.blockedHost,
  }
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

/** 单章脚手架两件（章大纲节点 + 正文载体）同时缺失——「这本书还没写到这一章」。 */
function chapterScaffoldAbsent(root: string, chapterIndex: number): boolean {
  return (
    !existsSync(join(root, chapterOutlinePath(chapterIndex))) &&
    !existsSync(join(root, proseChapterPath(chapterIndex)))
  )
}

/**
 * 首章脚手架按需补齐（P1 缺陷 1，`.dsh-audit/launch/02-browser-ui.md` §7 缺陷 1）。
 *
 * 为什么放在生成路径而不是 `/api/book` 建书时：建书是**开卷**动作，卷内有几章
 * 本来就是作者尚未决定的；把「第 1 章必然存在」写进建书，等于替作者决定了
 * 首章标题与章号语义。生成则是「作者已经点了写这一章」——此时补一件同名空
 * 脚手架是纯落账，不构成内容决定。观察到的唯一可观察目标是「新用户建书后
 * 第一次点生成就能成功」，按需创建正好是最小实现。
 *
 * 幂等与并发：
 * - 已存在（含只存在其一的部分状态）⇒ 直接返回，既有行为逐字不变；
 * - 两个请求同时进来 ⇒ 书级锁内串行，第二个撞到 ChapterExistsError 视作成功；
 * - 只在**两件都缺**时创建，故绝不用脚手架覆盖任何已有内容。
 *
 * 只在 createChapterDraft 的原子不变量（两件一起建）被打破时才算真损坏，
 * 那种盘面状态不在本路径的修复面内，交由既有错误路径如实暴露。
 */
async function ensureChapterScaffold(root: string, chapterIndex: number, bookKey: string): Promise<void> {
  if (!chapterScaffoldAbsent(root, chapterIndex)) return
  // 书级锁内串行：check-then-create 不是原子的，两请求同刻进来会各自看到
  // 「两件都缺」然后争抢同一对文件。锁只圈这一次建章，不圈整段生成。
  await defaultBookAccessManager.queue.withBookLock(bookKey, async () => {
    await Promise.resolve()
    if (!chapterScaffoldAbsent(root, chapterIndex)) return
    try {
      withStrictBook(root, (plane) => {
        plane.createChapterDraft({ chapterIndex, title: `第${chapterIndex}章` })
      })
    } catch (error) {
      // 并发窗口：另一请求刚建好同一章。已存在即达成目的，不是失败。
      if (error instanceof ChapterExistsError) return
      throw error
    }
  })
}

/**
 * 真实 provider 消费完整编译上下文；mock 仅用作者指令生成演示正文，避免把
 * ContextPacket 自身写回小说正文，但 start 帧仍暴露真实 modelPrompt 供契约审计。
 * C2（T04）：stream 只 append 候选（candidate 上下文必传，缺省拒绝绑定）；
 * signal 在请求断开/显式取消时中止上游。
 *
 * T14 接线 + 工单06 收敛：真实分支的 providerId/model/端点由
 * `llm/generationTarget.resolveGenerationTarget`（单缝）解析——注册表 → BYOK → 带原因的
 * Unavailable：
 *   - source='registry' ⇒ providerId ⇒ CapabilityRegistry.setGlobalOverride（包内默认
 *     'deepseek' 仍是注册项，覆盖层只改解析结果，覆盖后 GenerationStarted.snapshot.providerId
 *     记的就是配置值）；端点（baseURL + 密钥）由**同一次解析**按同一个 providerId 从注册表
 *     解析——账本 providerId 与实际出站端点强制同源，不存在「账本说走 X、请求发往端点 Y」；
 *   - source='byok' ⇒ 与接线前逐字节一致（BYOK 解析 + 包内默认 providerId）；
 *   - Unavailable ⇒ 抛 `PROVIDER_UNAVAILABLE: <reason>: <detail>`，NDJSON error 帧如实
 *     呈现病因（注册表失败绝不回落 BYOK）。
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
  userId?: string,
): Promise<{ engine: RuntimeEngine; recipe: CapabilityRecipe; real: boolean }> {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_web_t44' })
  const recipe = createDraftRecipe({ proseRelPath: proseChapterPath(chapterIndex) })

  // mock 开关族：'mock' 回吐 prompt 切块（既有演示/测试开关）。
  // 'mock-empty' 只在**非生产**环境成立：它模拟真实上游「HTTP 200 但零 delta」的静默空输出形态
  // （commit 0693776 记录），供空流守卫的 HTTP 级回归测试使用。生产构建下该值不生效，
  // 免得出现「能力探针报可用、但每次生成都失败」的假可用（AGENTS.md §4.13-4.14）。
  const emptyMock = process.env['MOZHOU_DRAFT_PROVIDER'] === 'mock-empty' && process.env['NODE_ENV'] !== 'production'
  const explicitMock = isMockDraftProviderMode(process.env)
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
        stream: () => (emptyMock ? emptyDraftStream() : mockDraftStream(mockOutputSeed, onDelta)),
        candidate,
        ...(signal === undefined ? {} : { signal }),
      }),
    )
  } else {
    // 包内默认（规格 §6 两级：包内默认 ← 全局覆盖）。默认项始终注册，覆盖层只改解析结果。
    const defaultProviderId = 'deepseek'
    const providerVersion = '1.0.0'

    // 工单06：解析收敛到 llm/generationTarget.resolveGenerationTarget 单缝——注册表 → BYOK
    // → 带原因的 Unavailable。providerId 与实际出站端点由**同一次解析**产生（providerId 既作
    // 下方 registerProviderBinding 绑定键与账本快照，又决定 baseURL/apiKey），账本与出站
    // 因此强制同源（tierRouting.ts:146-158 不变量）。注册表解析失败绝不回落 BYOK；
    // Unavailable 带病因 detail，NDJSON error 帧如实呈现，不用笼统码掩盖。
    const target = await resolveGenerationTarget({
      taskType: DRAFT_TASK_TYPE,
      principal: userId === undefined ? undefined : { userId },
      env: process.env,
    })
    if (!target.available) {
      throw new Error(`PROVIDER_UNAVAILABLE: ${target.detail}`)
    }
    const providerId = target.providerId
    const effectiveEndpoint = target.endpoint
    real = true

    if (target.source === 'registry' && target.registryRoute !== null) {
      engine.registry.setGlobalOverride(toProviderOverride(target.registryRoute.selection, providerVersion))
      // 不许静默生效：留痕把 providerId 与实际出站端点并排写出（注册表落地后二者强制一致）。
      console.log(
        tierRouteTraceLine(target.registryRoute, {
          defaultProviderId,
          endpointBaseUrl: effectiveEndpoint.baseUrl,
        }),
      )
    }

    engine.registerCapability({
      taskType: 'CHAPTER_DRAFTING',
      providerId: defaultProviderId,
      providerVersion,
      failurePolicy: { timeoutMs: 60_000, fallbackProviderIds: [] },
    })
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

/** 零增量流夹具：正常结束、一个 delta 都不发——等价于上游静默空输出。 */

export const pipelineRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot, principal, authorizedBook }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  if (path === '/api/session.open') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    try {
      const session = ChapterProductionSession.start({ bus: new PublishBus(), root, chapterIndex })
      json(200, { ok: true, taskRef: session.taskRef, currentStep: session.currentStep, chapterIndex })
    } catch (error) {
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  if (path === '/api/session.advance') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
    if (session === null) {
      const contract = noOpenProductionSessionError(chapterIndex)
      json(contract.status, { ok: false, code: contract.code, error: contract.error })
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
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const rawReason = body['reason']
    if (rawReason !== undefined && (typeof rawReason !== 'string' || rawReason.trim().length === 0)) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'reason must be a non-empty string when provided' })
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
    // providerAvailable 保持原义（布尔），**新增** providerUnavailableReason / providerDetail /
    // providerBlockedHost 三个字段供 UI 分流指引。加法而非替换：既有消费方（含契约测试）
    // 读 providerAvailable 继续成立。字段只带出解析缝已经算好的结论，不新增任何判定。
    const availability = await draftProviderAvailability(process.env, principal?.userId)
    json(200, {
      ok: true,
      capabilities: DIALOGUE_CAPABILITIES,
      providerAvailable: availability.available,
      providerUnavailableReason: availability.available ? null : availability.reason,
      providerDetail: availability.detail,
      providerBlockedHost: availability.blockedHost ?? null,
    })
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
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root: safeRoot, chapterIndex } = decoded.value
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

    if (mode === 'replace-selection') {
      if (!selection || !Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to < selection.from) {
        json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'replace-selection requires valid selection { from, to, selectedTextHash }' })
        return true
      }
    }

    if (!isMockDraftProviderMode(process.env)) {
      // 工单06：闸与真实生成走**同一个**解析缝（resolveGenerationTarget）。
      // 仅「真没配任何 provider」（no_provider_configured）才用笼统 PROVIDER_UNAVAILABLE 收口；
      // 「配了但解析不出来」（provider_config_invalid，注册表带键路径的病因 / BYOK 端点未过
      // 门禁）放行进真实分支，让 makeStreamEngine 的同一次解析抛出带原因的精确错误帧
      // （NDJSON error 帧），而不是用笼统码掩盖病因。
      const probe = await resolveGenerationTarget({
        taskType: DRAFT_TASK_TYPE,
        principal: principal ?? undefined,
        env: process.env,
      })
      if (!probe.available && probe.reason === 'no_provider_configured') {
        json(200, {
          ok: false,
          code: PROVIDER_UNAVAILABLE,
          error: 'provider unavailable: no draft provider configured',
        })
        return true
      }
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    const ndjson = (payload: unknown) => { res.write(JSON.stringify(payload) + '\n') }

    // 脚手架补齐排在设置流头**之前**：NDJSON 的 error 帧需要可写响应头；若建章本身
    // 失败，交给下方 try/catch 之前的既有 HTTP 错误通道如实报出（不被流语义吞掉）。
    try {
      await ensureChapterScaffold(safeRoot, chapterIndex, authorizedBook?.bookId ?? safeRoot)
    } catch (error) {
      json(500, { ok: false, code: CHAPTER_SCAFFOLD_FAILED, error: (error as Error).message })
      return true
    }

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
        principal?.userId,
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
      // 判帧只看一件事：**这次到底有没有给出正文**（produced，源自本次 attempt 的
      // 非空白追加字数），而不是笼统的 outcome。
      //   - 没给出 ⇒ error 帧：前端置 phase='error'，作者看到失败而不是一个空候选
      //     却被告知「生成完成」，点「采纳进正文」只会得到空白。
      //   - 断流但已留下半稿 ⇒ 维持既有 done(partial)：半稿是真内容、已落盘、可续可采纳，
      //     把它改判成 error 反而会把作者的 300 字困死（error 分支只给「再来一轮」）。
      if (outcome.outcome === 'succeeded' || outcome.produced) {
        ndjson({ ok: true, event: 'done', candidateId, outcome: outcome.outcome, partial: outcome.partial, chars: outcome.chars })
      } else {
        ndjson({
          ok: false,
          event: 'error',
          candidateId,
          outcome: outcome.outcome,
          partial: outcome.partial,
          chars: outcome.chars,
          error: outcome.reason ?? ('草稿生成失败（' + outcome.outcome + '）'),
        })
      }
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
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root and candidateId required' })
      return true
    }
    const candidate = readDraftCandidate(assertSafeBookRoot(root), candidateId)
    if (candidate === null) {
      json(404, { ok: false, code: CANDIDATE_NOT_FOUND, error: 'candidate not found' })
      return true
    }
    json(200, { ok: true, candidate })
    return true
  }

  if (path === '/api/draft.cancel') {
    const root = resolvedRoot
    const candidateId = typeof body['candidateId'] === 'string' ? body['candidateId'] : null
    if (root === null || candidateId === null) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root and candidateId required' })
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
    // 章号在此端点是**可选**的：候选自身带 chapterIndex，请求方不带即采信候选的
    // （draft-accept.ts:206 会在双方都带时核对身份）。带了就必须满足 ≥1 整数的冻结规则。
    const decoded = decodeBookRequest(body, resolvedRoot, { chapter: 'optional', principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const candidateId = typeof body['candidateId'] === 'string' ? body['candidateId'] : null
    const idempotencyKey = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : null
    const rawBase = body['base'] as { revision?: unknown; sha256?: unknown } | undefined
    if (candidateId === null || idempotencyKey === null || rawBase === null || typeof rawBase !== 'object') {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root, candidateId, base and idempotencyKey required' })
      return true
    }
    const bookId = typeof body['bookId'] === 'string' ? body['bookId'] : undefined
    const requestedChapterIndex = chapterIndex ?? undefined
    const allowPartial = Boolean(body['allowPartial'] ?? body['confirmPartial'])
    try {
      const result = acceptDraft({
        bookRoot: root,
        candidateId,
        base: { revision: Number(rawBase.revision), sha256: String(rawBase.sha256) },
        idempotencyKey,
        bookId,
        chapterIndex: requestedChapterIndex,
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
      if (error instanceof NoCompiledReceiptAnchorError) {
        json(409, { ok: false, code: error.code, error: error.message })
        return true
      }
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  /* ---- 文学质量审查与回炉 ---- */
  if (path === '/api/chapter.review') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
    if (session === null) {
      const contract = noOpenProductionSessionError(chapterIndex)
      json(contract.status, { ok: false, code: contract.code, error: contract.error })
      return true
    }
    if (session.currentStep === 'draft') session.advance('review')
    if (session.currentStep !== 'review') {
      json(409, { ok: false, error: 'review requires session at draft|review, got ' + session.currentStep })
      return true
    }
    // 评估锚点只有一条真源：账本平铺 ContextCompiled 行。session 投影的 lastReceiptId
    // 只认会话窗口内指针，真实作者旅程不开窗口 ⇒ 恒为 null。此处取不到就 409，
    // 不再编一个 rcpt_web_<n> 落进报告。
    const compiledAnchor = resolveCompiledAnchor(root, chapterIndex)
    if (compiledAnchor === null) {
      json(409, {
        ok: false,
        code: NO_COMPILED_RECEIPT,
        error:
          '第 ' + chapterIndex + ' 章没有 Context 编译凭证，无法声明评估锚点；请先生成草稿再审查（D10 不编造锚点）',
      })
      return true
    }
    const receiptId = compiledAnchor.receiptId
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
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
    if (session === null) {
      const contract = noOpenProductionSessionError(chapterIndex)
      json(contract.status, { ok: false, code: contract.code, error: contract.error })
      return true
    }
    try {
      session.requestQualityRework()
    } catch (error) {
      if (error instanceof QualityReworkLimitExceededError) {
        json(422, { ok: false, code: QUALITY_REWORK_LIMIT_EXCEEDED, error: error.message })
        return true
      }
      throw error
    }
    json(200, { ok: true, currentStep: session.currentStep, reworkCount: session.project().qualityReworkCount })
    return true
  }

  if (path === '/api/chapter.corrections') {
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value
    const reasons = Array.isArray(body['reasons']) ? (body['reasons'] as string[]) : []
    const note = typeof body['note'] === 'string' ? body['note'] : undefined

    if (reasons.length === 0) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'root, chapterIndex, and non-empty reasons required' })
      return true
    }

    const isCorrectionReason = (r: unknown): r is CorrectionReason =>
      typeof r === 'string' && (CORRECTION_REASONS as readonly string[]).includes(r)

    const invalid = reasons.filter((r) => !isCorrectionReason(r))
    if (invalid.length > 0) {
      json(400, { ok: false, code: INVALID_BOOK_REQUEST, error: 'invalid correction reasons: ' + invalid.map(String).join(', ') })
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
    const decoded = decodeBookRequest(body, resolvedRoot, { principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root, chapterIndex } = decoded.value

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
        json(409, { ok: false, code: PROPOSAL_DECISION_REJECTED, error: error.message })
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
        json(409, { ok: false, code: PROPOSAL_DISCARD_REJECTED, error: error.message })
        return true
      }
      json(500, { ok: false, error: (error as Error).message })
    }
    return true
  }

  return false
}
