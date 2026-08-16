// 对话 API 契约测试：会话 CRUD + SSE 流式 chat（mock provider）+ 归属校验
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-chat-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";
const OBSERVER_FILE = "tests/http/.payload-observer.jsonl";

function readPayloadObservations(): Array<{
  route: string;
  system_present: boolean;
  system_sections: string[];
  message_count: number;
  message_roles: string[];
  current_user_present: boolean;
  current_user_occurrences: number;
  compression_applied: boolean;
  history_count_before: number;
  history_count_after: number;
}> {
  try {
    return readFileSync(OBSERVER_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

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
    expect(events[0]).toMatchObject({ type: "start", phase: "preparing" });
    expect(events).toContainEqual({ type: "phase", phase: "streaming" });
    expect(events).toContainEqual({ type: "phase", phase: "finishing" });
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

  it("真实 HTTP consumer 能观察脱敏 payload 结构，而不是只观察 mock 输出", async () => {
    const observationsBefore = readPayloadObservations().length;
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: `payload-observer-${RUN}` }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const observation = readPayloadObservations().slice(observationsBefore).find(
      (entry) => entry.route === "chat" && entry.current_user_present && entry.message_count === 1,
    );
    expect(observation).toMatchObject({
      route: "chat",
      system_present: true,
      system_sections: ["base_identity", "mode_contract"],
      message_count: 1,
      message_roles: ["user"],
      current_user_present: true,
      current_user_occurrences: 1,
    });
    expect(JSON.stringify(readPayloadObservations())).not.toContain(`payload-observer-${RUN}`);
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

describe("风格/技能注入（R4 决策）", () => {
  it("携带 style + skills：SSE 正常完成", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({
        content: "写一段雨夜",
        style: "灰烬写实",
        skills: ["去AI味", "伏笔管理"],
      }),
    });
    expect(res.status).toBe(200);
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    expect(events[0].type).toBe("start");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("非法 skills（非字符串数组）→ 忽略不报错", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "hi", skills: [1, 2] as unknown as string[] }),
    });
    expect(res.status).toBe(200);
  });
});

describe("上下文自动压缩（12 工单）", () => {
  it("超阈值历史 → done 事件携带 compressed=true", async () => {
    // 先建会话（4 轮共用，历史才能累积）
    const created = await fetch(`${BASE}/api/v1/sessions`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    const { session } = (await created.json()) as { session: { id: number } };
    // 造超阈值历史：chat 单条上限 4000 字，分 4 次发 ~3000 字消息累计超 11200 字（5600 token）
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${BASE}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: me.cookie },
        body: JSON.stringify({
          sessionId: session.id,
          content: `第${i}轮设定：`.padEnd(3000, "长"),
        }),
      });
      expect(r.status).toBe(200);
      // 必须读完 SSE body：服务端在流式完成 + assistant 落库后才发 done，
      // 不消费 body 就发下一轮会读到中间态历史（压缩判定偶发失败，生产 gate 确定性修复）
      await r.text();
    }

    // 再发一条正常消息：此时历史已超阈值，应触发压缩
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ sessionId: session.id, content: "继续写" }),
    });
    expect(res.status).toBe(200);
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      compressed?: boolean;
    };
    expect(done?.compressed).toBe(true);

    const compressedObservation = readPayloadObservations().find(
      (entry) => entry.route === "chat" && entry.compression_applied,
    );
    expect(compressedObservation).toMatchObject({
      compression_applied: true,
    });
    expect(compressedObservation?.history_count_after).toBeLessThan(
      compressedObservation?.history_count_before ?? Number.MAX_SAFE_INTEGER,
    );
    expect(compressedObservation?.current_user_present).toBe(true);
    expect(compressedObservation?.current_user_occurrences).toBe(1);
  });

  it("短历史 → compressed=false 或缺失", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "短消息" }),
    });
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      compressed?: boolean;
    };
    expect(done?.compressed ?? false).toBe(false);
  });
});

describe("chat styleId 注入（工单 15，mock 回显 system 提示）", () => {
  it("携带 styleId → 四维指南按契约格式注入（叙事视角/句式节奏/意象偏好/情绪节奏）", async () => {
    const save = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({
        name: "注入测试风格",
        guide: { narrative: "N-视角", sentence: "S-句式", imagery: "I-意象", rhythm: "R-节奏" },
      }),
    });
    expect(save.status).toBe(201);
    const { style } = (await save.json()) as { style: { id: number } };

    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "写一段", styleId: style.id }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("（已注入：");
    expect(text).toContain(
      "[风格] 注入测试风格：叙事视角——N-视角；句式节奏——S-句式；意象偏好——I-意象；情绪节奏——R-节奏",
    );
    expect(text).toContain('"type":"done"');
  });

  it("他人风格的 styleId → 归属校验不注入，不报错", async () => {
    // other 保存一条风格
    const save = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: other.cookie },
      body: JSON.stringify({
        name: "他人风格",
        guide: { narrative: "X", sentence: "X", imagery: "X", rhythm: "X" },
      }),
    });
    expect(save.status).toBe(201);
    const { style } = (await save.json()) as { style: { id: number } };

    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "hi", styleId: style.id }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("他人风格");
    expect(text).toContain('"type":"done"');
  });

  it("不存在的 styleId → 静默忽略，正常完成", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "hi", styleId: 999999 }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("[风格]");
    expect(text).toContain('"type":"done"');
  });
});
