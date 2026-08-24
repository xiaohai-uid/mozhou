// 契约测试：任务重试 + WebDAV 推送限流（工单 D 延伸，DELTA-002）。
// retry：鉴权后、归属检查前消耗（404 探测同样计入）；sync/push：鉴权后消耗。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import {
  JOB_RETRY_LIMIT_PER_MIN,
  SYNC_PUSH_LIMIT_PER_MIN,
} from "@/lib/http/rate-limit";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const PASSWORD = "s3cret-测试密码";

async function register(prefix: string) {
  const email = `${prefix}-${RUN}@example.com`;
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(reg.status).toBe(201);
  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  return login.headers.get("set-cookie") ?? "";
}

describe("POST /api/v1/runtime/jobs/{jobId}/retry 限流", () => {
  const PREFIX = "mozhou-rl-jobretry";
  let cookie = "";

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, "mozhou-rl-jobretry-%"));
    cookie = await register(PREFIX);
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "mozhou-rl-jobretry-%"));
  });

  it("达到上限前对不存在 jobId 返回 404；之后同路径返回 429 + Retry-After", async () => {
    for (let i = 0; i < JOB_RETRY_LIMIT_PER_MIN; i++) {
      const res = await fetch(`${BASE}/api/v1/runtime/jobs/no-such-job/retry`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(404); // 归属检查前的限流消耗：上限内仍是常规 404
    }
    const blocked = await fetch(`${BASE}/api/v1/runtime/jobs/no-such-job/retry`, {
      method: "POST",
      headers: { cookie },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("其他用户不受影响（按用户分桶）", async () => {
    const other = await register("mozhou-rl-jobretry-b");
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/no-such-job/retry`, {
      method: "POST",
      headers: { cookie: other },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/sync/push 限流", () => {
  const PREFIX = "mozhou-rl-syncpush";
  let cookie = "";

  beforeAll(async () => {
    await db.delete(users).where(like(users.email, "mozhou-rl-syncpush-%"));
    cookie = await register(PREFIX);
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "mozhou-rl-syncpush-%"));
  });

  it("达到上限前返回业务响应；之后返回 429 + Retry-After", async () => {
    for (let i = 0; i < SYNC_PUSH_LIMIT_PER_MIN; i++) {
      const res = await fetch(`${BASE}/api/v1/sync/push`, {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(400); // 未配置同步 → 业务失败，但配额已消耗
    }
    const blocked = await fetch(`${BASE}/api/v1/sync/push`, {
      method: "POST",
      headers: { cookie },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
