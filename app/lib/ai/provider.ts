import {
  createOneApiLlmTransport,
  type CompletionRequest,
  type CompletionResult,
  LlmTransportError,
} from "@/lib/chat/llm-transport";
import {
  ProviderBoundaryError,
  resolveProviderBoundary,
  type ProviderBoundary,
  type ProviderRoute,
} from "./provider-boundary";

export type UnifiedCompletionRequest = Omit<CompletionRequest, "model"> & {
  model?: string;
};

export interface UnifiedCompletionProvider {
  readonly boundary: ProviderBoundary;
  complete(request: UnifiedCompletionRequest): Promise<CompletionResult>;
}

export function createUnifiedCompletionProvider(input: {
  route: Exclude<ProviderRoute, "chat" | "chapter">;
  model: string;
  mockResult?: CompletionResult;
}): UnifiedCompletionProvider {
  const boundary = resolveProviderBoundary(input);
  if (boundary.sourceClass === "TEST_MOCK") {
    return {
      boundary,
      complete: async () => input.mockResult ?? { text: "" },
    };
  }

  const transport = createOneApiLlmTransport({
    baseUrl: process.env.ONEAPI_BASE_URL ?? "http://localhost:3001",
    token: process.env.ONEAPI_TOKEN ?? "",
  });
  return {
    boundary,
    complete: async (request) => {
      try {
        return await transport.complete({
          ...request,
          model: request.model ?? input.model,
        });
      } catch (error) {
        const status = error instanceof LlmTransportError ? error.status : undefined;
        throw new ProviderBoundaryError(
          boundary.sourceClass === "PUBLIC_FREE" ? "FREE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE",
          error instanceof Error ? error.message : "provider request failed",
          status ?? 503,
        );
      }
    },
  };
}
