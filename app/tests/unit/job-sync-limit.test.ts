import { describe, it, expect } from "vitest";
import { resetRateLimitsForTest } from "@/lib/http/rate-limit";

describe("enforceJobRetryLimit —— 任务步骤重试限流（防重复扣费）", () => {
  it("未超限返回 null；超限返回带 Retry-After 的 429", async () => {
    resetRateLimitsForTest();
    const { enforceJobRetryLimit, JOB_RETRY_LIMIT_PER_MIN } = await import("@/lib/http/rate-limit");
    expect(JOB_RETRY_LIMIT_PER_MIN).toBeGreaterThan(0);
    let last: Response | null = null;
    for (let i = 0; i <= JOB_RETRY_LIMIT_PER_MIN; i++) {
      last = enforceJobRetryLimit(7);
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("按用户分桶互不影响", async () => {
    resetRateLimitsForTest();
    const { enforceJobRetryLimit, JOB_RETRY_LIMIT_PER_MIN } = await import("@/lib/http/rate-limit");
    for (let i = 0; i < JOB_RETRY_LIMIT_PER_MIN; i++) enforceJobRetryLimit(8);
    expect(enforceJobRetryLimit(9)).toBeNull();
  });
});

describe("enforceSyncPushLimit —— WebDAV 推送限流（保护外部服务）", () => {
  it("未超限返回 null；超限返回带 Retry-After 的 429", async () => {
    resetRateLimitsForTest();
    const { enforceSyncPushLimit, SYNC_PUSH_LIMIT_PER_MIN } = await import("@/lib/http/rate-limit");
    expect(SYNC_PUSH_LIMIT_PER_MIN).toBeGreaterThan(0);
    let last: Response | null = null;
    for (let i = 0; i <= SYNC_PUSH_LIMIT_PER_MIN; i++) {
      last = enforceSyncPushLimit(11);
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("按用户分桶互不影响", async () => {
    resetRateLimitsForTest();
    const { enforceSyncPushLimit, SYNC_PUSH_LIMIT_PER_MIN } = await import("@/lib/http/rate-limit");
    for (let i = 0; i < SYNC_PUSH_LIMIT_PER_MIN; i++) enforceSyncPushLimit(12);
    expect(enforceSyncPushLimit(13)).toBeNull();
  });
});
