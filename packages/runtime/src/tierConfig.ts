/**
 * Tier 路由配置加载器（T14 · 规格 §6，Q1/Q2/Q9/Q10）：
 * task_type → tier 名 → (providerId, model) 两级映射的 YAML 单文件加载。
 * - 机械校验 fail-fast：缺文件/缺档/结构非法 ⇒ 类型化确定性错误，报错指向具体键路径；
 * - mtime 缓存热加载：mtime 不变复用内存快照，变更后下一次解析生效（无需重启）；
 *   mtime 读取与时钟均可注入，测试零真实等待；
 * - 密钥间接引用：配置仅允许 api_key_ref 槽位名，任何层级出现明文 apiKey 字段即校验失败。
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
  readonly config: TierConfig;
  readonly loadedAtMs: number;
}

/** 进程内快照表：key 为绝对路径；mtime 未变 ⇒ 直接复用上次解析结果（规格 §6 热加载）。 */
const cache = new Map<string, CacheEntry>();

/** 机械白名单：路由对象仅允许这三个槽位名（密钥只走 api_key_ref）。 */
const ROUTE_KEYS: ReadonlySet<string> = new Set(['providerId', 'model', 'api_key_ref']);

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

function validateTierDoc(raw: unknown, filePath: string): TierConfig {
  if (raw === null || raw === undefined) {
    throw new TierConfigError('TIER_CONFIG_EMPTY', filePath, '配置文档为空（缺档）');
  }
  if (!isPlainObject(raw)) {
    throw new TierConfigError(
      'TIER_CONFIG_STRUCTURE_INVALID',
      filePath,
      '顶层必须是「task_type → tier 名 → 路由」的映射',
    );
  }
  assertNoPlaintextKey(raw, '', filePath);

  const config: Record<string, Record<string, TierRoute>> = {};
  for (const [taskType, tiers] of Object.entries(raw)) {
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
  return config;
}

/**
 * 加载 tier 路由配置：mtime 命中缓存直接返回内存快照，未命中则读取并机械校验。
 * source 接受路径字符串或 { filePath }；options 注入 mtime/时钟供确定性测试。
 */
export async function loadTierConfig(
  source: string | { filePath: string },
  options: TierConfigLoadOptions = {},
): Promise<TierConfig> {
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
