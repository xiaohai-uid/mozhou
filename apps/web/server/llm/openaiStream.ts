/**
 * apps/web/server/llm · 真实 LLM 流式代理（OpenAI-compatible / DeepSeek / GLM）。
 * 安全约束（Mimosa）：仅允许 http/https 出站；请求前校验 host，拒绝
 * localhost、环回、私有与保留地址（SSRF 门禁）。
 */

export interface OpenAiStreamChunk {
  readonly delta: string;
  readonly finishReason?: string | undefined;
}

/** 从 provider 解析出的真实上游端点。 */
export interface ResolvedEndpoint {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

function isPrivateOrReservedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a = 0, b = 0, c = 0] = h.split('.').map((x) => Number.parseInt(x, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true; // 组播/保留
  }
  return false;
}

export function resolveChatEndpoint(env: NodeJS.ProcessEnv): ResolvedEndpoint | null {
  const apiKey = env['MOZHOU_API_KEY'] ?? env['DEEPSEEK_API_KEY'] ?? env['OPENAI_API_KEY'] ?? '';
  const baseUrl = env['MOZHOU_API_BASE'] ?? env['DEEPSEEK_API_BASE'] ?? env['OPENAI_API_BASE'] ?? '';
  const model = env['MOZHOU_MODEL'] ?? env['DEEPSEEK_MODEL'] ?? 'deepseek-chat';

  if (!apiKey) return null;
  const host = baseUrl ? new URL(baseUrl).hostname : 'api.deepseek.com';
  if (baseUrl && isPrivateOrReservedHost(host)) {
    throw new Error(`SSRF 门禁：拒绝调用私有/环回/保留地址 ${host}`);
  }
  return { baseUrl, apiKey, model };
}

/**
 * 发起真实 OpenAI-compatible Chat Completions 流式请求，逐 delta 产出。
 * 仅在已配置真实 Key 且显式非 mock 时调用；网络错误按流式错误语义上抛。
 */
export async function* streamOpenAiChat(
  endpoint: ResolvedEndpoint,
  prompt: string,
  systemPrompt: string,
): AsyncGenerator<OpenAiStreamChunk> {
  const base = endpoint.baseUrl || 'https://api.deepseek.com';
  const url = base.replace(/\/$/, '') + '/chat/completions';
  const target = new URL(url);
  if (isPrivateOrReservedHost(target.hostname)) {
    throw new Error(`SSRF 门禁：拒绝调用私有/环回/保留地址 ${target.hostname}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: true,
        temperature: 0.85,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(`上游 ${response.status}: ${errText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lineEnd: number;
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          controller.abort();
          return;
        }
        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[];
          };
          const choice = chunk.choices?.[0];
          if (choice) {
            const delta = choice.delta?.content ?? '';
            if (delta) yield { delta, finishReason: choice.finish_reason };
          }
        } catch {
          // 容忍坏 JSON 行
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
