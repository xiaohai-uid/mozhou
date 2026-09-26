/**
 * Tier 路由配置加载器（T14 · 规格 §6，Q1/Q2/Q9/Q10）：
 * task_type → tier 名 → (providerId, model) 两级映射的 YAML 单文件加载，
 * 外加规格 §6.1 的 `providers:` 供应商注册表（providerId → baseURL/apiKeyEnv）。
 * - 机械校验 fail-fast：缺文件/缺档/结构非法 ⇒ 类型化确定性错误，报错指向具体键路径；
 * - mtime 缓存热加载：mtime 不变复用内存快照，变更后下一次解析生效（无需重启）；
 *   mtime 读取与时钟均可注入，测试零真实等待；
 * - 密钥间接引用：配置仅允许 api_key_ref / apiKeyEnv 这类**引用名**槽位，任何层级出现
 *   明文 apiKey 字段即校验失败（密钥本体永不入配置文件）。
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/** tier 路由叶子：provider+model 复合键——裸模型 id 不直接绑进 task_type（隔离市场漂移）。 */
export interface TierRoute {
  readonly providerId: string;
  readonly model: string;
  /** 密钥间接引用槽位（环境变量/凭据引用名）；密钥本体永不入配置文件（规格 §6）。 */
  readonly api_key_ref?: string;
}

/** 两级路由表：task_type → tier 名 → 路由叶子。 */
export type TierConfig = Readonly<Record<string, Readonly<Record<string, TierRoute>>>>;

/** 注册表里声明的模型条目（规格 §6.1；**声明性**元数据，运行时不据此改写 model）。 */
export interface ProviderModelEntry {
  readonly id: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

/**
 * 供应商注册表条目（规格 §6.1）：端点与凭据的**间接**声明。
 * `apiKeyEnv` 是环境变量**名**，密钥本体永不入配置文件（credentials refs 模式）。
 */
export interface ProviderEntry {
  /** 出站端点基址；发请求前仍由 web 侧既有 SSRF 门禁复检（配置不是可信来源）。 */
  readonly baseURL: string;
  /** 密钥所在环境变量名（引用名，不是密钥本体）。 */
  readonly apiKeyEnv: string;
  /** 声明性模型清单；出站 model 始终取 tier 叶子声明的值。 */
  readonly models?: readonly ProviderModelEntry[];
}

/** providerId → 端点/凭据引用（规格 §6.1）。 */
export type ProviderRegistry = Readonly<Record<string, ProviderEntry>>;

/** 一个配置文件解析出的全部内容：tier 路由表 + 供应商注册表。 */
export interface TierConfigFile {
  readonly routes: TierConfig;
  readonly providers: ProviderRegistry;
}

/** 顶层保留键：`providers` 是注册表段，绝不被当作 task_type 解析。 */
export const PROVIDERS_KEY = 'providers';

export type TierConfigErrorCode =
  | 'TIER_CONFIG_FILE_NOT_FOUND'
  | 'TIER_CONFIG_EMPTY'
  | 'TIER_CONFIG_STRUCTURE_INVALID'
  | 'TIER_CONFIG_PLAINTEXT_KEY';

/** 配置加载期确定性错误面（沿 NoProviderError 风格）：类型化 code + 文件/键路径字段。 */
export class TierConfigError extends Error {
  override name = 'TierConfigError';
  readonly code: TierConfigErrorCode;
  readonly filePath: string;
  readonly keyPath?: string | undefined;

