import { describe, expect, it } from "vitest";
import {
  classifyChapterChatError,
  classifyTaskError,
  type ChapterChatErrorCode,
} from "@/lib/novels/chapter-chat-errors";

describe("章节 AI 错误语义", () => {
  const cases: Array<[unknown, ChapterChatErrorCode]> = [
    [{ code: "FREE_UNAVAILABLE" }, "FREE_UNAVAILABLE"],
    [{ status: 401, message: "unauthorized" }, "AiNoApiKey"],
    [{ status: 429, message: "rate limited" }, "AiRateLimited"],
    [{ status: 503, message: "upstream server error" }, "AiServerError"],
    [{ message: "request timeout" }, "AiTimeout"],
    [{ message: "fetch failed: ECONNREFUSED" }, "AiNetworkError"],
    [{ message: "returned invalid completion JSON" }, "AiInvalidResponse"],
  ];

  it.each(cases)("把 %j 映射到 %s", (error, expected) => {
    expect(classifyChapterChatError(error)).toBe(expected);
  });

  it("未知错误保持通用失败，不暴露内部细节", () => {
    expect(classifyChapterChatError(new Error("secret provider detail"))).toBe("AiGenerationFailed");
  });

  it("将上游 503 的稳定错误码记为 provider_unavailable，而不是 provider_network", () => {
    expect(classifyTaskError({
      code: "AiServerError",
      message: "LLM transport HTTP 503: no available channel",
    })).toBe("provider_unavailable");
  });
});
