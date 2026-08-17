import { describe, expect, it, vi } from "vitest";
import { compressHistory, KEEP_RECENT } from "@/lib/chat/compress";
import { createOneApiLlmTransport, type CompletionAdapter } from "@/lib/chat/llm-transport";
import type { ChatMessage } from "@/lib/chat/payload";

const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `历史 ${index}`,
}));

describe("compression completion adapter", () => {
  it("uses the selected non-default model for completion and streaming", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "摘要" } }],
    }), { status: 200 }));
    const transport = createOneApiLlmTransport({
      baseUrl: "https://one-api.example",
      token: "test-token",
      fetch: fetcher,
    });

    await compressHistory(messages, transport, "glm-4.5-flash");
    const stream = transport.stream({
      model: "glm-4.5-flash",
      system: "same request semantics",
      messages: [{ role: "user", content: "current user" }],
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
    });
    for await (const _ of stream.stream()) {
      // Consume the provider seam; the fake completion body has no stream deltas.
    }

    const bodies = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>).map(([, init]) =>
      JSON.parse(String(init.body)),
    );
    expect(bodies).toEqual([
      expect.objectContaining({ model: "glm-4.5-flash", stream: false }),
      expect.objectContaining({ model: "glm-4.5-flash", stream: true }),
    ]);
  });

  it("uses the injected completion adapter without making a network request", async () => {
    const complete = vi.fn(async () => ({ text: "已确认世界观与偏好" }));
    const adapter: CompletionAdapter = { complete };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("compression must not fetch directly");
    }) as typeof fetch;

    try {
      await expect(compressHistory(messages, adapter, "deepseek-v4-flash")).resolves.toEqual({
        summary: "（历史摘要）已确认世界观与偏好",
        kept: messages.slice(-KEEP_RECENT),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("对话摘要器"),
      messages: [{ role: "user", content: "user: 历史 0\n\nassistant: 历史 1" }],
    }));
  });

  it("fails open when the injected completion adapter fails", async () => {
    const adapter: CompletionAdapter = {
      complete: async () => { throw new Error("upstream unavailable"); },
    };

    await expect(compressHistory(messages, adapter, "deepseek-v4-flash")).resolves.toEqual({
      summary: "",
      kept: messages.slice(-KEEP_RECENT),
    });
  });

  it("exposes compression inference usage without changing fail-open output", async () => {
    const observations: Array<{ usage?: { promptTokens?: number; completionTokens?: number }; failed: boolean }> = [];
    const adapter: CompletionAdapter = {
      complete: async () => ({ text: "摘要", usage: { promptTokens: 9, completionTokens: 3 } }),
    };

    await compressHistory(messages, adapter, "deepseek-v4-flash", {
      onInference: ({ usage, error }) => {
        observations.push({ usage, failed: Boolean(error) });
      },
    });

    expect(observations).toEqual([{ usage: { promptTokens: 9, completionTokens: 3 }, failed: false }]);
  });
});
