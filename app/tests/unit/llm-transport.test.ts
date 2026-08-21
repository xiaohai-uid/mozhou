import { describe, expect, it, vi } from "vitest";
import {
  LlmTransportError,
  createOneApiLlmTransport,
} from "@/lib/chat/llm-transport";
import { initialState, runNodeStream } from "@/lib/pipeline/engine";

function request() {
  return {
    model: "test-model",
    system: "system contract",
    messages: [{ role: "user" as const, content: "current request" }],
  };
}

function preparedRequest() {
  return {
    ...request(),
    observation: {
      route: "chapter-chat" as const,
      mode: "chapter" as const,
      historyCountBefore: 0,
      historyCountAfter: 1,
      compressionApplied: false,
      ragEntryCount: 0,
      stylePresent: false,
      skillCount: 0,
      novelScopePresent: true,
      chapterScopePresent: true,
      ownerScopeResolved: true,
      currentUserIndices: [0],
      systemSections: ["base_identity"],
    },
  };
}

function settleWithin<T>(promise: Promise<T>, timeoutMs = 150): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("transport did not enforce its app-owned timeout"));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe("one-api LLM transport", () => {
  it("uses the shared config for a non-stream completion request", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "compressed summary" } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    }), { status: 200 }));
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example/",
      token: "shared-token",
      fetch: fetcher,
    });

    await expect(transport.complete({ ...request(), temperature: 0.2 })).resolves.toEqual({
      text: "compressed summary",
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://one-api.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer shared-token" }),
      }),
    );
    const completionInit = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1];
    expect(JSON.parse(String(completionInit?.body))).toEqual({
      model: "test-model",
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: "system contract" },
        { role: "user", content: "current request" },
      ],
    });
  });

  it("uses the same auth and streaming flag for a streaming provider", async () => {
    const fetcher = vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"first"}}]}\n\ndata: {"choices":[{"delta":{"content":" second"}}],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      { status: 200 },
    ));
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "shared-token",
      fetch: fetcher,
    });

    const deltas = [];
    for await (const delta of transport.stream({
      ...request(),
      observation: {
        route: "chat",
        mode: "independent",
        historyCountBefore: 0,
        historyCountAfter: 1,
        compressionApplied: false,
        ragEntryCount: 0,
        stylePresent: false,
        skillCount: 0,
        novelScopePresent: false,
        chapterScopePresent: false,
        ownerScopeResolved: true,
        currentUserIndices: [0],
        systemSections: ["base_identity"],
      },
    }).stream()) deltas.push(delta);

    expect(deltas).toEqual([
      { text: "first" },
      { text: " second" },
      { usage: { prompt: 8, completion: 2 } },
    ]);
    const streamInit = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1];
    expect(JSON.parse(String(streamInit?.body))).toMatchObject({
      stream: true,
      model: "test-model",
    });
    expect(streamInit?.headers).toMatchObject({ Authorization: "Bearer shared-token" });
  });

  it("aborting a stream cancels the upstream reader promptly", async () => {
    let readerCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          try {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\\n\\n"));
            controller.close();
          } catch {
            // The abort path is expected to cancel and close this stream first.
          }
        }, 300);
      },
      cancel() {
        readerCancelled = true;
      },
    });
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "shared-token",
      fetch: async () => new Response(body, { status: 200 }),
    });
    const controller = new AbortController();
    const iterator = transport.stream({
      ...request(),
      observation: {
        route: "chapter-chat",
        mode: "chapter",
        historyCountBefore: 0,
        historyCountAfter: 1,
        compressionApplied: false,
        ragEntryCount: 0,
        stylePresent: false,
        skillCount: 0,
        novelScopePresent: true,
        chapterScopePresent: true,
        ownerScopeResolved: true,
        currentUserIndices: [0],
        systemSections: ["base_identity"],
      },
    }).stream(controller.signal);
    const pending = iterator[Symbol.asyncIterator]().next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const result = await Promise.race([
      pending,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    expect(result).not.toBeNull();
    expect(readerCancelled).toBe(true);
  });

  it("rejects an empty completion response with a normalized error", async () => {
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "shared-token",
      fetch: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    });

    await expect(transport.complete(request())).rejects.toThrow("no completion choices");
  });

  it("bounds error-json details without leaking the configured token", async () => {
    const token = "super-secret-token-value";
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token,
      fetch: async () => new Response(JSON.stringify({
        error: { message: `upstream rejected Bearer ${token}: ${"x".repeat(1000)}` },
      }), { status: 429 }),
    });

    await expect(transport.complete(request())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(LlmTransportError);
      expect((error as Error).message).toContain("HTTP 429");
      expect((error as Error).message).not.toContain(token);
      expect((error as Error).message.length).toBeLessThanOrEqual(320);
      return true;
    });
  });

  it("normalizes a network error without leaking the configured token", async () => {
    const token = "super-secret-token-value";
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token,
      fetch: async () => { throw new Error(`connection failed for ${token}`); },
    });

    await expect(transport.complete(request())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(LlmTransportError);
      expect((error as Error).message).not.toContain(token);
      return true;
    });
  });

  it("times out a completion without aborting the caller signal", async () => {
    const caller = new AbortController();
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "shared-token",
      timeoutMs: 20,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    await expect(settleWithin(transport.complete({ ...request(), signal: caller.signal }))).rejects.toMatchObject({
      code: "AiTimeout",
    });
    expect(caller.signal.aborted).toBe(false);
  });

  it("does not start a completion once the route-wide budget is exhausted", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "should not be requested" } }],
    }), { status: 200 }));
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "shared-token",
      fetch: fetcher,
    });

    await expect(transport.complete({ ...request(), timeoutMs: 0 })).rejects.toMatchObject({
      code: "AiTimeout",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("turns a stalled stream read into AiTimeout and cancels the upstream reader", async () => {
    const caller = new AbortController();
    let readerCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        readerCancelled = true;
      },
    });
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "shared-token",
      timeoutMs: 20,
      fetch: async () => new Response(body, { status: 200 }),
    });

    const state = await settleWithin(runNodeStream(
      initialState(),
      { nodeType: "章节对话", provider: transport.stream(preparedRequest()) },
      () => {},
      caller.signal,
    ));

    expect(state.task?.status).toBe("failed");
    expect(state.task?.errorCode).toBe("AiTimeout");
    expect(readerCancelled).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  });
});
