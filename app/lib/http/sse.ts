export type SseWriter = {
  start(data: unknown): void;
  delta(data: unknown): void;
  done(data: unknown): void;
  error(data: unknown): void;
  close(): void;
};

export type SseRun = (writer: SseWriter, signal: AbortSignal) => Promise<void>;

const encoder = new TextEncoder();

/** Errors from transport/providers must never become SSE payload details. */
export function safeSseErrorMessage(_error: unknown, fallback = "生成失败，请重试"): string {
  return fallback;
}

/**
 * Owns only SSE bytes, cancellation and one-shot terminal lifecycle.
 * Routes retain every domain event type, field and completion decision.
 */
export function createSseStream(run: SseRun, requestSignal?: AbortSignal): ReadableStream<Uint8Array> {
  const abortController = new AbortController();
  requestSignal?.addEventListener("abort", () => abortController.abort(), { once: true });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let terminal = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const write = (data: unknown, isTerminal = false) => {
        if (closed || terminal) return;
        if (isTerminal) terminal = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const writer: SseWriter = {
        start: (data) => write(data),
        delta: (data) => write(data),
        done: (data) => write(data, true),
        error: (data) => write(data, true),
        close,
      };

      try {
        await run(writer, abortController.signal);
      } catch (error) {
        writer.error({ type: "error", message: safeSseErrorMessage(error) });
      } finally {
        close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });
}

export function createSseResponse(run: SseRun, requestSignal?: AbortSignal): Response {
  return new Response(createSseStream(run, requestSignal), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
