/**
 * OpenAI 兼容协议栈（T13 · 规格 §5）——服务 DeepSeek 与 GLM 两家。
 * data-only SSE 行解析器 + json_object 请求体构造 + 缓存计量。
 * 全部纯函数，零网络调用（L2 live smoke 留后续票）。
 */

/** 缓存计量统一出口：三家字段归一到 hit/miss 一对数值（M18 命中计量接口的 adapter 半边）。 */
export interface PromptCacheUsage {
  /** 命中前缀 tokens：DeepSeek=prompt_cache_hit_tokens，GLM/OpenAI=cached_tokens。 */
  readonly promptCacheHitTokens: number;
  /** 未命中 tokens：DeepSeek 直供；否则按 prompt_tokens − hit 推算。 */
  readonly promptCacheMissTokens: number;
}

export interface ParsedDataOnlySse {
  readonly deltas: readonly string[];
  readonly usage?: PromptCacheUsage;
  /** 最后一个非空 finish_reason；流被截断（无 [DONE]）时通常为 undefined。 */
  readonly finishReason?: string;
}

/** 从单个 usage 对象提取缓存对：三家字段名对照表驱动，未命中给 0 保底。 */
function extractCacheUsage(usage: Record<string, unknown>): PromptCacheUsage | undefined {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const detail = usage.prompt_tokens_details;
  const hitCandidates = [
    usage.prompt_cache_hit_tokens,
    usage.cached_tokens,
    detail !== null && typeof detail === 'object'
      ? (detail as Record<string, unknown>).cached_tokens
      : undefined,
  ];
  const hit = hitCandidates.find(num);
  const promptTokens = usage.prompt_tokens;
  if (hit === undefined && !num(promptTokens)) return undefined;
  const hitTokens = hit ?? 0;
  const missDirect = usage.prompt_cache_miss_tokens;
  const missTokens = num(missDirect)
    ? missDirect
    : num(promptTokens)
      ? Math.max(promptTokens - hitTokens, 0)
      : 0;
  return { promptCacheHitTokens: hitTokens, promptCacheMissTokens: missTokens };
}

/**
 * 解析 data-only SSE 行序列（OpenAI Chat Completions 档，DeepSeek/GLM 同栈）。
 * - `data: [DONE]` 即终止，其后行不再消费；
 * - 尾 chunk（stream_options.include_usage 开启）携带 usage ⇒ 提取缓存计量；
 * - choices[0].delta.content 追加进 deltas，choices[0].finish_reason 取最后一个；
 * - 空 data、坏 JSON、未知形状一律静默跳过（容忍脏行，不抛错）。
 */
export function parseDataOnlySse(rawLines: readonly string[]): ParsedDataOnlySse {
  const deltas: string[] = [];
  let usage: PromptCacheUsage | undefined;
  let finishReason: string | undefined;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (payload === '[DONE]') break;
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // 坏 JSON 容忍跳过
    }
    if (chunk === null || typeof chunk !== 'object') continue;
    const obj = chunk as {
      choices?: {
        delta?: { content?: unknown };
        finish_reason?: unknown;
      }[];
      usage?: unknown;
    };
    const choice = obj.choices?.[0];
    if (choice) {
      if (typeof choice.delta?.content === 'string') deltas.push(choice.delta.content);
      if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') {
        finishReason = choice.finish_reason;
      }
    }
    if (obj.usage !== null && typeof obj.usage === 'object') {
      const extracted = extractCacheUsage(obj.usage as Record<string, unknown>);
      if (extracted) usage = extracted;
    }
  }
  return { deltas, ...(usage ? { usage } : {}), ...(finishReason ? { finishReason } : {}) };
}

export interface BuildJsonBodyOptions {
  /** true ⇒ response_format={'type':'json_object'} 且 system 追加含 "json" 的引导说明（#30 B 路）。 */
  readonly jsonMode?: boolean;
  readonly stream?: boolean;
}

/**
 * 构造 OpenAI 兼容 chat/completions 请求体。
 * json_mode 协议要求消息文本中必须出现 "json" 字样，故引导语固定注入 system 尾部。
 */
export function buildJsonRequestBody(
  model: string,
  system: string,
  user: string,
  opts: BuildJsonBodyOptions = {},
): Record<string, unknown> {
  const stream = opts.stream ?? true;
  const guidedSystem = opts.jsonMode
    ? `${system}\n\n你必须只输出一个合法的 json 对象：不要 markdown 围栏、不要解释文字，所有内容都放在这个 json 里。`
    : system;
  const body: Record<string, unknown> = {
    model,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    messages: [
      { role: 'system', content: guidedSystem },
      { role: 'user', content: user },
    ],
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };
  return body;
}
