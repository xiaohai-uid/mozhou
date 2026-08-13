export type SseEventSender = (event: unknown) => boolean;

export type SseRunnerContext = {
  send: SseEventSender;
  isAborted: () => boolean;
};

export type SseRunner = (context: SseRunnerContext) => Promise<void>;

export type SseStreamOptions = {
  onUnhandledError?: (error: unknown) => unknown;
};

function isTerminalEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const type = (event as { type?: unknown }).type;
  return type === "done" || type === "error";
}

/**
 * Shared transport-only SSE lifecycle. Domain routes still decide event fields,
 * error codes, persistence, and what constitutes a successful completion.
 */
export function createSseStream(
  request: Request,
  runner: SseRunner,
  options: SseStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  let aborted = request.signal.aborted;
  let terminalSent = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controller?.close();
    } catch {
      // The client may have cancelled the stream first.
    }
  };

  const abort = () => {
    aborted = true;
    close();
  };

  const send: SseEventSender = (event) => {
    if (closed || aborted || terminalSent) return false;
    try {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      if (isTerminalEvent(event)) terminalSent = true;
      return true;
    } catch {
      abort();
      return false;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      request.signal.addEventListener("abort", abort, { once: true });
      if (aborted) {
        close();
        return;
      }

      void runner({ send, isAborted: () => aborted })
        .catch((error: unknown) => {
          if (!aborted) send(options.onUnhandledError?.(error) ?? { type: "error", message: "生成失败" });
        })
        .finally(() => {
          request.signal.removeEventListener("abort", abort);
          close();
        });
    },
    cancel() {
      aborted = true;
      close();
    },
  });
}
