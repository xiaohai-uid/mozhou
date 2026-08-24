import type { StreamDelta, StreamProvider } from "@/lib/pipeline/engine";
import {
  resolveProviderBoundary,
  type ProviderRoute,
} from "@/lib/ai/provider-boundary";
import type { ChatMessage, PreparedChatRequest } from "./payload";

export type CompletionRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
  /** Remaining time from the caller's request-wide provider budget. */
  timeoutMs?: number;
  extraBody?: Record<string, unknown>;
};

export type CompletionResult = {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

export interface CompletionAdapter {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface LlmTransport extends CompletionAdapter {
  stream(request: PreparedChatRequest, timeoutMs?: number): StreamProvider;
}

export type OneApiTransportConfig = {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  /** Keep an application-owned failure path ahead of Cloud Run's 300s cap. */
  timeoutMs?: number;
};

/** Cloud Run allows 300 seconds; reserve 30 seconds for SSE/error settlement. */
export const LLM_UPSTREAM_TIMEOUT_MS = 270_000;

/** A request-wide budget shared by sequential compression and generation calls. */
export function createLlmRequestDeadline(timeoutMs = LLM_UPSTREAM_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("LLM request deadline must be a non-negative finite number");
  }
  const expiresAt = Date.now() + timeoutMs;
  return {
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
  };
}

export class LlmTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: "AiTimeout",
  ) {
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

function timeoutError(): LlmTransportError {
  return new LlmTransportError("LLM transport request timed out", undefined, "AiTimeout");
}

function resolveTimeoutMs(remainingMs: number | undefined, defaultTimeoutMs: number): number {
  if (remainingMs === undefined) return defaultTimeoutMs;
  if (!Number.isFinite(remainingMs)) {
    throw new Error("LLM transport timeout must be a finite number");
  }
  return Math.max(0, remainingMs);
}

type RequestDeadline = {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
};

/**
 * The provider gets a private abort signal: timeout must not mutate the
 * caller's signal, because caller abort represents an intentional stop.
 */
function createRequestDeadline(callerSignal: AbortSignal | undefined, timeoutMs: number): RequestDeadline {
  const controller = new AbortController();
  let expired = false;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new DOMException("LLM transport request timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
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
    const timeoutMs = resolveTimeoutMs(request.timeoutMs, this.config.timeoutMs);
    if (timeoutMs <= 0) throw timeoutError();
    const deadline = createRequestDeadline(request.signal, timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.token}`,
          },
          signal: deadline.signal,
          body: JSON.stringify({
            ...request.extraBody,
            model: request.model,
            stream: false,
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            messages: requestMessages(request.system, request.messages),
          }),
        });
      } catch (error) {
        throw deadline.timedOut() ? timeoutError() : fetchError(error, this.config.token);
      }
      if (deadline.timedOut()) throw timeoutError();
      if (!response.ok) {
        const error = await responseError(response, this.config.token);
        throw deadline.timedOut() ? timeoutError() : error;
      }

      let payload: {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      try {
        payload = await response.json();
      } catch {
        throw deadline.timedOut()
          ? timeoutError()
          : new LlmTransportError("LLM transport returned invalid completion JSON");
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
    } finally {
      deadline.dispose();
    }
  }

  stream(request: PreparedChatRequest, timeoutMs?: number): StreamProvider {
    return {
      stream: (signal) => this.streamRequest(request, signal, timeoutMs),
    };
  }

  private async *streamRequest(
    request: PreparedChatRequest,
    signal: AbortSignal | undefined,
    remainingMs: number | undefined,
  ): AsyncIterable<StreamDelta> {
    const timeoutMs = resolveTimeoutMs(remainingMs, this.config.timeoutMs);
    if (timeoutMs <= 0) throw timeoutError();
    const deadline = createRequestDeadline(signal, timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const cancelReader = () => {
      void reader?.cancel().catch(() => {});
    };
    try {
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
          signal: deadline.signal,
        });
      } catch (error) {
        throw deadline.timedOut() ? timeoutError() : fetchError(error, this.config.token);
      }
      if (deadline.timedOut()) throw timeoutError();
      if (!response.ok) {
        const error = await responseError(response, this.config.token);
        throw deadline.timedOut() ? timeoutError() : error;
      }
      if (!response.body) throw new LlmTransportError("LLM transport returned an empty stream body");

      reader = response.body.getReader();
      if (deadline.signal.aborted) {
        cancelReader();
        if (deadline.timedOut()) throw timeoutError();
        return;
      }
      deadline.signal.addEventListener("abort", cancelReader, { once: true });
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
      if (deadline.timedOut()) throw timeoutError();
    } catch (error) {
      throw deadline.timedOut() ? timeoutError() : error;
    } finally {
      deadline.signal.removeEventListener("abort", cancelReader);
      deadline.dispose();
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
        // 给 abort/stop 测试留出“attempt 已创建但尚未完成”的确定性窗口。
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (request.system) yield { text: `（已注入：${request.system}）` };
        yield { text: "你好，我是墨舟。" };
        yield { text: "（模拟流式输出）" };
        yield { usage: { prompt: 42, completion: 17 } };
      },
    };
  }
}

export function createOneApiLlmTransport(config: OneApiTransportConfig): LlmTransport {
  const timeoutMs = config.timeoutMs ?? LLM_UPSTREAM_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("LLM transport timeout must be a positive finite number");
  }
  return new OneApiLlmTransport({
    ...config,
    fetch: config.fetch ?? globalThis.fetch,
    timeoutMs,
  });
}

/** Composition root factory: exactly one configuration path for completion and stream adapters. */
export function createLlmTransportFromEnv(route: ProviderRoute = "chat"): LlmTransport {
  const boundary = resolveProviderBoundary({
    route,
    model: "chat-default",
  });
  if (boundary.sourceClass === "TEST_MOCK") return new MockLlmTransport();
  return createOneApiLlmTransport({
    baseUrl: process.env.ONEAPI_BASE_URL ?? "http://localhost:3001",
    token: process.env.ONEAPI_TOKEN ?? "",
  });
}
