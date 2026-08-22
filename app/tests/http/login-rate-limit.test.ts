// 契约测试：登录防爆破限流（工单 C）。键 = 邮箱+IP，10 次/分钟；
// 计数在密码校验前消耗，失败尝试同样计入。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-rl-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-rl-%"));
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(reg.status).toBe(201);
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-rl-%"));
});

async function login(password: string) {
  return fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
}

describe("POST /api/v1/auth/login 防爆破限流", () => {
  it("同邮箱连续失败达到上限后返回 429 + Retry-After", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await login("wrong-密码");
      expect(res.status).toBe(401); // 前 10 次仍是常规认证失败
    }
    const blocked = await login("wrong-密码");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const json = (await blocked.json()) as { error?: string };
    expect(json.error).toContain("频繁");
  });

  it("被限流后即使密码正确也拒绝（窗口内）", async () => {
    const res = await login(PASSWORD);
    expect(res.status).toBe(429);
  });

  it("不同邮箱不受影响", async () => {
    const other = `mozhou-rl-other-${RUN}@example.com`;
    const reg = await fetch(`${BASE}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: other, password: PASSWORD }),
    });
    expect(reg.status).toBe(201);
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: other, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
  });
});
