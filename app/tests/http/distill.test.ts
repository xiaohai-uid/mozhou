// 风格蒸馏 API 契约测试（07 工单）：文本 → 四维风格指南
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-distill-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-distill-%"));
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
  await db.delete(users).where(like(users.email, "mozhou-distill-%"));
});

describe("POST /api/v1/distill（mock provider）", () => {
  it("正常分析：返回四维指南", async () => {
    const text = "灰烬镇。灯童与陆沉舟立约。灰里开田，第一铲下去，土是活的。阿雀守着灰罐里的火苗。".repeat(10);
    const res = await fetch(`${BASE}/api/v1/distill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text }),
    });
    expect(res.status).toBe(200);
    const { guide } = (await res.json()) as {
      guide: {
        narrative: string;
        sentence: string;
        imagery: string;
        rhythm: string;
      };
    };
    expect(guide.narrative.length).toBeGreaterThan(0);
    expect(guide.sentence.length).toBeGreaterThan(0);
    expect(guide.imagery.length).toBeGreaterThan(0);
    expect(guide.rhythm.length).toBeGreaterThan(0);
  });

  it("文本过短 → 400；未登录 → 401", async () => {
    const short = await fetch(`${BASE}/api/v1/distill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: "太短了" }),
    });
    expect(short.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/distill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "灰烬镇。".repeat(100) }),
    });
    expect(anon.status).toBe(401);
  });
});
