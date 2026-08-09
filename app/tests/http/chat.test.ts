// 对话 API 契约测试：会话 CRUD + SSE 流式 chat（mock provider）+ 归属校验
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-chat-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

interface TestUser {
  cookie: string;
  id: number;
}

async function registerUser(email: string): Promise<TestUser> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie")!;
  const token = setCookie.match(/mozhou_session=([^;]+)/)![1];
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  return { cookie: `mozhou_session=${token}`, id: row!.id };
}

let me: TestUser;
let other: TestUser;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-chat-%"));
  me = await registerUser(EMAIL);
  other = await registerUser(`mozhou-chat-other-${RUN}@example.com`);
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-chat-%"));
});

describe("GET/POST /api/v1/sessions", () => {
  it("新建会话：201 + 归属当前用户", async () => {
    const res = await fetch(`${BASE}/api/v1/sessions`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as { session: { id: number; title: string } };
    expect(session.title).toBe("新会话");
  });

  it("列表只返回自己的会话", async () => {
    const res = await fetch(`${BASE}/api/v1/sessions`, {
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    const { sessions } = (await res.json()) as { sessions: Array<{ id: number }> };
    expect(sessions.length).toBeGreaterThan(0);

    const otherRes = await fetch(`${BASE}/api/v1/sessions`, {
      headers: { cookie: other.cookie },
    });
    const { sessions: otherSessions } = (await otherRes.json()) as {
      sessions: Array<{ id: number }>;
    };
    // 新用户不应看到 me 的会话
    expect(otherSessions).toHaveLength(0);
  });

  it("未登录 → 401", async () => {
    const res = await fetch(`${BASE}/api/v1/sessions`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/chat（SSE 流式，mock provider）", () => {
  it("完整链路：SSE 收到 start/delta/done，消息落库，会话标题取首条消息", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ model: "deepseek-v4-flash", content: "帮我写个开篇" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await res.text();
    const events = body
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("delta");
    expect(types[types.length - 1]).toBe("done");
    const sessionId = events.find((e) => e.type === "start").sessionId as number;

    // 消息落库：user + assistant
    const msgs = await fetch(`${BASE}/api/v1/sessions/${sessionId}/messages`, {
      headers: { cookie: me.cookie },
    });
    const { messages } = (await msgs.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("帮我写个开篇");
    expect(messages[1].content).toContain("模拟流式输出");

    // 会话标题取首条消息
    const sessions = await fetch(`${BASE}/api/v1/sessions`, {
      headers: { cookie: me.cookie },
    });
    const { sessions: list } = (await sessions.json()) as {
      sessions: Array<{ id: number; title: string }>;
    };
    const s = list.find((x) => x.id === sessionId);
    expect(s?.title).toBe("帮我写个开篇");
  });

  it("新会话复用：不带 sessionId 自动建会话，二次调用续在同一会话", async () => {
    const first = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "第一句" }),
    });
    const firstEvents = (await first.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const sid = firstEvents.find((e) => e.type === "start").sessionId;

    const second = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ sessionId: sid, content: "第二句" }),
    });
    const secondEvents = (await second.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    expect(secondEvents.find((e) => e.type === "start").sessionId).toBe(sid);

    const msgs = await fetch(`${BASE}/api/v1/sessions/${sid}/messages`, {
      headers: { cookie: me.cookie },
    });
    const { messages } = (await msgs.json()) as {
      messages: Array<{ role: string }>;
    };
    expect(messages).toHaveLength(4); // 两轮 × (user+assistant)
  });

  it("非法入参：空消息 400 / 超长消息 400", async () => {
    const empty = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "   " }),
    });
    expect(empty.status).toBe(400);

    const long = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "长".repeat(4001) }),
    });
    expect(long.status).toBe(400);
  });

  it("未登录 → 401；非本人会话 → 404", async () => {
    const anon = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(anon.status).toBe(401);

    // me 建一个会话，other 访问其消息 → 404
    const created = await fetch(`${BASE}/api/v1/sessions`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    const { session } = (await created.json()) as { session: { id: number } };
    const cross = await fetch(`${BASE}/api/v1/sessions/${session.id}/messages`, {
      headers: { cookie: other.cookie },
    });
    expect(cross.status).toBe(404);
  });

  it("IDOR 防护：向他人会话写消息 → 404，且不落库不篡改标题", async () => {
    // me 建会话，other 用该 sessionId 发 chat → 404（SSE 流外拒绝）
    const created = await fetch(`${BASE}/api/v1/sessions`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    const { session } = (await created.json()) as { session: { id: number } };

    const attack = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: other.cookie },
      body: JSON.stringify({ sessionId: session.id, content: "越权注入" }),
    });
    expect(attack.status).toBe(404);

    // me 的会话应保持空（无 user 消息注入）
    const msgs = await fetch(`${BASE}/api/v1/sessions/${session.id}/messages`, {
      headers: { cookie: me.cookie },
    });
    const { messages } = (await msgs.json()) as { messages: unknown[] };
    expect(messages).toHaveLength(0);
  });
});
