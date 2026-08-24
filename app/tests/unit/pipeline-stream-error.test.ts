import { describe, expect, it } from "vitest";
import { initialState, runNodeStream } from "@/lib/pipeline/engine";

describe("stream provider error propagation", () => {
  it("preserves a stable error code when the provider fails", async () => {
    const state = await runNodeStream(
      initialState(),
      {
        nodeType: "章节对话",
        provider: {
          async *stream() {
            throw Object.assign(new Error("fetch failed: ECONNREFUSED"), { status: undefined });
          },
        },
      },
      () => {},
    );

    expect(state.task?.status).toBe("failed");
    expect(state.task?.errorCode).toBe("AiNetworkError");
  });
});
