// 抽卡模式 API 契约测试（10 工单）：指令 + 模型 → 生成文本
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-draw-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-draw-%"));
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
  await db.delete(users).where(like(users.email, "mozhou-draw-%"));
});

describe("POST /api/v1/draw（mock provider）", () => {
  it("deepseek-v4-flash：返回对应模型文本", async () => {
    const res = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        instruction: "写一段雨夜，阿雀在门口等陆沉舟回来",
      }),
    });
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("雨夜");
  });

  it("glm-4.5-flash：返回对应模型文本", async () => {
    const res = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        model: "glm-4.5-flash",
        instruction: "写一段雨夜",
      }),
    });
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    expect(text).toContain("夜雨");
  });

  it("非法入参：未知模型 400 / 空指令 400 / 未登录 401", async () => {
    const badModel = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ model: "foo", instruction: "x" }),
    });
    expect(badModel.status).toBe(400);

    const empty = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ model: "deepseek-v4-flash", instruction: "  " }),
    });
    expect(empty.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/draw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-flash", instruction: "x" }),
    });
    expect(anon.status).toBe(401);
  });
});