  constructor(code: TierConfigErrorCode, filePath: string, detail: string, keyPath?: string) {
    super(`${code}: ${detail}（${filePath}${keyPath === undefined ? '' : ` @ ${keyPath}`}）`);
    this.code = code;
    this.filePath = filePath;
    this.keyPath = keyPath;
  }
}

/** 可注入面：statMtimeMs 供热加载确定性验证，now 供缓存时间戳零时钟验证。 */
export interface TierConfigLoadOptions {
  /** 注入 mtime 读取（毫秒）；默认 fs.stat。测试拨动假值即可触发热加载，禁止真实 sleep。 */
  readonly statMtimeMs?: (filePath: string) => number | Promise<number>;
  /** 注入时钟；默认 Date.now。 */
  readonly now?: () => number;
}

interface CacheEntry {
  readonly mtimeMs: number;
  readonly config: TierConfigFile;
  readonly loadedAtMs: number;
}

/** 进程内快照表：key 为绝对路径；mtime 未变 ⇒ 直接复用上次解析结果（规格 §6 热加载）。 */
const cache = new Map<string, CacheEntry>();

/** 机械白名单：路由对象仅允许这三个槽位名（密钥只走 api_key_ref）。 */
const ROUTE_KEYS: ReadonlySet<string> = new Set(['providerId', 'model', 'api_key_ref']);

/** 注册表条目白名单（规格 §6.1：baseURL / apiKeyEnv / models）。 */
const PROVIDER_KEYS: ReadonlySet<string> = new Set(['baseURL', 'apiKeyEnv', 'models']);

/** 注册表模型条目白名单（规格 §6.1）。 */
const MODEL_KEYS: ReadonlySet<string> = new Set(['id', 'contextWindow', 'maxTokens']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errnoOf(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String(err.code)
    : undefined;
}

async function defaultStatMtimeMs(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch (err) {
    if (errnoOf(err) === 'ENOENT') {
      throw new TierConfigError('TIER_CONFIG_FILE_NOT_FOUND', filePath, '配置文件不存在');
    }
    throw err;
  }
}

/** 全文档递归扫描：任意层级的明文 apiKey 字段都在解析期拦截（fail-fast 先于结构走查）。 */
function assertNoPlaintextKey(node: unknown, parentPath: string, filePath: string): void {
  if (!isPlainObject(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const keyPath = parentPath === '' ? key : `${parentPath}.${key}`;
    if (key === 'apiKey') {
      throw new TierConfigError(
        'TIER_CONFIG_PLAINTEXT_KEY',
        filePath,
        '检测到明文 apiKey 字段——密钥只允许经 api_key_ref 间接引用',
        keyPath,
      );
    }
    assertNoPlaintextKey(value, keyPath, filePath);
  }
}

/** 注册表 `models` 段校验（可省略；声明了就必须是「非空数组 + 合法条目」）。 */
function validateProviderModels(
  raw: unknown,
  filePath: string,
  keyPath: string,
): readonly ProviderModelEntry[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TierConfigError(
      'TIER_CONFIG_STRUCTURE_INVALID',
      filePath,
      'models 必须是非空数组（不需要就整段省略）',
      keyPath,
    );
  }
  const models: ProviderModelEntry[] = [];
  for (const [index, item] of raw.entries()) {
    const itemPath = `${keyPath}[${index}]`;
    if (!isPlainObject(item)) {
      throw new TierConfigError(
        'TIER_CONFIG_STRUCTURE_INVALID',
        filePath,
        '模型条目必须是对象（{ id, contextWindow?, maxTokens? }）',
        itemPath,
      );
    }
    for (const field of Object.keys(item)) {
      if (!MODEL_KEYS.has(field)) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          '未知模型字段——仅允许 id / contextWindow / maxTokens',
          `${itemPath}.${field}`,
        );
      }
    }
    const id = item.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new TierConfigError(
        'TIER_CONFIG_STRUCTURE_INVALID',
        filePath,
        '模型 id 必须是非空字符串',
        `${itemPath}.id`,
      );
    }
    const entry: { id: string; contextWindow?: number; maxTokens?: number } = { id };
    for (const field of ['contextWindow', 'maxTokens'] as const) {
      const value = item[field];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          `${field} 必须是正整数`,
          `${itemPath}.${field}`,
        );
      }
      entry[field] = value;
    }
    models.push(entry);
  }
  return models;
}

