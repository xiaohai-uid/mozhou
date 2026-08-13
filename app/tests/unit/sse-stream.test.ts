import { describe, expect, it } from "vitest";
import { createSseStream } from "@/lib/http/sse";

describe("shared SSE stream lifecycle", () => {
  it("encodes events and closes after the runner completes", async () => {
    const request = new Request("http://localhost/test");
    const response = new Response(createSseStream(request, async ({ send }) => {
      send({ type: "start" });
      send({ type: "done" });
    }));

    await expect(response.text()).resolves.toBe(
      'data: {"type":"start"}\n\ndata: {"type":"done"}\n\n',
    );
  });

  it("normalizes uncaught runner failures without exposing the error", async () => {
    const response = new Response(createSseStream(
      new Request("http://localhost/test"),
      async ({ send }) => {
        send({ type: "start" });
        throw new Error("secret upstream detail");
      },
    ));

    const body = await response.text();
    expect(body).toContain('"type":"error"');
    expect(body).toContain("生成失败");
    expect(body).not.toContain("secret upstream detail");
  });

  it("closes once when the request is aborted and rejects later sends", async () => {
    const abortController = new AbortController();
    let releaseRunner!: () => void;
    let runnerFinished!: () => void;
    const runnerDone = new Promise<void>((resolve) => { runnerFinished = resolve; });
    const stream = createSseStream(
      new Request("http://localhost/test", { signal: abortController.signal }),
      async ({ send }) => {
        send({ type: "start" });
        await new Promise<void>((resolve) => { releaseRunner = resolve; });
        expect(send({ type: "late" })).toBe(false);
        runnerFinished();
      },
    );
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      value: new TextEncoder().encode('data: {"type":"start"}\n\n'),
      done: false,
    });
    abortController.abort();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    releaseRunner();
    await runnerDone;
    reader.releaseLock();
  });
});
