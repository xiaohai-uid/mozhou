// 单元测试：固定窗口限流器（工单 C，商用阻断项——AI 昂贵端点与登录防爆破）
import { describe, it, expect } from "vitest";
import { consumeRateLimit, resetRateLimitsForTest } from "@/lib/http/rate-limit";

describe("consumeRateLimit 固定窗口限流", () => {
  it("窗口内达到上限前全部放行", () => {
    resetRateLimitsForTest();
    for (let i = 0; i < 3; i++) {
      expect(consumeRateLimit("k1", 3, 60_000, 1000 * i)).toEqual({
        ok: true,
        retryAfterSec: 0,
      });
    }
  });

  it("超限后拒绝并给出 Retry-After 秒数", () => {
    resetRateLimitsForTest();
    for (let i = 0; i < 3; i++) consumeRateLimit("k2", 3, 60_000, 1000 * i);
    const r = consumeRateLimit("k2", 3, 60_000, 3000);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("窗口过期后重新计数", () => {
    resetRateLimitsForTest();
    for (let i = 0; i < 3; i++) consumeRateLimit("k3", 3, 60_000, 1000 * i);
    // 旧窗口锚点 t=0，t=61000 起进入新窗口
    expect(consumeRateLimit("k3", 3, 60_000, 61_000).ok).toBe(true);
    expect(consumeRateLimit("k3", 3, 60_000, 61_500).ok).toBe(true);
    expect(consumeRateLimit("k3", 3, 60_000, 62_000).ok).toBe(true);
    expect(consumeRateLimit("k3", 3, 60_000, 63_000).ok).toBe(false);
  });

  it("不同键互相隔离", () => {
    resetRateLimitsForTest();
    for (let i = 0; i < 5; i++) consumeRateLimit("a", 5, 60_000, 0);
    expect(consumeRateLimit("b", 5, 60_000, 0).ok).toBe(true);
  });
});
