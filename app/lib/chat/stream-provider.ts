import type { StreamDelta, StreamProvider } from "@/lib/pipeline/engine";
import type { LlmTransport } from "./llm-transport";
import {
  capturePreparedChatRequest,
  isPayloadCaptureEnabled,
  observePreparedChatRequestWithWire,
  type PreparedChatRequest,
  type ProviderWirePayload,
} from "./payload";

/** Adapts the shared transport to the existing pipeline StreamProvider boundary. */
export function makeChatProvider(
  request: PreparedChatRequest,
  transport: LlmTransport,
): StreamProvider {
  const wirePayload = transport.prepare(request, true);
  observePreparedChatRequestWithWire(request, wirePayload);
  const provider = transport.stream(wirePayload);
  return isPayloadCaptureEnabled()
    ? new CapturingChatProvider(request, wirePayload, provider)
    : provider;
}

/** Test-only wrapper that captures the final request at provider consumption time. */
export class CapturingChatProvider implements StreamProvider {
  constructor(
    private request: PreparedChatRequest,
    private wirePayload: ProviderWirePayload,
    private delegate: StreamProvider,
  ) {}

  async *stream(): AsyncIterable<StreamDelta> {
    capturePreparedChatRequest(this.request, this.wirePayload);
    yield* this.delegate.stream();
  }
}
