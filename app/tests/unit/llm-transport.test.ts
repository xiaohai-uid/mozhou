import { describe, expect, it, vi } from "vitest";
import {
  LlmConfigurationError,
  LlmTransportError,
  buildProviderWirePayload,
  createLlmTransportFromEnv,
  createOneApiLlmTransport,
} from "@/lib/chat/llm-transport";

function request() {
  return {
    model: "test-model",
    system: "system contract",
    messages: [{ role: "user" as const, content: "current request" }],
  };
}

describe("one-api LLM transport", () => {
  it("uses one shared conversion for semantic and provider wire payloads", () => {
    expect(buildProviderWirePayload(request(), false, 0.2)).toEqual({
      model: "test-model",
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "system", content: "system contract" },
        { role: "user", content: "current request" },
      ],
    });
    expect(buildProviderWirePayload(request(), true)).toEqual({
      model: "test-model",
      stream: true,
      messages: [
        { role: "system", content: "system contract" },
        { role: "user", content: "current request" },
      ],
    });
  });

  it("fails closed when production is configured to use mock", () => {
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;
    const originalProvider = env.CHAT_PROVIDER;
    env.NODE_ENV = "production";
    env.CHAT_PROVIDER = "mock";
    try {
      expect(() => createLlmTransportFromEnv()).toThrow(LlmConfigurationError);
    } finally {
      if (originalNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = originalNodeEnv;
      if (originalProvider === undefined) delete env.CHAT_PROVIDER;
      else env.CHAT_PROVIDER = originalProvider;
    }
  });

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
        systemSections: ["base_identity"],
      },
    }, buildProviderWirePayload(request(), true)).stream()) deltas.push(delta);

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
});
