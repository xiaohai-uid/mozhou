/**
 * apps/web/server/llm · 生成端点统一解析（工单06 ·「我在跟哪个模型说话」）。
 *
 * 领域规则只有一处权威表述——`llm/tierRouting.ts:146-158`：端点身份 = providerId，
 * 账本记录的 providerId 必然就是实际服务的那一个。此前只有 draft 一条路径遵守它；
 * Final Extract / 落定语义分析 / 分镜各自 `resolveChatEndpoint`（BYOK-only，散在 3 个
 * 文件），注册表-only 的部署会在 commit 流程里出现「写增量的端点 ≠ 账本 providerId」
 * ——正是 tierRouting 要禁止的不一致。
 *
 * 本模块把「这次生成到底走谁」收敛为**一次**解析，解析顺序与 draft 生产路径逐字节对齐：
 *   1. **hosted 且无 principal ⇒ `hosted_no_principal`**（凭据隔离，显式拒答：hosted 下
 *      凭据按 userId 分目录，没有主体就选不出「该用户的」凭据，用共享端点会跨用户串号。
 *      4423db4 曾在 semanticSettled 一个调用点打同款补丁；这里是 module 级收口，任何
 *      调用方不再需要各自记得这道闸）；
 *   2. **注册表层**：`resolveDraftTierRoute`（部署的生成路由——tier 表受控声明在
 *      CHAPTER_DRAFTING 档，见 kernel-schema.ts:385 注释）⇒ `resolveTierEndpoint`。
 *      文件不存在 ⇒ null ⇒ 落 BYOK（「没有配置的人零感知」不变）；
 *      文件存在但解析失败（结构非法 / 歧义 / api_key_ref / providerId 未登记 / SSRF /
 *      密钥缺失）⇒ `provider_config_invalid`——**绝不回落 BYOK**，那正是要消灭的
 *      「账本记 X、请求发 Y」；
 *   3. **BYOK 层**：`resolveChatEndpoint`（产品内配置优先，再退环境变量；同一 userId
 *      隔离语义）⇒ source='byok'，providerId = 包内默认 'deepseek'（与
 *      makeStreamEngine 的绑定键一致）；无凭据 ⇒ `no_provider_configured`，detail 即
 *      行动指引。
 *
 * 为什么所有 task type 共用同一条注册表路由：账本 providerId 由 draft 解析写入
 * （GenerationStarted snapshot），同一条 commit 流程里的提取等生成消费若解析到别的
 * 端点，就重新制造「账本与出站不同源」。给每个 task type 各查各的档位需要先给它们
 * 各自的账本身份——那是独立决策，本票不做（YAGNI，也不加 registry 插件机制）。
 * taskType 因此是**诊断标签 + 扩展点**：出现在失败 detail 里，标明是哪条生成入口要不到端点。
 *
 * mock 开关（MOZHOU_DRAFT_PROVIDER）不进本模块：它是「不调真实 provider」的显式
 * 测试/演示开关，不是一种解析结果（makeStreamEngine 语义不变）。
 *
 * 失败**带原因**：Unavailable{reason, detail}，reason ∈ 三类，detail 指向配置键 / 环境变量
 * 名——调用方不再各自解释 null。宁败不猜的纪律与 tierRouting 完全一致。
 */
import { defaultBookAccessManager } from '../bookAccess.js'
import type { ResolvedEndpoint } from './types.js'
import { SsrfBlockedError, resolveChatEndpoint } from './openaiStream.js'
import {
  resolveDraftTierRoute,
  resolveTierEndpoint,
} from './tierRouting.js'
import type { DraftTierRoute } from './tierRouting.js'

/** 参与统一解析的生成入口标签（诊断 + 注册表扩展点；注册表层当前只声明 CHAPTER_DRAFTING）。 */
export type GenerationTaskType = 'CHAPTER_DRAFTING' | 'FINAL_EXTRACT' | 'SEMANTIC_ANALYSIS' | 'STORYBOARD'

/** 请求主体（结构化最小形状：VerifiedPrincipal 满足之；旁路调用可缺省）。 */
export interface GenerationPrincipal {
  readonly userId?: string | undefined
}

/** 解析来源：providers 注册表（settings.yaml）或 BYOK（产品内配置/环境变量）。 */
export type GenerationSource = 'registry' | 'byok'

/**
 * 解析成功的生成目标。**providerId 与 endpoint 由同一次解析产生**——把 providerId 写进
 * 账本绑定、把 endpoint 用于出站，二者必然同源（tierRouting.ts:146-158 的不变量）。
 */
