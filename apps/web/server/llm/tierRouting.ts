/**
 * 分级模型路由接线（T14 生产接线 · 规格 §6「包内默认 ← 全局覆盖」两级 + §6.1 providers 注册表）。
 *
 * 把 `@mozhou/runtime` 的 tier 路由加载器接到 web 生成路径上：
 *   - 全局覆盖层文件 = `~/.mozhou/settings.yaml`（规格 §6；`MOZHOU_TIER_CONFIG` 仅作
 *     测试/运维覆盖）。**文件不存在 ⇒ 返回 null ⇒ 调用方完全保持既有行为**——这是本接线
 *     最重要的安全属性：没有配置的人零感知。
 *   - 活动 tier 的选择规则见 `selectTierRoute`（显式指定优先；未指定仅单叶子可自动采用；
 *     多叶子一律 fail-fast，不静默挑一个）。
 *   - **端点身份 = providerId**：叶子声明了 providerId，出站 baseURL 与密钥就只能由
 *     `providers:` 注册表解析（`resolveTierEndpoint`）。查不到即显式拒绝，绝不静默回落到
 *     BYOK 端点——「账本记 provider X、请求却发往 BYOK 端点 Y」正是本接线要消灭的不一致。
 *   - 机制分路：providerId 走 `CapabilityRegistry.setGlobalOverride`（覆盖层形状只承载
 *     providerId + providerVersion，见 `toProviderOverride`）；端点与 model 由
 *     `resolveTierEndpoint` 从注册表 + 叶子声明一次构造完成。
 *
 * 安全（配置文件是外部输入，不是可信来源）：
 *   - 注册表 baseURL 必须过既有 SSRF 门禁 `assertSafeEndpointUrl`（openaiStream.ts；BYOK
 *     走同一个函数），真正发请求前 `streamOpenAiChat` 还会用 `assertSafeRemoteTarget`
 *     补上 DNS 解析结果那一半；
 *   - 密钥本体永不入配置文件：注册表只写环境变量**名**（apiKeyEnv），该变量缺失即显式拒绝。
 *
 * 失败面：文件存在但结构非法 / 歧义 / providerId 未登记 / baseURL 非法 / 密钥缺失 ⇒ 上抛
 * （TierConfigError / NoProviderError / TierRouteUnsupportedError / TierProviderError），
 * 消息均指向键路径，绝不回落到硬编码或 BYOK——宁败不猜。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadTierConfigFile, selectTierRoute } from '@mozhou/runtime'
import type { ProviderEntry, ProviderRegistry, TierSelection } from '@mozhou/runtime'
import { assertSafeEndpointUrl } from './openaiStream.js'
import type { ResolvedEndpoint } from './types.js'

/** 本接线服务的 task_type（#8 tier 表受控增补行 · S3）。 */
export const DRAFT_TASK_TYPE = 'CHAPTER_DRAFTING'
/** 全局覆盖层文件路径覆盖位（测试/运维用；缺省走规格的 ~/.mozhou/settings.yaml）。 */
export const TIER_CONFIG_ENV = 'MOZHOU_TIER_CONFIG'
/** 活动 tier 显式选择位（多叶子配置必需）。 */
export const TIER_NAME_ENV = 'MOZHOU_DRAFT_TIER'
/** 部署者显式授权本机私有 LLM 的既有逃生位（与 BYOK 同一开关；配置文件无权设置）。 */
export const PRIVATE_NETWORK_ENV = 'MOZHOU_ALLOW_PRIVATE_LLM'

/** 解析出的活动路由 + 它的来源文件与注册表。 */
export interface DraftTierRoute {
  /** 全局覆盖层文件绝对路径（留痕与报错定位用）。 */
  readonly configPath: string;
  /** 选中的 tier 叶子（含 providerId / model）。 */
  readonly selection: TierSelection;
  /** 同文件的 `providers:` 注册表（端点与凭据引用的唯一来源）。 */
  readonly providers: ProviderRegistry;
}

/**
 * 入口能力边界错误：配置**过得了** loadTierConfig 的机械校验，但本入口无法兑现其声明。
 * 显式拒绝而非静默忽略——被悄悄丢弃的凭据声明比一次失败更危险。
 */
export class TierRouteUnsupportedError extends Error {
  override name = 'TierRouteUnsupportedError';
  readonly code = 'TIER_ROUTE_API_KEY_REF_UNSUPPORTED' as const;
  readonly configPath: string;
  readonly keyPath: string;

