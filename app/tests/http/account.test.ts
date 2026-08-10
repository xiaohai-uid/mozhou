// 会员额度与配额契约测试（11 工单）：用量记账 → 聚合 → 抽卡超额度 402
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-acct-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let userId = 0;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-acct-%"));
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  cookie = `mozhou_session=${token}`;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, EMAIL));
  userId = row!.id;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-acct-%"));
});

describe("GET /api/v1/account", () => {
  it("初始：free + 用量为 0", async () => {
    const res = await fetch(`${BASE}/api/v1/account`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      email: string;
      plan: string;
      quota: { token: { used: number; total: number }; draw: { used: number; total: number } };
    };
    expect(data.plan).toBe("free");
    expect(data.quota.token.used).toBe(0);
    expect(data.quota.draw.used).toBe(0);
  });

  it("未登录 → 401", async () => {
    const res = await fetch(`${BASE}/api/v1/account`);
    expect(res.status).toBe(401);
  });
});

describe("用量记账与聚合（11 工单）", () => {
  it("chat 一轮后 usage_events 落库，account 聚合增长", async () => {
    const chat = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "写一段话" }),
    });
    expect(chat.status).toBe(200);
    await chat.text(); // 读完 SSE 流，确保服务端 runChat（含记账）完成

    const rows = await db
      .select({ nodeType: usageEvents.nodeType })
      .from(usageEvents)
      .where(eq(usageEvents.userId, userId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].nodeType).toBe("写作对话");

    const res = await fetch(`${BASE}/api/v1/account`, { headers: { cookie } });
    const data = (await res.json()) as {
      quota: { token: { used: number } };
    };
    expect(data.quota.token.used).toBeGreaterThan(0);
  });

  it("抽卡记账：draw 成功后 usage_events 抽卡模式 +1，account draw.used 增长", async () => {
    const draw = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ model: "deepseek-v4-flash", instruction: "写一段雨夜" }),
    });
    expect(draw.status).toBe(200);

    const res = await fetch(`${BASE}/api/v1/account`, { headers: { cookie } });
    const data = (await res.json()) as {
      quota: { draw: { used: number } };
    };
    expect(data.quota.draw.used).toBe(1);
  });
});

describe("抽卡额度 gating（402）", () => {
  it("free 用户抽卡超 20 次/月 → 402 明确文案", async () => {
    // 直接插入 20 条抽卡记账（模拟本月已用满），再调 draw → 402
    await db.insert(usageEvents).values(
      Array.from({ length: 20 }, () => ({
        userId,
        nodeType: "抽卡模式",
        promptTokens: 10,
        completionTokens: 5,
      })),
    );

    const res = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ model: "deepseek-v4-flash", instruction: "再来一次" }),
    });
    expect(res.status).toBe(402);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("抽卡次数已用完");
  });
});
