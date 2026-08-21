import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/app/api/v1/deconstruct/analyze/route";
import { ProviderBoundaryError } from "@/lib/ai/provider-boundary";

describe("deconstruction provider error classification", () => {
  it("treats a route-owned abort as a timeout even when the provider boundary assigns 503", () => {
    const error = new ProviderBoundaryError(
      "FREE_UNAVAILABLE",
      "LLM transport request failed: This operation was aborted",
      503,
    );

    expect(classifyProviderError(error)).toBe("timeout");
  });

  it("keeps a genuine 503 without abort semantics as a provider 5xx", () => {
    const error = new ProviderBoundaryError(
      "FREE_UNAVAILABLE",
      "LLM transport HTTP 503: upstream unavailable",
      503,
    );

    expect(classifyProviderError(error)).toBe("provider_5xx");
  });
});
