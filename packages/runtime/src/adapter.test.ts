/**
 * T13 adapter 测试——全部离线夹具：SSE 行样本 / JSON 样本，零网络。
 * 覆盖：正常流 / 截断 / 未知事件容忍 / 错误码映射表逐行断言 /
 * json_object 与 json_schema 请求体两档（#30 B 路）/ 缓存字段三家对照。
 */
import { describe, expect, it } from 'vitest';
import { buildJsonRequestBody, parseDataOnlySse } from './adapter/openai-compat.js';
import {
  buildJsonSchemaBody,
  parseNamedEvents,
  type AnthropicCacheUsage,
} from './adapter/anthropic-events.js';
import { normalizeProviderError } from './adapter/errors.js';

// ---------- OpenAI 兼容档（DeepSeek/GLM 同栈） ----------

describe('parseDataOnlySse', () => {
  it('正常流：delta 序列 + finish_reason + include_usage 尾 chunk 缓存计量（DeepSeek 字段）', () => {
    const lines = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"你好"}}]}',
      '',
      ': keep-alive 注释行应被忽略',
      'data: {"choices":[{"delta":{"content":"，墨舟"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":100,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":36,"total_tokens":150}}',
      'data: [DONE]',
      // DONE 之后不应再消费：
      'data: {"choices":[{"delta":{"content":"越界"}}]}',
    ];
    const r = parseDataOnlySse(lines);
    expect(r.deltas).toEqual(['你好', '，墨舟']);
    expect(r.finishReason).toBe('stop');
    expect(r.usage).toEqual({ promptCacheHitTokens: 64, promptCacheMissTokens: 36 });
  });

  it('截断流：无 [DONE] 无 finish_reason ⇒ 部分照收、finishReason undefined', () => {
    const r = parseDataOnlySse([
      'data: {"choices":[{"delta":{"content":"写到一半"}}]}',
      'data: {"choices":[{"delta":{"content":"就断了"}}]}',
    ]);
    expect(r.deltas).toEqual(['写到一半', '就断了']);
    expect(r.finishReason).toBeUndefined();
    expect(r.usage).toBeUndefined();
  });

  it('脏数据容忍：坏 JSON 行 / 空 data / 孤儿标量静默跳过不抛错', () => {
    const r = parseDataOnlySse([
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      'data: {broken json',
      'data:',
      'data: null',
      'event: alien_event',
      'data: {"choices":[{"delta":{"content":"b"}}]}',
    ]);
    expect(r.deltas).toEqual(['a', 'b']);
  });

  it('GLM/OpenAI cached_tokens 变体归一到同一缓存出口；miss 由 prompt_tokens 推算', () => {
    const glm = parseDataOnlySse([
      'data: {"choices":[],"usage":{"prompt_tokens":80,"cached_tokens":50,"completion_tokens":20}}',
      'data: [DONE]',
    ]);
    expect(glm.usage).toEqual({ promptCacheHitTokens: 50, promptCacheMissTokens: 30 });
    const openaiDetail = parseDataOnlySse([
      'data: {"choices":[],"usage":{"prompt_tokens":80,"prompt_tokens_details":{"cached_tokens":24}}}',
      'data: [DONE]',
    ]);
    expect(openaiDetail.usage).toEqual({ promptCacheHitTokens: 24, promptCacheMissTokens: 56 });
  });
});

describe('buildJsonRequestBody', () => {
  it('jsonMode=true ⇒ response_format json_object + system 含 "json" 引导语 + include_usage 流位', () => {
    const body = buildJsonRequestBody('deepseek-chat', '你是大纲师', '写第一章', { jsonMode: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.stream_options).toEqual({ include_usage: true });
    const messages = body.messages as { role: string; content: string }[];
    const system = messages[0] ?? { role: '', content: '' };
    expect(system.role).toBe('system');
    expect(system.content.toLowerCase()).toContain('json');
  });

  it('jsonMode 缺省 ⇒ 不下发 response_format，其余位不变', () => {
    const body = buildJsonRequestBody('glm-4-plus', '系统提示', '用户输入');
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '用户输入' },
    ]);
  });
});

// ---------- Anthropic 命名事件档 ----------

const ANTHROPIC_USAGE: AnthropicCacheUsage = {
  inputTokens: 200,
  outputTokens: 0,
  cacheReadInputTokens: 180,
  cacheCreationInputTokens: 12,
};

describe('parseNamedEvents', () => {
  it('正常流：text_delta 序列 + message_stop + message_start 缓存计量', () => {
    const r = parseNamedEvents([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"output_tokens":0,"cache_read_input_tokens":180,"cache_creation_input_tokens":12}}}',
      '',
      'event: ping',
      'data: {"type":"ping"}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"第一章"}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"开篇"}}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ]);
    expect(r.deltas).toEqual(['第一章', '开篇']);
    expect(r.sawMessageStop).toBe(true);
    expect(r.usage).toEqual(ANTHROPIC_USAGE);
  });

  it('截断流：无 message_stop ⇒ sawMessageStop false，已有 delta 照收', () => {
    const r = parseNamedEvents([
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"半截"}}',
    ]);
    expect(r.deltas).toEqual(['半截']);
    expect(r.sawMessageStop).toBe(false);
    expect(r.usage?.cacheReadInputTokens).toBe(0); // 缺失字段 0 保底
  });

  it('未知事件容忍：thinking_delta / 自造事件被忽略，仅 text_delta 入列', () => {
    const r = parseNamedEvents([
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"推理中"}}',
      'event: vendor_custom_event',
      'data: {"type":"vendor_custom_event","x":1}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"正文"}}',
      'data: {"orphan":"无 event 前缀的 data 行忽略"}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ]);
    expect(r.deltas).toEqual(['正文']);
    expect(r.sawMessageStop).toBe(true);
  });
});