/**
 * 注册表段校验（规格 §6.1 冻结形态）：providerId → { baseURL, apiKeyEnv, models? }。
 * 密钥本体由 `assertNoPlaintextKey` 在更早的全文档扫描里拦截；本段只认引用名。
 */
function validateProviderRegistry(raw: unknown, filePath: string): ProviderRegistry {
  if (!isPlainObject(raw)) {
    throw new TierConfigError(
      'TIER_CONFIG_STRUCTURE_INVALID',
      filePath,
      'providers 必须是「providerId → { baseURL, apiKeyEnv, models? }」的映射',
      PROVIDERS_KEY,
    );
  }
  if (Object.keys(raw).length === 0) {
    throw new TierConfigError(
      'TIER_CONFIG_STRUCTURE_INVALID',
      filePath,
      'providers 下必须至少登记一个 provider（不需要就整段省略）',
      PROVIDERS_KEY,
    );
  }

  const registry: Record<string, ProviderEntry> = {};
  for (const [providerId, entry] of Object.entries(raw)) {
    const keyPath = `${PROVIDERS_KEY}.${providerId}`;
    if (providerId.length === 0) {
      throw new TierConfigError('TIER_CONFIG_STRUCTURE_INVALID', filePath, 'providerId 必须是非空字符串', PROVIDERS_KEY);
    }
    if (!isPlainObject(entry)) {
      throw new TierConfigError(
        'TIER_CONFIG_STRUCTURE_INVALID',
        filePath,
        '必须是 { baseURL, apiKeyEnv, models? } 对象',
        keyPath,
      );
    }
    for (const field of Object.keys(entry)) {
      if (!PROVIDER_KEYS.has(field)) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          '未知 provider 字段——仅允许 baseURL / apiKeyEnv / models',
          `${keyPath}.${field}`,
        );
      }
    }
    const baseURL = entry.baseURL;
    if (typeof baseURL !== 'string' || baseURL.length === 0) {
      throw new TierConfigError(
        'TIER_CONFIG_STRUCTURE_INVALID',
        filePath,
        'baseURL 必须是非空字符串（http/https 端点基址）',
        `${keyPath}.baseURL`,
      );
    }
    const apiKeyEnv = entry.apiKeyEnv;
    if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0) {
      throw new TierConfigError(
        'TIER_CONFIG_STRUCTURE_INVALID',
        filePath,
        'apiKeyEnv 必须是非空字符串（环境变量名，不是密钥本体）',
        `${keyPath}.apiKeyEnv`,
      );
    }
    const models = validateProviderModels(entry.models, filePath, `${keyPath}.models`);
    // exactOptionalPropertyTypes：未声明 models 时不落该键
    registry[providerId] =
      models === undefined ? { baseURL, apiKeyEnv } : { baseURL, apiKeyEnv, models };
  }
  return registry;
}

