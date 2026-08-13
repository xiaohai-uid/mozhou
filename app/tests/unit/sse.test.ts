import { describe, expect, it } from "vitest";
import { createSseStream, safeSseErrorMessage } from "@/lib/http/sse";

async function readSse(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data:\s*/, "")));
}

describe("shared SSE framing", () => {
  it("frames route-owned domain events without changing their fields", async () => {
    const events = await readSse(createSseStream(async (writer) => {
      writer.start({ type: "start", sessionId: 7 });
      writer.delta({ type: "delta", text: "stream" });
      writer.done({ type: "done", messageId: 42 });
    }));

    expect(events).toEqual([
      { type: "start", sessionId: 7 },
      { type: "delta", text: "stream" },
      { type: "done", messageId: 42 },
    ]);
  });

  it("only emits the first terminal event and closes once", async () => {
    const events = await readSse(createSseStream(async (writer) => {
      writer.error({ type: "error", code: "AiCancelled", message: "已停止生成" });
      writer.done({ type: "done", messageId: 42 });
      writer.error({ type: "error", code: "AiGenerationFailed", message: "生成失败" });
      writer.close();
      writer.close();
    }));

    expect(events).toEqual([
      { type: "error", code: "AiCancelled", message: "已停止生成" },
    ]);
  });

  it("cancels the route signal when the client stops reading", async () => {
    let aborted = false;
    const stream = createSseStream(async (_writer, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
    });

    const reader = stream.getReader();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
  });

  it("does not start the route callback when the request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;

    const stream = createSseStream(async (_writer, signal) => {
      started = true;
      expect(signal.aborted).toBe(true);
    }, controller.signal);

    const reader = stream.getReader();
    await reader.cancel();
    expect(started).toBe(false);
  });

  it("uses a generic error message without provider details or secrets", () => {
    expect(safeSseErrorMessage(
      new Error("gateway Bearer very-secret-token failed\n at internal.ts:7"),
      "生成失败，请重试",
    )).toBe("生成失败，请重试");
  });
});