export interface GenerationTargetOk {
  readonly available: true
  readonly taskType: GenerationTaskType
  readonly endpoint: ResolvedEndpoint
  /** 账本身份：绑定键 / GenerationStarted snapshot 的 providerId。 */
  readonly providerId: string
  readonly model: string
  readonly source: GenerationSource
  /** source='registry' 时的活动路由（供 setGlobalOverride / 留痕）；byok ⇒ null。 */
  readonly registryRoute: DraftTierRoute | null
}

export type GenerationUnavailableReason =
  /** hosted 模式且解析处无 principal：凭据隔离显式拒答（不是「没配 Key」）。 */
  | 'hosted_no_principal'
  /** 注册表无路由且 BYOK 无凭据：真没配任何 provider。 */
  | 'no_provider_configured'
  /** 配了但不可用（注册表结构非法/歧义/未登记/SSRF/密钥缺失，或 BYOK 端点未过门禁）：
   *  detail 携带带键路径的病因。绝不回落到另一个端点。 */
  | 'provider_config_invalid'
  /**
   * 配了，但端点被 SSRF 门禁拒绝（环回/本机名/私有/保留地址/协议不合），而部署者
   * **没有**显式设 MOZHOU_ALLOW_PRIVATE_LLM=1。
   *
   * 为什么要从 provider_config_invalid 里分出来（P2 缺陷「本机模型接入指引误导」）：
   * 这两类的下一步**完全相反**。provider_config_invalid 一般是配置写错了，改配置；
   * 而本类是配置没写错、门禁按设计默认收紧，部署者显式放行即可。原先两者同码，
   * UI 只能对两者说同一句话，于是本机部署的用户被指引去「账户 → 模型设置」填
   * BYOK 密钥——那是本机部署根本不该走的路，照着做也接不上本地模型。
   *
   * 分支不是放宽：门禁仍在同一处按同一条件拒绝；本 reason 只在拒绝**已经发生后**
   * 给它一个可分类的名字。
   */
  | 'provider_endpoint_blocked'

export interface GenerationTargetUnavailable {
  readonly available: false
  readonly taskType: GenerationTaskType
  readonly reason: GenerationUnavailableReason
  readonly detail: string
  /**
   * reason='provider_endpoint_blocked' 时如实带上被拒主机，否则 undefined。
   * UI 用它点名「哪个端点被拦」，不靠解析 detail 散文。
   */
  readonly blockedHost?: string | undefined
}

export type GenerationTargetResolution = GenerationTargetOk | GenerationTargetUnavailable

/** 包内默认 providerId（规格 §6 两级映射的底层默认；BYOK 分支的账本身份）。 */
export const DEFAULT_GENERATION_PROVIDER_ID = 'deepseek'

/**
 * hosted 判据：`defaultBookAccessManager.isHostedMode()`（进程内 setHostedMode 设置位）
 * ∥ 注入 env 的 MOZHOU_HOSTED='true'。
 *
 * 为什么把注入 env 也算进来：生产上调用方一律传 `process.env`，两种判据同值，行为不变；
 * 而测试注入一份隔离 env 时，若只看进程位，`hosted_no_principal` 这条凭据隔离闸就**无法
 * 确定性触发**——env 参数会沦为摆设，这道闸也就没有回归保护。
 */
function isHosted(env: NodeJS.ProcessEnv): boolean {
  return defaultBookAccessManager.isHostedMode() || env['MOZHOU_HOSTED'] === 'true'
}

/** no_provider_configured 的行动指引（与 makeStreamEngine 此前抛错文案逐字一致）。 */
export const NO_PROVIDER_CONFIGURED_DETAIL =
  '未配置真实 LLM Key（请在「模型设置」页填写，或设 MOZHOU_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY）'

/** hosted_no_principal 的病因文案（与 semanticSettled 既有留痕同义，module 级唯一出处）。 */
const HOSTED_NO_PRINCIPAL_DETAIL =
  'hosted 模式且此解析处无 principal，选不出该用户的凭据（显式拒答：用共享端点会跨用户串号）'

function ok(request: {
  readonly taskType: GenerationTaskType
  readonly endpoint: ResolvedEndpoint
  readonly providerId: string
  readonly source: GenerationSource
  readonly registryRoute: DraftTierRoute | null
}): GenerationTargetOk {
  return {
    available: true,
    taskType: request.taskType,
    endpoint: request.endpoint,
    providerId: request.providerId,
    model: request.endpoint.model,
    source: request.source,
    registryRoute: request.registryRoute,
  }
}

function unavailable(
  taskType: GenerationTaskType,
  reason: GenerationUnavailableReason,
  detail: string,
  blockedHost?: string,
): GenerationTargetUnavailable {
  return blockedHost === undefined
    ? { available: false, taskType, reason, detail }
    : { available: false, taskType, reason, detail, blockedHost }
}

