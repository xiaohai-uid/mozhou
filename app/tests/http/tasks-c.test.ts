// 任务二-C 契约测试：联网搜索 / 网文扫榜 / 云同步（mock provider → 确定性降级）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-taskc-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-taskc-%"));
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  cookie = `mozhou_session=${token}`;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-taskc-%"));
});

describe("POST /api/v1/websearch（mock → 降级不抛异常）", () => {
  it("搜索返回结果 + degraded 标记", async () => {
    const res = await fetch(`${BASE}/api/v1/websearch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ query: "灯芯草 用途" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      results: Array<{ title: string; snippet: string }>;
      degraded: boolean;
    };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.degraded).toBe(true);
    expect(data.results[0].title.length).toBeGreaterThan(0);
  });

  it("空关键词 400 / 未登录 401", async () => {
    const empty = await fetch(`${BASE}/api/v1/websearch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ query: "  " }),
    });
    expect(empty.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/websearch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "x" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("GET /api/v1/rankings（mock → 降级不抛异常）", () => {
  it("返回榜源 + 榜单行 + degraded 标记", async () => {
    const res = await fetch(`${BASE}/api/v1/rankings`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      boards: Array<{ name: string }>;
      rows: Array<{ rank: number; name: string }>;
      degraded: boolean;
    };
    expect(data.boards.length).toBeGreaterThan(0);
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows[0].rank).toBe(1);
    expect(data.degraded).toBe(true);
  });

  it("未登录 401", async () => {
    const res = await fetch(`${BASE}/api/v1/rankings`);
    expect(res.status).toBe(401);
  });
});

describe("POST/GET /api/v1/sync/config（mock → 保存+读取）", () => {
  it("保存并测试连接：ok + configured", async () => {
    const post = await fetch(`${BASE}/api/v1/sync/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        url: "https://dav.jianguoyun.com/dav/",
        username: "test@example.com",
        password: "app-password",
        autoSync: true,
      }),
    });
    expect(post.status).toBe(200);
    const data = (await post.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(true);

    // 读取：不回传密码
    const get = await fetch(`${BASE}/api/v1/sync/config`, { headers: { cookie } });
    const cfg = (await get.json()) as {
      configured: boolean;
      url: string;
      username: string;
      password?: string;
      autoSync: boolean;
    };
    expect(cfg.configured).toBe(true);
    expect(cfg.url).toContain("jianguoyun");
    expect(cfg.username).toBe("test@example.com");
    expect(cfg.autoSync).toBe(true);
    expect(cfg.password).toBeUndefined();
  });

  it("非法入参：空字段 400 / 非 http 400 / 未登录 401", async () => {
    const empty = await fetch(`${BASE}/api/v1/sync/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ url: "x" }),
    });
    expect(empty.status).toBe(400);

    const badUrl = await fetch(`${BASE}/api/v1/sync/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ url: "ftp://x", username: "a", password: "b" }),
    });
    expect(badUrl.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/sync/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://x", username: "a", password: "b" }),
    });
    expect(anon.status).toBe(401);
  });
});
