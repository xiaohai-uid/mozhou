/**
 * Provider 错误归一化（T13 · 规格 §5）——三家错误分类学 → 统一 {code, retryable}。
 * 表驱动：DeepSeek HTTP 直码 / GLM 双层业务码 / Claude named error_type。
 * 判定顺序：家内业务码（GLM code、Claude errorType）优先，status 作兜底层；
 * 5xx 一律归 overloaded 且 retryable，未知默认不可重试（保守）。
 */

export type NormalizedProviderId = 'deepseek' | 'glm' | 'claude';

export type ProviderErrorCode =
  | 'rate_limit'
  | 'auth'
  | 'balance'
  | 'overloaded'
  | 'invalid_request'
  | 'unknown';

export interface RawProviderError {
  /** HTTP 状态码。 */
  readonly status?: number;
  /** 业务码：GLM 双层码（1113/1302/1305…）；DeepSeek 侧通常与 status 同值。 */
  readonly code?: number | string;
  /** Claude named error_type：rate_limit_error / overloaded_error / … */
  readonly errorType?: string;
}

export interface NormalizedProviderError {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  /** 家侧原始可读信息（errorType/业务码/status 拼接），供日志与人工兜底模板引用。 */
  readonly providerMessage: string;
}

interface Verdict {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
}

const RETRYABLE: Readonly<Record<ProviderErrorCode, boolean>> = {
  rate_limit: true,
  overloaded: true,
  auth: false,
  balance: false,
  invalid_request: false,
  unknown: false,
};

/** DeepSeek：HTTP 状态直码表（402 Insufficient Balance 是其特色档）。 */
const DEEPSEEK_STATUS_MAP: ReadonlyMap<number, Verdict> = new Map([
  [400, { code: 'invalid_request', retryable: false }],
  [401, { code: 'auth', retryable: false }],
  [402, { code: 'balance', retryable: false }],
  [403, { code: 'auth', retryable: false }],
  [422, { code: 'invalid_request', retryable: false }],
  [429, { code: 'rate_limit', retryable: true }],
]);

/** GLM：业务码优先层——1113/1302/1305 为限流族（等价 HTTP 429），1001/1002 鉴权族。 */
const GLM_BUSINESS_CODE_MAP: ReadonlyMap<number, Verdict> = new Map([
  [1113, { code: 'rate_limit', retryable: true }],
  [1302, { code: 'rate_limit', retryable: true }],
  [1305, { code: 'rate_limit', retryable: true }],
  [1001, { code: 'auth', retryable: false }],
  [1002, { code: 'auth', retryable: false }],
]);

/** Claude：named error_type 表；retry-after 属传输头，V1 不入参，rate_limit_error 固定可重试。 */
const CLAUDE_ERROR_TYPE_MAP: ReadonlyMap<string, Verdict> = new Map([
  ['rate_limit_error', { code: 'rate_limit', retryable: true }],
  ['overloaded_error', { code: 'overloaded', retryable: true }],
  ['api_error', { code: 'overloaded', retryable: true }],
  ['authentication_error', { code: 'auth', retryable: false }],
  ['permission_error', { code: 'auth', retryable: false }],
  ['invalid_request_error', { code: 'invalid_request', retryable: false }],
  ['not_found_error', { code: 'invalid_request', retryable: false }],
  ['request_too_large', { code: 'invalid_request', retryable: false }],
]);

function statusFallback(status: number | undefined): Verdict {
  if (status === undefined) return { code: 'unknown', retryable: false };
  if (status === 401 || status === 403) return { code: 'auth', retryable: false };
  if (status === 402) return { code: 'balance', retryable: false };
  if (status === 429) return { code: 'rate_limit', retryable: true };
  if (status >= 500) return { code: 'overloaded', retryable: true };
  if (status >= 400) return { code: 'invalid_request', retryable: false };
  return { code: 'unknown', retryable: false };
}

/**
 * 三家错误样本 → 统一错误码 + 重试判定。
 * - deepseek：status 主判（其直码即 HTTP 层），code 仅作日志；
 * - glm：双层——code 业务码先查 GLM_BUSINESS_CODE_MAP，未命中回落 status 层；
 * - claude：errorType 先查 CLAUDE_ERROR_TYPE_MAP（含 529 overloaded），未命中回落 status。
 */
export function normalizeProviderError(
  provider: NormalizedProviderId,
  raw: RawProviderError,
): NormalizedProviderError {
  let verdict: Verdict;
  switch (provider) {
    case 'deepseek':
      verdict =
        (raw.status !== undefined ? DEEPSEEK_STATUS_MAP.get(raw.status) : undefined) ??
        statusFallback(raw.status);
      break;
    case 'glm': {
      const businessCode = typeof raw.code === 'number' ? raw.code : Number(raw.code);
      verdict =
        (Number.isFinite(businessCode) ? GLM_BUSINESS_CODE_MAP.get(businessCode) : undefined) ??
        statusFallback(raw.status);
      break;
    }
    case 'claude':
      verdict =
        (raw.errorType !== undefined && raw.errorType !== ''
          ? CLAUDE_ERROR_TYPE_MAP.get(raw.errorType)
          : undefined) ?? statusFallback(raw.status);
      break;
  }
  const rawBits = [
    raw.errorType !== undefined && raw.errorType !== '' ? `error_type=${raw.errorType}` : null,
    raw.code !== undefined && raw.code !== '' ? `code=${raw.code}` : null,
    raw.status !== undefined ? `status=${raw.status}` : null,
  ].filter((b): b is string => b !== null);
  return {
    code: verdict.code,
    retryable: verdict.retryable ?? RETRYABLE[verdict.code],
    providerMessage: `${provider}: ${rawBits.length > 0 ? rawBits.join(' ') : '无原始信息'}`,
  };
}
