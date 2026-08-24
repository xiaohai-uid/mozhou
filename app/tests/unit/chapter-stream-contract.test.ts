import { describe, expect, it } from "vitest";
import {
  classifyChapterStream,
  parseChapterSseEvent,
  type ChapterStreamEvent,
} from "@/lib/chat/chapter-stream-contract";

describe("章节对话 SSE contract", () => {
  it("解析 HTTP 200 中的成功终态", () => {
    const event = parseChapterSseEvent('data: {"type":"done","messageId":42}\n\n');

    expect(event).toEqual({ type: "done", messageId: 42 });
    expect(classifyChapterStream([event])).toBe("success");
  });

  it("解析 HTTP 200 中的错误终态并保留错误码", () => {
    const event = parseChapterSseEvent(
      'data: {"type":"error","code":"FREE_UNAVAILABLE","message":"当前免费 AI 暂时不可用"}\n\n',
    );

    expect(event).toMatchObject({ type: "error", code: "FREE_UNAVAILABLE" });
    expect(classifyChapterStream([event])).toBe("error");
  });

  it("终态缺失时不能把 EOF 当作成功", () => {
    const events: ChapterStreamEvent[] = [
      { type: "start", phase: "preparing" },
      { type: "delta", text: "半截" },
    ];

    expect(classifyChapterStream(events)).toBe("protocol_error");
  });

  it("畸形 SSE 必须进入协议错误，而不是静默忽略", () => {
    expect(() => parseChapterSseEvent("data: {not-json}\n\n")).toThrow("PROTOCOL_ERROR");
  });

  it("completed 与 failed 终态不能同时存在", () => {
    const events: ChapterStreamEvent[] = [
      { type: "done", messageId: 1 },
      { type: "error", code: "AiServerError" },
    ];

    expect(classifyChapterStream(events)).toBe("protocol_error");
  });
});
