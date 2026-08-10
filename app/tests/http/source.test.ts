// 书源引擎契约测试（08 工单）：搜索（容错降级）+ 导入书架 + 书架列表
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-src-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-src-%"));
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
  await db.delete(users).where(like(users.email, "mozhou-src-%"));
});

describe("POST /api/v1/search（mock provider → 降级数据）", () => {
  it("搜索返回结果（含降级标记，不抛异常）", async () => {
    const res = await fetch(`${BASE}/api/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ query: "零界道种" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      results: Array<{ source: string; name: string }>;
      degraded: boolean;
    };
    expect(data.results.length).toBeGreaterThan(0);
    // mock provider 下必降级（外部源不可达的确定性表现）
    expect(data.degraded).toBe(true);
    expect(data.results[0].name.length).toBeGreaterThan(0);
  });

  it("非法入参：空关键词 400 / 未登录 401", async () => {
    const empty = await fetch(`${BASE}/api/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ query: "  " }),
    });
    expect(empty.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "x" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("书架导入与列表（08 工单）", () => {
  it("导入 → 201；列表可见", async () => {
    const post = await fetch(`${BASE}/api/v1/shelf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name: "灰烬有籽",
        source: "书古阁",
        author: "佚名",
        site: "shukuge.com",
        status: "已读 3 章",
      }),
    });
    expect(post.status).toBe(201);

    const list = await fetch(`${BASE}/api/v1/shelf`, {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const { books } = (await list.json()) as {
      books: Array<{ name: string; source: string }>;
    };
    expect(books.some((b) => b.name === "灰烬有籽" && b.source === "书古阁")).toBe(true);
  });

  it("空书名导入 → 400；未登录 → 401", async () => {
    const empty = await fetch(`${BASE}/api/v1/shelf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "  " }),
    });
    expect(empty.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/shelf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("书架前端数据链路（任务一：shelf-view 接真）", () => {
  it("导入的书在列表中真实可见（search 导入 → shelf 读取）", async () => {
    // 模拟 search 页导入动作（与 search-view importBook 相同的请求）
    const post = await fetch(`${BASE}/api/v1/shelf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name: "灰烬有籽",
        source: "书古阁",
        author: "佚名",
        site: "shukuge.com",
        status: "已读 3 章",
      }),
    });
    expect(post.status).toBe(201);

    // shelf-view 的加载请求（GET 列表）
    const list = await fetch(`${BASE}/api/v1/shelf`, { headers: { cookie } });
    expect(list.status).toBe(200);
    const { books } = (await list.json()) as {
      books: Array<{ id: number; name: string; source: string; author: string; site: string; status: string }>;
    };
    const target = books.find((b) => b.name === "灰烬有籽" && b.source === "书古阁");
    expect(target).toBeDefined();
    expect(target?.author).toBe("佚名");
    expect(target?.site).toBe("shukuge.com");
    expect(target?.status).toBe("已读 3 章");
  });

  it("新用户书架为空（空态数据）", async () => {
    // 新注册用户（无导入）→ GET 应返回空数组
    const email = `mozhou-src-empty-${RUN}@example.com`;
    const reg = await fetch(`${BASE}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const emptyCookie = `mozhou_session=${reg.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1]}`;
    const list = await fetch(`${BASE}/api/v1/shelf`, { headers: { cookie: emptyCookie } });
    const { books } = (await list.json()) as { books: unknown[] };
    expect(books).toHaveLength(0);
  });
});
