import type { StreamDelta, StreamProvider } from "@/lib/pipeline/engine";
import type { ChatMessage, PreparedChatRequest } from "./payload";

export type CompletionRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
};

export type CompletionResult = {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

export interface CompletionAdapter {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface LlmTransport extends CompletionAdapter {
  stream(request: PreparedChatRequest, signal?: AbortSignal): StreamProvider;
}

export type OneApiTransportConfig = {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
};

export class LlmTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LlmTransportError";
  }
}

function requestMessages(system: string | undefined, messages: ChatMessage[]) {
  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    ...messages,
  ];
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function safeErrorDetail(value: unknown, token: string): string {
  const raw = typeof value === "string" ? value : "";
  const redactedToken = token ? raw.replaceAll(token, "[redacted]") : raw;
  const redacted = redactedToken.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
  return redacted.slice(0, 200);
}

function fetchError(error: unknown, token: string): LlmTransportError {
  return new LlmTransportError(`LLM transport request failed: ${safeErrorDetail((error as Error)?.message, token) || "network error"}`);
}

async function responseError(response: Response, token: string): Promise<LlmTransportError> {
  let detail = "";
  try {
    const body = await response.json() as { error?: { message?: unknown }; message?: unknown };
    detail = safeErrorDetail(body.error?.message ?? body.message, token);
  } catch {
    // The status is sufficient when the gateway does not return JSON.
  }
  return new LlmTransportError(
    `LLM transport HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    response.status,
  );
}

class OneApiLlmTransport implements LlmTransport {
  private readonly endpoint: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(private readonly config: Required<OneApiTransportConfig>) {
    this.endpoint = `${normalizedBaseUrl(config.baseUrl)}/v1/chat/completions`;
    this.fetcher = config.fetch;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          model: request.model,
          stream: false,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          messages: requestMessages(request.system, request.messages),
        }),
      });
    } catch (error) {
      throw fetchError(error, this.config.token);
    }
    if (!response.ok) throw await responseError(response, this.config.token);

    let payload: {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      payload = await response.json();
    } catch {
      throw new LlmTransportError("LLM transport returned invalid completion JSON");
    }
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new LlmTransportError("LLM transport returned no completion choices");
    }
    return {
      text: text.trim(),
      usage: payload.usage ? {
        promptTokens: payload.usage.prompt_tokens,
        completionTokens: payload.usage.completion_tokens,
        totalTokens: payload.usage.total_tokens,
      } : undefined,
    };
  }

  stream(request: PreparedChatRequest, signal?: AbortSignal): StreamProvider {
    return {
      stream: (streamSignal) => this.streamRequest(request, streamSignal ?? signal),
    };
  }

  private async *streamRequest(request: PreparedChatRequest, signal?: AbortSignal): AsyncIterable<StreamDelta> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          model: request.model,
          stream: true,
          messages: requestMessages(request.system, request.messages),
        }),
        signal,
      });
    } catch (error) {
      throw fetchError(error, this.config.token);
    }
    if (!response.ok) throw await responseError(response, this.config.token);
    if (!response.body) throw new LlmTransportError("LLM transport returned an empty stream body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.trim().replace(/^data:\s*/, "");
        if (!data || data === "[DONE]") continue;
        let chunk: {
          choices?: Array<{ delta?: { content?: unknown } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const text = chunk.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield { text };
        if (chunk.usage) {
          yield {
            usage: {
              prompt: chunk.usage.prompt_tokens ?? 0,
              completion: chunk.usage.completion_tokens ?? 0,
            },
          };
        }
      }
    }
  }
}

class MockLlmTransport implements LlmTransport {
  async complete(): Promise<CompletionResult> {
    return { text: "对话围绕小说写作展开，确立了世界观设定与写作偏好。" };
  }

  stream(request: PreparedChatRequest): StreamProvider {
    return {
      async *stream(): AsyncIterable<StreamDelta> {
        if (request.system) yield { text: `（已注入：${request.system}）` };
        yield { text: "你好，我是墨舟。" };
        yield { text: "（模拟流式输出）" };
        yield { usage: { prompt: 42, completion: 17 } };
      },
    };
  }
}

export function createOneApiLlmTransport(config: OneApiTransportConfig): LlmTransport {
  return new OneApiLlmTransport({
    ...config,
    fetch: config.fetch ?? globalThis.fetch,
  });
}

/** Composition root factory: exactly one configuration path for completion and stream adapters. */
export function createLlmTransportFromEnv(): LlmTransport {
  if (process.env.CHAT_PROVIDER === "mock") return new MockLlmTransport();
  return createOneApiLlmTransport({
    baseUrl: process.env.ONEAPI_BASE_URL ?? "http://localhost:3001",
    token: process.env.ONEAPI_TOKEN ?? "",
  });
}
