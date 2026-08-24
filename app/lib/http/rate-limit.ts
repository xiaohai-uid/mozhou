// 应用内限流（工单 C，商用阻断项）：固定窗口计数器，单实例内存版。
// 多实例部署需换共享存储（Redis 等）——见 docs/deployment.md 备注再动。
import { NextResponse } from "next/server";

/** 限流阈值（环境变量可调；http 契约测试环境调高 AI 上限，避免套件自我限流） */
export const AI_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_AI_PER_MIN ?? 30);
export const LOGIN_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_LOGIN_PER_MIN ?? 10);

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) {
    // 惰性清理：桶数超阈值时顺手清掉已过期窗口，防内存膨胀
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= nowMs) buckets.delete(k);
      }
    }
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - nowMs) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimitsForTest(): void {
  buckets.clear();
}

/** AI 限流业务域（字面量联合：防 typo 静默分裂计数桶） */
export type AiScope =
  | "chat"
  | "chapter-chat"
  | "distill"
  | "draw"
  | "websearch"
  | "deconstruct";

export const JOB_RETRY_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_JOB_RETRY_PER_MIN ?? 6);
export const SYNC_PUSH_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_SYNC_PUSH_PER_MIN ?? 6);

/** 任务步骤重试限流：重试会把 job 重新入队触发 worker 再执行（可能产生新的模型调用费用） */
export function enforceJobRetryLimit(userId: number): NextResponse | null {
  const rl = consumeRateLimit(`jobretry:${userId}`, JOB_RETRY_LIMIT_PER_MIN, 60_000);
  return rl.ok ? null : rateLimit429(rl.retryAfterSec);
}

/** WebDAV 推送限流：每次推送对全部作品逐章发起外部请求（最多 3 次重试），保护上游服务 */
export function enforceSyncPushLimit(userId: number): NextResponse | null {
  const rl = consumeRateLimit(`syncpush:${userId}`, SYNC_PUSH_LIMIT_PER_MIN, 60_000);
  return rl.ok ? null : rateLimit429(rl.retryAfterSec);
}

/** AI 昂贵端点统一限流入口：按用户+业务域计数；超限返回 429 响应，否则 null */
export function enforceAiLimit(userId: number, scope: AiScope): NextResponse | null {
  const rl = consumeRateLimit(`ai:${userId}:${scope}`, AI_LIMIT_PER_MIN, 60_000);
  return rl.ok ? null : rateLimit429(rl.retryAfterSec);
}

/** 统一 429 响应（含 Retry-After 头） */
export function rateLimit429(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "操作过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSec)) } },
  );
}
