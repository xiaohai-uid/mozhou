import { describe, expect, it, vi } from "vitest";
import { compressHistory, KEEP_RECENT } from "@/lib/chat/compress";
import type { CompletionAdapter } from "@/lib/chat/llm-transport";
import type { ChatMessage } from "@/lib/chat/payload";

const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `历史 ${index}`,
}));

describe("compression completion adapter", () => {
  it("uses the injected completion adapter without making a network request", async () => {
    const complete = vi.fn(async () => ({ text: "已确认世界观与偏好" }));
    const adapter: CompletionAdapter = { complete };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("compression must not fetch directly");
    }) as typeof fetch;

    try {
      await expect(compressHistory(messages, adapter)).resolves.toEqual({
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

    await expect(compressHistory(messages, adapter)).resolves.toEqual({
      summary: "",
      kept: messages.slice(-KEEP_RECENT),
    });
  });
});
