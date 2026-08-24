import type { StreamDelta, StreamProvider } from "@/lib/pipeline/engine";
import type { LlmTransport } from "./llm-transport";
import {
  capturePreparedChatRequest,
  isPayloadCaptureEnabled,
  observePreparedChatRequest,
  type PreparedChatRequest,
} from "./payload";

/** Adapts the shared transport to the existing pipeline StreamProvider boundary. */
export function makeChatProvider(
  request: PreparedChatRequest,
  transport: LlmTransport,
  timeoutMs?: number,
): StreamProvider {
  observePreparedChatRequest(request);
  const provider = transport.stream(request, timeoutMs);
  return isPayloadCaptureEnabled()
    ? new CapturingChatProvider(request, provider)
    : provider;
}

/** Test-only wrapper that captures the final request at provider consumption time. */
export class CapturingChatProvider implements StreamProvider {
  constructor(
    private request: PreparedChatRequest,
    private delegate: StreamProvider,
  ) {}

  async *stream(signal?: AbortSignal): AsyncIterable<StreamDelta> {
    capturePreparedChatRequest(this.request);
    yield* this.delegate.stream(signal);
  }
}
