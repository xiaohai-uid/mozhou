// 写作机检契约测试（任务二-B）：6 项检查真实逻辑
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-tools-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-tools-%"));
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
  await db.delete(users).where(like(users.email, "mozhou-tools-%"));
});

const GOOD_TEXT = Array.from(
  { length: 55 },
  (_, i) =>
    `第${i}日，灰烬镇清晨，阿雀立在门口等陆沉舟回来。雾气裹着冷意，巷子空无一人。灯芯草田在远处沙沙响。开田的人已经动身，守塔的人还在塔上。`,
).join("\n");

describe("POST /api/v1/tools/checks", () => {
  it("合规正文：6 项检查全过（字数窗口/占位/泄密/实体/复读/合同）", async () => {
    const res = await fetch(`${BASE}/api/v1/tools/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: GOOD_TEXT, mustCover: ["开田", "守塔"] }),
    });
    expect(res.status).toBe(200);
    const { checks } = (await res.json()) as {
      checks: Array<{ name: string; ok: boolean; detail: string }>;
    };
    expect(checks).toHaveLength(6);
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName["字数窗口"].ok).toBe(true);
    expect(byName["占位符"].ok).toBe(true);
    expect(byName["泄密扫描"].ok).toBe(true);
    expect(byName["复读检测"].ok).toBe(true);
    expect(byName["合同断言"].ok).toBe(true);
    expect(byName["合同断言"].detail).toContain("全覆盖");
  });

  it("违规正文：泄密 + 必含词缺失 + 复读 被检出", async () => {
    const badText =
      "灰烬镇清晨，阿雀立在门口。S-001 的真相在第一章就曝光了。\n\n灰烬镇清晨，阿雀立在门口。S-003 也提前泄露。";
    const res = await fetch(`${BASE}/api/v1/tools/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: badText, mustCover: ["开田", "守塔"] }),
    });
    const { checks } = (await res.json()) as {
      checks: Array<{ name: string; ok: boolean; detail: string }>;
    };
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName["泄密扫描"].ok).toBe(false);
    expect(byName["泄密扫描"].detail).toContain("S-001");
    expect(byName["合同断言"].ok).toBe(false);
    expect(byName["合同断言"].detail).toContain("开田");
    expect(byName["复读检测"].ok).toBe(false);
  });

  it("非法入参：空正文 400 / 未登录 401", async () => {
    const empty = await fetch(`${BASE}/api/v1/tools/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ text: "  " }),
    });
    expect(empty.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/tools/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(3000) }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("实体登记真实化（② 修复）", () => {
  it("正文出现库外实体 → 登记失败并提示", async () => {
    const res = await fetch(`${BASE}/api/v1/tools/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        text: "青水河站在岸边，望向远处的山。".repeat(50),
        knownEntities: ["陆沉舟", "阿雀"],
      }),
    });
    const { checks } = (await res.json()) as {
      checks: Array<{ name: string; ok: boolean; detail: string }>;
    };
    const entity = checks.find((c) => c.name === "实体登记")!;
    expect(entity.ok).toBe(false);
    expect(entity.detail).toContain("青水河");
  });

  it("正文实体均在库中 → 登记通过", async () => {
    const res = await fetch(`${BASE}/api/v1/tools/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        text: "陆沉舟站在岸边，阿雀望向远处的山。".repeat(50),
        knownEntities: ["陆沉舟", "阿雀"],
      }),
    });
    const { checks } = (await res.json()) as {
      checks: Array<{ name: string; ok: boolean; detail: string }>;
    };
    const entity = checks.find((c) => c.name === "实体登记")!;
    expect(entity.ok).toBe(true);
  });
});