  constructor(configPath: string, keyPath: string, detail: string) {
    super(`${'TIER_ROUTE_API_KEY_REF_UNSUPPORTED'}: ${detail}（${configPath} @ ${keyPath}）`);
    this.configPath = configPath;
    this.keyPath = keyPath;
  }
}

/** 注册表解析的失败面（每一个出口都是显式拒绝，没有回落）。 */
export type TierProviderErrorCode =
  /** 叶子声明的 providerId 不在 `providers:` 注册表里。 */
  | 'TIER_ROUTE_PROVIDER_NOT_REGISTERED'
  /** 注册表 baseURL 未过出站 SSRF 门禁（协议 / 本机名 / 私有保留地址）。 */
  | 'TIER_ROUTE_PROVIDER_ENDPOINT_REJECTED'
  /** apiKeyEnv 指向的环境变量未设置或为空。 */
  | 'TIER_ROUTE_PROVIDER_KEY_MISSING';

/** 注册表端点解析失败：类型化 code + 配置文件与键路径（与 TierConfigError 同风格）。 */
export class TierProviderError extends Error {
  override name = 'TierProviderError';
  readonly code: TierProviderErrorCode;
  readonly configPath: string;
  readonly keyPath: string;

  constructor(code: TierProviderErrorCode, configPath: string, keyPath: string, detail: string) {
    super(`${code}: ${detail}（${configPath} @ ${keyPath}）`);
    this.code = code;
    this.configPath = configPath;
    this.keyPath = keyPath;
  }
}

/** 全局覆盖层落点：`MOZHOU_TIER_CONFIG` 优先，否则 `~/.mozhou/settings.yaml`（规格 §6）。 */
export function tierConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[TIER_CONFIG_ENV]
  if (explicit !== undefined && explicit.trim().length > 0) return resolve(explicit.trim())
  return join(homedir(), '.mozhou', 'settings.yaml')
}

export interface ResolveDraftTierRouteDeps {
  /** 存在性探测注入（测试零真实 HOME 依赖）。 */
  readonly fileExists?: (path: string) => boolean;
}

/**
 * 解析 CHAPTER_DRAFTING 的活动路由。
 * - 覆盖层文件不存在 ⇒ null（调用方保持现状）；
 * - 存在但非法/歧义 ⇒ 抛错（TierConfigError / NoProviderError / TierRouteUnsupportedError，
 *   消息均指向键路径）。
 */
export async function resolveDraftTierRoute(
  env: NodeJS.ProcessEnv = process.env,
  deps: ResolveDraftTierRouteDeps = {},
): Promise<DraftTierRoute | null> {
  const configPath = tierConfigPath(env)
  const fileExists = deps.fileExists ?? existsSync
  if (!fileExists(configPath)) return null

  const config = await loadTierConfigFile(configPath)
  const selection = selectTierRoute(
    config.routes,
    DRAFT_TASK_TYPE,
    env[TIER_NAME_ENV],
    `本生成入口的操作位是环境变量 ${TIER_NAME_ENV}`,
  )

  // api_key_ref 是校验器放行的合法槽位，但本入口的凭据**只**来自注册表的 apiKeyEnv
  // （providerId → { baseURL, apiKeyEnv }）。叶子再声明一层 api_key_ref 会让「这份叶子用
  // 哪个密钥」出现两个互相矛盾的来源（注册表 vs 引用名），且该引用名无兑现语义 ⇒ 显式拒绝：
  // 静默忽略等于让作者以为换 provider 时密钥已就位（换来的只是上游 401 或串端点）。
  const apiKeyRef = selection.route.api_key_ref
  if (apiKeyRef !== undefined) {
    throw new TierRouteUnsupportedError(
      configPath,
      `${selection.taskType}.${selection.tier}.api_key_ref`,
      `本入口无法按 api_key_ref（${apiKeyRef}）取密钥——密钥只来自 providers 注册表的 apiKeyEnv；` +
        `请把密钥放到该 provider 的 apiKeyEnv 环境变量，或移除该槽位`,
    )
  }

  return { configPath, selection, providers: config.providers }
}

