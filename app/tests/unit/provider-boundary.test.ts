import { describe, expect, it } from "vitest";
import {
  ProviderBoundaryError,
  resolveProviderBoundary,
  resolveProviderRequestOutcome,
  selectSameClassFallback,
  type ProviderCandidate,
} from "@/lib/ai/provider-boundary";

describe("统一 Provider source-class boundary", () => {
  it("为公益模型固定 source class 与 credential/billing owner", () => {
    expect(resolveProviderBoundary({
      route: "distill",
      model: "deepseek-v4-flash",
      env: {
        NODE_ENV: "production",
        DISTILL_PROVIDER: "one-api",
        DISTILL_SOURCE_CLASS: "PUBLIC_FREE",
      },
    })).toMatchObject({
      sourceClass: "PUBLIC_FREE",
      provider: "one-api",
      credentialOwner: "platform",
      billingOwner: "provider",
      route: "distill",
    });
  });

  it("TEST_MOCK 只在非生产环境可解析", () => {
    expect(resolveProviderBoundary({
      route: "chat",
      model: "test-model",
      env: { NODE_ENV: "test", CHAT_PROVIDER: "mock" },
    })).toMatchObject({
      sourceClass: "TEST_MOCK",
      provider: "test-mock",
      credentialOwner: "none",
      billingOwner: "none",
    });

    expect(() => resolveProviderBoundary({
      route: "chat",
      model: "test-model",
      env: { NODE_ENV: "production", CHAT_PROVIDER: "mock" },
    })).toThrowError(ProviderBoundaryError);
    expect(() => resolveProviderBoundary({
      route: "chat",
      model: "test-model",
      env: { NODE_ENV: "production", CHAT_PROVIDER: "mock" },
    })).toThrow("TEST_MOCK_FORBIDDEN");
  });

  it("公益失败只允许同类 fallback，跨类候选显式失败", () => {
    const publicFree = resolveProviderBoundary({
      route: "draw",
      model: "deepseek-v4-flash",
      env: { NODE_ENV: "production", DRAW_PROVIDER: "one-api" },
    });
    const sameClass: ProviderCandidate[] = [
      { id: "qwen-free", sourceClass: "PUBLIC_FREE" },
    ];
    expect(selectSameClassFallback(publicFree, sameClass)).toEqual(sameClass[0]);

    expect(() => selectSameClassFallback(publicFree, [
      { id: "platform-paid", sourceClass: "PLATFORM_PAID" },
      { id: "user-byok", sourceClass: "USER_BYOK" },
    ])).toThrow("FREE_UNAVAILABLE");
  });

  it("所有同类公益路径耗尽时，聚合为 FREE_UNAVAILABLE 而不是暴露单次网络错误", () => {
    const publicFree = resolveProviderBoundary({
      route: "chapter",
      model: "free-model",
      env: { NODE_ENV: "production", CHAT_PROVIDER: "one-api" },
    });

    expect(resolveProviderRequestOutcome(publicFree, [
      { sourceClass: "PUBLIC_FREE", status: "failed", code: "AiNetworkError" },
    ], { exhausted: true })).toEqual({
      status: "failed",
      code: "FREE_UNAVAILABLE",
    });
  });

  it("同类公益 fallback 成功时保留成功终态，并拒绝跨类 attempt", () => {
    const publicFree = resolveProviderBoundary({
      route: "chapter",
      model: "free-model",
      env: { NODE_ENV: "production", CHAT_PROVIDER: "one-api" },
    });

    expect(resolveProviderRequestOutcome(publicFree, [
      { sourceClass: "PUBLIC_FREE", status: "failed", code: "AiTimeout" },
      { sourceClass: "PUBLIC_FREE", status: "succeeded" },
    ], { exhausted: true })).toEqual({ status: "succeeded" });

    expect(() => resolveProviderRequestOutcome(publicFree, [
      { sourceClass: "PLATFORM_PAID", status: "succeeded" },
    ], { exhausted: true })).toThrow("FREE_UNAVAILABLE");
  });
});
