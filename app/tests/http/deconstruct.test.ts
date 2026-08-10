// 小说拆解 API 契约测试（09 工单）：文本 → 三段式拆解结果
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-decon-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-decon-%"));
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
  await db.delete(users).where(like(users.email, "mozhou-decon-%"));
});

describe("POST /api/v1/deconstruct/analyze（mock provider）", () => {
  it("正常拆解：返回结构/剧情/节奏三数组", async () => {
    const text = "灰烬镇。灯童与陆沉舟立约。灰里开田，土是活的。阿雀守着火苗，火苗偏斜指向零界。".repeat(10);
    const res = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text, title: "灰烬有籽" }),
    });
    expect(res.status).toBe(200);
    const { result, title } = (await res.json()) as {
      result: { structure: string[]; plot: string[]; rhythm: string[] };
      title: string;
    };
    expect(title).toBe("灰烬有籽");
    expect(result.structure.length).toBeGreaterThan(0);
    expect(result.plot.length).toBeGreaterThan(0);
    expect(result.rhythm.length).toBeGreaterThan(0);
    result.structure.forEach((s) => expect(typeof s).toBe("string"));
  });

  it("文本过短 → 400；未登录 → 401", async () => {
    const short = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: "太短" }),
    });
    expect(short.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/deconstruct/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "灰烬镇。".repeat(100) }),
    });
    expect(anon.status).toBe(401);
  });
});
