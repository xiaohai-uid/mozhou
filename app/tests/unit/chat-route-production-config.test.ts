import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmConfigurationError } from "@/lib/chat/llm-transport";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/chat/service", () => ({
  createSession: vi.fn(),
  isNovelOwned: vi.fn(),
  listMessages: vi.fn(),
  runChat: vi.fn(),
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));

vi.mock("@/lib/novels/service", () => ({
  getChapter: vi.fn(),
}));

vi.mock("@/lib/novels/chapter-chat", () => ({
  ChapterNotFoundError: class ChapterNotFoundError extends Error {},
  runChapterChat: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { createSession, runChat } from "@/lib/chat/service";
import { getChapter } from "@/lib/novels/service";
import { runChapterChat } from "@/lib/novels/chapter-chat";
import { POST as chatPost } from "@/app/api/v1/chat/route";
import { POST as chapterPost } from "@/app/api/v1/novels/[id]/chapters/chat/route";

describe("POST /api/v1/chat production provider configuration", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 7 } as never);
    vi.mocked(createSession).mockResolvedValue({ id: 42 } as never);
    vi.mocked(runChat).mockRejectedValue(new LlmConfigurationError());
  });

  it("returns a generic SSE error when the provider is fail-closed", async () => {
    const response = await chatPost(new Request("http://localhost/api/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "请开始写作" }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = (await response.text())
      .split("\n\n")
      .filter((event) => event.startsWith("data:"))
      .map((event) => JSON.parse(event.slice(5).trim()) as { type: string; message?: string });

    expect(events).toEqual([
      { type: "start", sessionId: 42 },
      { type: "error", message: "生成服务暂不可用，请稍后重试" },
    ]);
    expect(JSON.stringify(events)).not.toContain("LLM provider configuration");
    expect(JSON.stringify(events)).not.toContain("mock");
  });

  it("keeps chapter SSE error semantics while hiding provider configuration details", async () => {
    vi.mocked(getChapter).mockResolvedValue({ id: 9, content: "" } as never);
    vi.mocked(runChapterChat).mockRejectedValue(new LlmConfigurationError());

    const response = await chapterPost(
      new Request("http://localhost/api/v1/novels/4/chapters/chat?chapterId=9", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "请开始写第一章" }),
      }),
      { params: Promise.resolve({ id: "4" }) },
    );

    expect(response.status).toBe(200);
    const events = (await response.text())
      .split("\n\n")
      .filter((event) => event.startsWith("data:"))
      .map((event) => JSON.parse(event.slice(5).trim()) as { type: string; code?: string; message?: string });

    expect(events).toEqual([
      { type: "start" },
      { type: "error", code: "AiGenerationFailed", message: "生成服务暂不可用，请稍后重试" },
    ]);
    expect(JSON.stringify(events)).not.toContain("LLM provider configuration");
  });
});
