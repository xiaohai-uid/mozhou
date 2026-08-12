// 技能广场契约测试（任务二-A）：技能 CRUD + 广场安装 + chat 真实 Prompt 注入
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-skill-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-skill-other-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let otherCookie = "";

async function register(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  return `mozhou_session=${token}`;
}

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-skill-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-skill-%"));
});

describe("技能 CRUD（任务二-A）", () => {
  it("创建技能：201 + 列表可见", async () => {
    const res = await fetch(`${BASE}/api/v1/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name: "悬念铺垫检查",
        description: "登记与回收纪律检查",
        systemPrompt: "写作时登记每个悬念，章节结束前必须回收或推进。",
      }),
    });
    expect(res.status).toBe(201);

    const list = await fetch(`${BASE}/api/v1/skills?scope=mine`, {
      headers: { cookie },
    });
    const { skills } = (await list.json()) as {
      skills: Array<{ id: number; name: string; systemPrompt: string; author: string }>;
    };
    const target = skills.find((s) => s.name === "悬念铺垫检查");
    expect(target).toBeDefined();
    expect(target?.systemPrompt).toContain("回收或推进");
    expect(target?.author).toBe("自定义");
  });

  it("广场源：3 个内置技能", async () => {
    const res = await fetch(`${BASE}/api/v1/skills?scope=plaza`, {
      headers: { cookie },
    });
    const { skills } = (await res.json()) as {
      skills: Array<{ name: string; author: string }>;
    };
    expect(skills.length).toBe(3);
    expect(skills.some((s) => s.name === "去 AI 味" && s.author === "墨舟官方")).toBe(true);
  });

  it("安装广场技能 → 出现在我的技能；删除 → 消失", async () => {
    // 安装「去 AI 味」
    const plaza = await fetch(`${BASE}/api/v1/skills?scope=plaza`, {
      headers: { cookie },
    });
    const { skills: plazaList } = (await plaza.json()) as {
      skills: Array<{ name: string; description: string; systemPrompt: string; author: string }>;
    };
    const target = plazaList.find((s) => s.name === "去 AI 味")!;
    const install = await fetch(`${BASE}/api/v1/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(target),
    });
    expect(install.status).toBe(201);

    const mine = await fetch(`${BASE}/api/v1/skills?scope=mine`, {
      headers: { cookie },
    });
    const { skills: mineList } = (await mine.json()) as {
      skills: Array<{ id: number; name: string }>;
    };
    const installed = mineList.find((s) => s.name === "去 AI 味");
    expect(installed).toBeDefined();

    // 删除
    const del = await fetch(`${BASE}/api/v1/skills?id=${installed!.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
  });

  it("删除归属校验：本人可删；他人和不存在目标均 404 且他人技能仍保留", async () => {
    const created = await fetch(`${BASE}/api/v1/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({
        name: "他人私有技能",
        description: "仅用于归属边界测试",
        systemPrompt: "保持归属边界。",
      }),
    });
    expect(created.status).toBe(201);
    const { skill } = (await created.json()) as { skill: { id: number } };

    const crossDel = await fetch(`${BASE}/api/v1/skills?id=${skill.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(crossDel.status).toBe(404);

    const otherList = await fetch(`${BASE}/api/v1/skills?scope=mine`, {
      headers: { cookie: otherCookie },
    });
    const { skills: otherSkills } = (await otherList.json()) as { skills: Array<{ id: number }> };
    expect(otherSkills.some((row) => row.id === skill.id)).toBe(true);

    const ownDel = await fetch(`${BASE}/api/v1/skills?id=${skill.id}`, {
      method: "DELETE",
      headers: { cookie: otherCookie },
    });
    expect(ownDel.status).toBe(200);

    const missingDel = await fetch(`${BASE}/api/v1/skills?id=${skill.id}`, {
      method: "DELETE",
      headers: { cookie: otherCookie },
    });
    expect(missingDel.status).toBe(404);
  });

  it("非法入参：空字段 400 / 未登录 401", async () => {
    const empty = await fetch(`${BASE}/api/v1/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "x" }),
    });
    expect(empty.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a", description: "b", systemPrompt: "c" }),
    });
    expect(anon.status).toBe(401);
  });
});

describe("chat 技能真实注入（任务二-A）", () => {
  it("携带技能名 → chat 正常完成（技能 systemPrompt 注入不报错）", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        content: "写一段话",
        skills: ["悬念铺垫检查"],
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

  it("未安装的技能名 → 忽略不报错", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "hi", skills: ["不存在的技能"] }),
    });
    expect(res.status).toBe(200);
  });
});