/**
 * 注册表端点解析：**providerId → 实际出站端点**（本接线的核心不变量）。
 *
 * 三个出口全部是显式拒绝，没有任何回落：
 *   1. 注册表无该 providerId ⇒ NOT_REGISTERED（绝不回落到 BYOK 端点——那正是要消灭的
 *      「账本 providerId ≠ 实际端点」不一致）；
 *   2. baseURL 未过既有 SSRF 门禁 ⇒ ENDPOINT_REJECTED（复用 `assertSafeEndpointUrl`）；
 *   3. apiKeyEnv 指向的环境变量缺失/为空 ⇒ KEY_MISSING（不静默用别的密钥）。
 *
 * 返回端点的 providerId 归属由调用方原样写进账本：`pipelineRoutes.ts` 把
 * `route.selection.route.providerId` 作为 registerProviderBinding 的键与
 * `setGlobalOverride` 的值，而本函数用**同一个** providerId 查注册表取 baseURL/apiKey，
 * 二者同源，因此账本记录的 providerId 必然就是实际服务的那一个。
 *
 * `allowPrivateNetwork` 只认部署者环境变量（与 BYOK 同一开关），配置文件无权设置。
 */
export function resolveTierEndpoint(
  route: DraftTierRoute,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEndpoint {
  const { taskType, tier, route: leaf } = route.selection
  const entry: ProviderEntry | undefined = route.providers[leaf.providerId]
  if (entry === undefined) {
    throw new TierProviderError(
      'TIER_ROUTE_PROVIDER_NOT_REGISTERED',
      route.configPath,
      `${taskType}.${tier}.providerId`,
      `tier 叶子声明的 providerId '${leaf.providerId}' 未在 providers 注册表登记——` +
        `拒绝静默回落到 BYOK 端点（那会让账本 providerId 与实际出站端点不一致）；` +
        `请在 providers.${leaf.providerId} 处登记 { baseURL, apiKeyEnv }`,
    )
  }

  const allowPrivateNetwork = env[PRIVATE_NETWORK_ENV] === '1'
  try {
    assertSafeEndpointUrl(entry.baseURL, allowPrivateNetwork)
  } catch (err) {
    throw new TierProviderError(
      'TIER_ROUTE_PROVIDER_ENDPOINT_REJECTED',
      route.configPath,
      `providers.${leaf.providerId}.baseURL`,
      `baseURL '${entry.baseURL}' 未过出站 SSRF 门禁：${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const rawKey = env[entry.apiKeyEnv]
  if (rawKey === undefined || rawKey.trim().length === 0) {
    throw new TierProviderError(
      'TIER_ROUTE_PROVIDER_KEY_MISSING',
      route.configPath,
      `providers.${leaf.providerId}.apiKeyEnv`,
      `apiKeyEnv 指向的环境变量 ${entry.apiKeyEnv} 未设置（或为空）——` +
        `密钥只经环境变量提供，配置文件里不写密钥本体`,
    )
  }

  return {
    baseUrl: entry.baseURL,
    apiKey: rawKey.trim(),
    // model 由叶子声明（注册表的 models 是声明性清单，不改写出站值）。
    model: leaf.model,
    allowPrivateNetwork,
  }
}

/**
 * 模型覆盖（字段级）：route 为 null ⇒ 端点原样返回；否则只换 model，其余字段不动。
 *
 * 状态说明（诚实声明，不静默）：注册表落地后，生产草稿路径的端点由 `resolveTierEndpoint`
 * 一次构造（其中已含叶子 model），本函数不再被生产路径调用。它作为「叶子 model 覆盖端点
 * model」这一语义的字段级原语与单测保留——同一语义只应有一处实现，后续需要「只换 model、
 * 不动端点其余字段」的调用方应直接复用它。
 */
export function applyTierModel(
  endpoint: ResolvedEndpoint,
  route: DraftTierRoute | null,
): ResolvedEndpoint {
  if (route === null) return endpoint
  return { ...endpoint, model: route.selection.route.model }
}

/**
 * 覆盖生效的留痕行（不许静默生效）：task_type / tier / providerId 覆盖前后值、
 * 实际出站端点与来源配置文件。
 *
 * endpoint 一项在注册表落地后是**强制一致**的：providerId 与 baseURL 同源于
 * `resolveTierEndpoint` 的一次查表，留痕把二者并排写出，便于事后核对账本与出站是否同一家。
 */
export function tierRouteTraceLine(
  route: DraftTierRoute,
  served: {
    /** 覆盖前将生效的 providerId（包内默认 'deepseek'）。 */
    readonly defaultProviderId: string;
    /** 实际出站端点 baseUrl（由注册表解析 = providerId 的真实落点）。 */
    readonly endpointBaseUrl: string;
  },
): string {
  const { taskType, tier, route: leaf } = route.selection
  return (
    `[mozhou-tier-route] 分级路由覆盖生效 task_type=${taskType} tier=${tier} ` +
    `providerId=${served.defaultProviderId}→${leaf.providerId} ` +
    `model=${leaf.model} endpoint=${served.endpointBaseUrl} config=${route.configPath}`
  )
}
