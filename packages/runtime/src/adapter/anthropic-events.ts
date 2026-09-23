/**
 * Anthropic 命名事件协议栈（T13 · 规格 §5）——Claude 档。
 * `event: <type>` + JSON data 双行解析 → text_delta 序列与 message_stop；
 * json_schema 请求体（output_config.format + strict tools 位）+ cache_control 占位；
 * 缓存计量读 message.usage 的 cache_read/cache_creation 字段。纯函数，零网络。
 */

export interface AnthropicCacheUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 命中前缀 tokens（cache_read_input_tokens）。 */
  readonly cacheReadInputTokens: number;
  /** 写入缓存 tokens（cache_creation_input_tokens）。 */
  readonly cacheCreationInputTokens: number;
}

export interface ParsedNamedEvents {
  readonly deltas: readonly string[];
  /** 是否见到 message_stop；截断流为 false。 */
  readonly sawMessageStop: boolean;
  readonly usage?: AnthropicCacheUsage;
}

/** 从 message_start.data.message.usage 提取四元组，缺失字段 0 保底。 */
function extractUsage(raw: Record<string, unknown>): AnthropicCacheUsage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    inputTokens: num(raw.input_tokens),
    outputTokens: num(raw.output_tokens),
    cacheReadInputTokens: num(raw.cache_read_input_tokens),
    cacheCreationInputTokens: num(raw.cache_creation_input_tokens),
  };
}

interface EventAccumulator {
  deltas: string[];
  sawMessageStop: boolean;
  usage?: AnthropicCacheUsage;
}

/** 单个已配对的 (eventType, dataJson) 处理：未知事件类型静默忽略（容忍协议演进）。 */
function consumeEvent(acc: EventAccumulator, eventType: string, data: Record<string, unknown>): void {
  switch (eventType) {
    case 'message_start': {
      const message = data.message;
      if (message !== null && typeof message === 'object') {
        acc.usage = extractUsage((message as Record<string, unknown>).usage as Record<string, unknown>);
      }
      return;
    }
    case 'content_block_delta': {
      const delta = data.delta;
      if (
        delta !== null &&
        typeof delta === 'object' &&
        (delta as Record<string, unknown>).type === 'text_delta'
      ) {
        const text = (delta as Record<string, unknown>).text;
        if (typeof text === 'string') acc.deltas.push(text);
      }
      return;
    }
    case 'message_stop': {
      acc.sawMessageStop = true;
      return;
    }
    default:
      return; // ping / content_block_start / content_block_stop / 未知事件：忽略
  }
}

/**
 * 解析 Anthropic 流式命名事件行序列。
 * 约定：`event: <type>` 行设定当前事件名，紧随的 `data: {...}` 行触发消费；
 * 未带 event 前缀的 data 行、坏 JSON、空行一律静默跳过。
 */
export function parseNamedEvents(rawLines: readonly string[]): ParsedNamedEvents {
  const acc: EventAccumulator = { deltas: [], sawMessageStop: false };
  let currentEvent = '';
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      currentEvent = trimmed.slice('event:'.length).trim();
      continue;
    }
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      continue; // 坏 JSON 容忍跳过
    }
    if (data === null || typeof data !== 'object') continue;
    if (!currentEvent) continue; // 孤儿 data 行：忽略
    consumeEvent(acc, currentEvent, data as Record<string, unknown>);
    currentEvent = '';
  }
  return {
    deltas: acc.deltas,
    sawMessageStop: acc.sawMessageStop,
    ...(acc.usage ? { usage: acc.usage } : {}),
  };
}

export interface BuildJsonSchemaBodyOptions {
  /** outputSchema：JSON Schema 对象，进 output_config.format.json_schema 与 strict 工具位两处。 */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly maxTokens?: number;
  /**
   * cache_control 双模占位（M17 缓存前缀策略按家参数化的 Claude 半边）：
   * - 'system'：system 以单 block 数组下发并打 ephemeral 标；
   * - 'none'：不下发 cache_control（默认）。
   */
  readonly cacheControlMode?: 'system' | 'none';
}

export interface JsonSchemaBodyOptions extends BuildJsonSchemaBodyOptions {
  readonly model: string;
  readonly system: string;
  readonly user: string;
}

/**
 * 构造 Claude messages 请求体：
 * - 主路：output_config.format = { type:'json_schema', schema }；
 * - strict 工具位：同名 __structured_output 工具以 input_schema=schema + strict:true 下发，
 *   供仅支持 tool-forced 输出的模型版本兜底（位说明即此双挂点契约）；
 * - 引导语注入 system 尾部，保证消息文本含 "json"。
 */
export function buildJsonSchemaBody(opts: JsonSchemaBodyOptions): Record<string, unknown> {
  const guidedSystem = `${opts.system}\n\n你必须只输出一个符合 json_schema 的 json 对象：不要 markdown 围栏、不要解释文字。`;
  const useCache = opts.cacheControlMode === 'system';
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    ...(useCache
      ? {
          system: [{ type: 'text', text: guidedSystem, cache_control: { type: 'ephemeral' } }],
        }
      : { system: guidedSystem }),
    messages: [{ role: 'user', content: opts.user }],
    output_config: { format: { type: 'json_schema', schema: opts.schema } },
    tools: [
      {
        name: '__structured_output',
        description: '按给定 JSON Schema 强制结构化输出的兜底工具位。',
        input_schema: opts.schema,
        strict: true,
      },
    ],
  };
  return body;
}