/**
 * 从任意失败面识别「这确实是 SSRF 门禁拒绝」。
 *
 * 为什么要跨两层找（注册表层的 TierProviderError 包了它，BYOK 层直接抛）：
 * 两条解析路径都会把门禁拒绝**包成**自己的错误类型再上抛（注册表层要附加
 * 配置文件与键路径，TierProviderError 的既有契约；改包装会动到 tierRoute 测试
 * 逐字断言的 message）。所以分类必须能穿过包装。
 *
 * 判据用 `instanceof SsrfBlockedError`（结构化标记）而非匹配 `code` 字符串或
 * 中文 message：文案/文件名一变就断的判据不能进生产路径。注册表层包过的情形
 * 退回检查包装错误的 `cause` 链——同样只看类型。
 */
function ssrfBlockedHost(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (current instanceof SsrfBlockedError) return current.targetHost
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * 把一次解析失败收口成 Unavailable，并按病因分流 reason。
 *
 * 分流只发生在**门禁已经拒绝之后**：本函数不调用、不重跑、也不放宽任何门禁判定，
 * 它只把既成事实的拒绝归到一个能被 UI 正确指引的类别里。
 */
function unavailableFromError(
  taskType: GenerationTaskType,
  error: unknown,
): GenerationTargetUnavailable {
  const detail = error instanceof Error ? error.message : String(error)
  const blockedHost = ssrfBlockedHost(error)
  return blockedHost === undefined
    ? unavailable(taskType, 'provider_config_invalid', detail)
    : unavailable(taskType, 'provider_endpoint_blocked', detail, blockedHost)
}

export interface ResolveGenerationTargetRequest {
  /** 哪条生成入口在要端点（诊断标签；注册表层当前按部署生成路由解析，见模块头注释）。 */
  readonly taskType: GenerationTaskType
  /** 请求主体；hosted 下缺失 ⇒ hosted_no_principal（凭据隔离）。local 下可缺省。 */
  readonly principal?: GenerationPrincipal | null | undefined
  /** 环境注入（测试用）；缺省 process.env。 */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * 生成端点统一解析：注册表 → BYOK → 带原因的 Unavailable。
 *
 * 六个生产调用点（draft 引擎 / 能力探针 / Final Extract / 落定语义 / 分镜路由）一律经此
 * 单缝提问「我在跟哪个模型说话」；账本出现的 providerId 与实际出站端点因此可断言同源。
 */
export async function resolveGenerationTarget(
  request: ResolveGenerationTargetRequest,
): Promise<GenerationTargetResolution> {
  const taskType = request.taskType
  const env = request.env ?? process.env
  const principal = request.principal

  // 1. hosted + 无主体：显式拒答（凭据隔离）。置于最前——即使环境变量里躺着可用的 Key，
  //    也不允许旁路拿部署级凭据替某个不确定的用户调 LLM（semanticSettled 曾为此单独打补丁）。
  if (isHosted(env) && (principal === null || principal === undefined || (principal.userId ?? '').length === 0)) {
    return unavailable(taskType, 'hosted_no_principal', HOSTED_NO_PRINCIPAL_DETAIL)
  }

  // 2. 注册表层：文件不存在 ⇒ null ⇒ 落 BYOK（零感知）；存在但解析失败 ⇒ 按病因分流。
  let route: DraftTierRoute | null
  try {
    route = await resolveDraftTierRoute(env)
  } catch (error) {
    return unavailableFromError(taskType, error)
  }
  if (route !== null) {
    try {
      const endpoint = resolveTierEndpoint(route, env)
      return ok({
        taskType,
        endpoint,
        providerId: route.selection.route.providerId,
        source: 'registry',
        registryRoute: route,
      })
    } catch (error) {
      return unavailableFromError(taskType, error)
    }
  }

  // 3. BYOK 层：产品内配置（按 userId 隔离）优先，再退环境变量。SSRF 门禁失败归
  //    provider_endpoint_blocked（配了、门禁按设计拒绝，部署者显式放行即可），其余
  //    失败归 provider_config_invalid。两者都**不**静默当「没配」。
  try {
    const endpoint = resolveChatEndpoint(env, principal?.userId)
    if (endpoint === null) {
      return unavailable(taskType, 'no_provider_configured', NO_PROVIDER_CONFIGURED_DETAIL)
    }
    return ok({
      taskType,
      endpoint,
      providerId: DEFAULT_GENERATION_PROVIDER_ID,
      source: 'byok',
      registryRoute: null,
    })
  } catch (error) {
    return unavailableFromError(taskType, error)
  }
}