describe('buildJsonSchemaBody', () => {
  const schema = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } };

  it('主路 output_config.format=json_schema + strict 工具位双挂点 + "json" 引导语', () => {
    const body = buildJsonSchemaBody({
      model: 'claude-sonnet-4-5',
      system: '你是章节写手',
      user: '输出结构化章节',
      schema,
    });
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema } });
    const tools = body.tools as { name: string; strict: boolean; input_schema: unknown }[];
    const firstTool = tools[0] ?? { name: '', strict: false, input_schema: {} };
    expect(firstTool.name).toBe('__structured_output');
    expect(firstTool.strict).toBe(true);
    expect(firstTool.input_schema).toEqual(schema);
    expect(body.system as string).toContain('json');
  });

  it('cache_control 双模占位：mode=system 打 ephemeral 标，缺省为纯文本 system', () => {
    const withCache = buildJsonSchemaBody({
      model: 'm', system: 's', user: 'u', schema,
      cacheControlMode: 'system',
    });
    const blocks = withCache.system as { type: string; text: string; cache_control: { type: string } }[];
    const block = blocks[0] ?? { type: '', text: '', cache_control: { type: '' } };
    expect(block.type).toBe('text');
    expect(block.text).toContain('s');
    expect(block.cache_control).toEqual({ type: 'ephemeral' });
    const noCache = buildJsonSchemaBody({ model: 'm', system: 's', user: 'u', schema });
    expect(typeof noCache.system).toBe('string');
    expect(noCache.cache_control).toBeUndefined();
  });
});

// ---------- 错误归一化映射表逐行断言 ----------

describe('normalizeProviderError 映射表逐行', () => {
  const TABLE: readonly {
    provider: 'deepseek' | 'glm' | 'claude';
    raw: { status?: number; code?: number | string; errorType?: string };
    code: string;
    retryable: boolean;
  }[] = [
    // DeepSeek HTTP 直码
    { provider: 'deepseek', raw: { status: 429 }, code: 'rate_limit', retryable: true },
    { provider: 'deepseek', raw: { status: 402 }, code: 'balance', retryable: false },
    { provider: 'deepseek', raw: { status: 401 }, code: 'auth', retryable: false },
    { provider: 'deepseek', raw: { status: 400 }, code: 'invalid_request', retryable: false },
    { provider: 'deepseek', raw: { status: 503 }, code: 'overloaded', retryable: true },
    // GLM 双层业务码 → 429 系
    { provider: 'glm', raw: { code: 1113 }, code: 'rate_limit', retryable: true },
    { provider: 'glm', raw: { code: 1302 }, code: 'rate_limit', retryable: true },
    { provider: 'glm', raw: { code: 1305 }, code: 'rate_limit', retryable: true },
    { provider: 'glm', raw: { code: 1002 }, code: 'auth', retryable: false },
    { provider: 'glm', raw: { status: 429 }, code: 'rate_limit', retryable: true }, // status 兜底层
    // Claude named error_type（含 529 overloaded）
    { provider: 'claude', raw: { errorType: 'rate_limit_error' }, code: 'rate_limit', retryable: true },
    { provider: 'claude', raw: { errorType: 'overloaded_error', status: 529 }, code: 'overloaded', retryable: true },
    { provider: 'claude', raw: { errorType: 'authentication_error' }, code: 'auth', retryable: false },
    { provider: 'claude', raw: { errorType: 'invalid_request_error' }, code: 'invalid_request', retryable: false },
    { provider: 'claude', raw: { errorType: 'api_error', status: 500 }, code: 'overloaded', retryable: true },
    // 未知兜底：保守不可重试
    { provider: 'deepseek', raw: {}, code: 'unknown', retryable: false },
    { provider: 'glm', raw: { code: 9999 }, code: 'unknown', retryable: false },
    { provider: 'claude', raw: { errorType: 'brand_new_error' }, code: 'unknown', retryable: false },
  ];

  it.each(TABLE)('$provider ${JSON.stringify($raw)} → $code(retryable=$retryable)', ({ provider, raw, code, retryable }) => {
    const out = normalizeProviderError(provider, raw);
    expect(out.code).toBe(code);
    expect(out.retryable).toBe(retryable);
  });

  it('providerMessage 携带家侧原始信息', () => {
    expect(normalizeProviderError('claude', { errorType: 'rate_limit_error' }).providerMessage)
      .toMatch(/^claude: error_type=rate_limit_error/);
  });
});