function validateTierDoc(raw: unknown, filePath: string): TierConfigFile {
  if (raw === null || raw === undefined) {
    throw new TierConfigError('TIER_CONFIG_EMPTY', filePath, '配置文档为空（缺档）');
  }
  if (!isPlainObject(raw)) {
    throw new TierConfigError(
      'TIER_CONFIG_STRUCTURE_INVALID',
      filePath,
      '顶层必须是「task_type → tier 名 → 路由」的映射（外加可选的 providers 注册表段）',
    );
  }
  assertNoPlaintextKey(raw, '', filePath);

  // `providers` 是保留键：先摘出注册表段，其余顶层键才是 task_type。
  const rawProviders = raw[PROVIDERS_KEY];
  const providers =
    rawProviders === undefined ? {} : validateProviderRegistry(rawProviders, filePath);

  const config: Record<string, Record<string, TierRoute>> = {};
  for (const [taskType, tiers] of Object.entries(raw)) {
    if (taskType === PROVIDERS_KEY) continue;
    if (!isPlainObject(tiers) || Object.keys(tiers).length === 0) {
      throw new TierConfigError(
        'TIER_CONFIG_STRUCTURE_INVALID',
        filePath,
        `${taskType} 下必须至少有一个 tier 条目`,
        taskType,
      );
    }
    const tiersOut: Record<string, TierRoute> = {};
    for (const [tierName, route] of Object.entries(tiers)) {
      const keyPath = `${taskType}.${tierName}`;
      if (!isPlainObject(route)) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          '必须是路由对象（providerId / model / api_key_ref）',
          keyPath,
        );
      }
      for (const field of Object.keys(route)) {
        if (!ROUTE_KEYS.has(field)) {
          throw new TierConfigError(
            'TIER_CONFIG_STRUCTURE_INVALID',
            filePath,
            `未知路由字段——仅允许 providerId / model / api_key_ref`,
            `${keyPath}.${field}`,
          );
        }
      }
      const providerId = route.providerId;
      const model = route.model;
      const apiKeyRef = route.api_key_ref;
      if (typeof providerId !== 'string' || providerId.length === 0) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          'providerId 必须是非空字符串',
          `${keyPath}.providerId`,
        );
      }
      if (typeof model !== 'string' || model.length === 0) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          'model 必须是非空字符串',
          `${keyPath}.model`,
        );
      }
      if (apiKeyRef !== undefined && (typeof apiKeyRef !== 'string' || apiKeyRef.length === 0)) {
        throw new TierConfigError(
          'TIER_CONFIG_STRUCTURE_INVALID',
          filePath,
          'api_key_ref 必须是非空字符串（引用名，不是密钥本体）',
          `${keyPath}.api_key_ref`,
        );
      }
      // exactOptionalPropertyTypes：无引用时不落 api_key_ref 键
      tiersOut[tierName] =
        apiKeyRef === undefined ? { providerId, model } : { providerId, model, api_key_ref: apiKeyRef };
    }
    config[taskType] = tiersOut;
  }
  if (Object.keys(config).length === 0) {
    // 只有 providers 段（或全被保留键吃掉）时无路由可言：显式失败而不是返回空表，
    // 否则调用方会拿到一个「解析成功但永远选不到叶子」的假成功。
    throw new TierConfigError(
      'TIER_CONFIG_EMPTY',
      filePath,
      '配置文档没有任何 task_type 路由（providers 段本身不构成路由）',
    );
  }
  return { routes: config, providers };
}

/**
 * 加载 tier 路由配置：mtime 命中缓存直接返回内存快照，未命中则读取并机械校验。
 * source 接受路径字符串或 { filePath }；options 注入 mtime/时钟供确定性测试。
 */
export async function loadTierConfigFile(
  source: string | { filePath: string },
  options: TierConfigLoadOptions = {},
): Promise<TierConfigFile> {
  const requested = typeof source === 'string' ? source : source.filePath;
  const filePath = resolve(requested);
  const statMtimeMs = options.statMtimeMs ?? defaultStatMtimeMs;
  const now = options.now ?? Date.now;

  const mtimeMs = await statMtimeMs(filePath);
  const cached = cache.get(filePath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    return cached.config;
  }

  let raw: unknown;
  try {
    raw = parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (errnoOf(err) === 'ENOENT') {
      throw new TierConfigError('TIER_CONFIG_FILE_NOT_FOUND', filePath, '配置文件不存在');
    }
    throw new TierConfigError(
      'TIER_CONFIG_STRUCTURE_INVALID',
      filePath,
      `YAML 解析失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const config = validateTierDoc(raw, filePath);
  cache.set(filePath, { mtimeMs, config, loadedAtMs: now() });
  return config;
}

/**
 * 只要路由表的既有入口（flywheel 评测器按叶子逐条判 incumbent，不解析端点）。
 * 需要注册表时用 `loadTierConfigFile`；两者共享同一份 mtime 缓存快照。
 */
export async function loadTierConfig(
  source: string | { filePath: string },
  options: TierConfigLoadOptions = {},
): Promise<TierConfig> {
  return (await loadTierConfigFile(source, options)).routes;
}
