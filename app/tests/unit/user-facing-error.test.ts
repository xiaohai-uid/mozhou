import { describe, expect, it } from "vitest";
import { toUserFacingAiError } from "@/lib/chat/user-facing-error";

describe("toUserFacingAiError", () => {
  it("maps AiNetworkError to a retryable network message", () => {
    expect(toUserFacingAiError("AiNetworkError")).toMatchObject({
      kind: "network",
      retryable: true,
    });
  });

  it("maps AiTimeout to a retryable timeout message", () => {
    expect(toUserFacingAiError("AiTimeout")).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
  });

  it("maps FREE_UNAVAILABLE without leaking provider internals", () => {
    expect(toUserFacingAiError("FREE_UNAVAILABLE")).toMatchObject({
      kind: "free_unavailable",
      retryable: true,
    });
  });

  it("maps rate-limit codes to a retryable rate_limited message", () => {
    expect(toUserFacingAiError("AiRateLimited")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
    expect(toUserFacingAiError("RATE_LIMITED")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
  });

  it("falls back to a retryable unknown message", () => {
    expect(toUserFacingAiError(undefined)).toMatchObject({
      kind: "unknown",
      retryable: true,
    });
    expect(toUserFacingAiError("MysteryCode")).toMatchObject({
      kind: "unknown",
      retryable: true,
    });
  });
});
