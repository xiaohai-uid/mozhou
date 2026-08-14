// 云同步文件级推送契约测试（工单 20，V1.1 Journey ④）：单向备份语义 + autoSync 配置
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-sync-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let novelId = 0;
let chapter1Id = 0;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-sync-%"));
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  cookie = `mozhou_session=${token}`;
  // 作品 + 两章（一章有正文、一章空正文——空正文应跳过）
  const novel = await fetch(`${BASE}/api/v1/novels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "同步测试书", requestKey: `sync-${RUN}` }),
  });
  const { novel: n } = (await novel.json()) as { novel: { id: number } };
  novelId = n.id;
  for (const t of ["第一章 开篇", "第二章 留白"]) {
    const ch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ title: t }),
    });
    const { chapter } = (await ch.json()) as { chapter: { id: number } };
    if (t === "第一章 开篇") chapter1Id = chapter.id;
  }
  // 第一章写正文（空章节第二章不推送）
  await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapter1Id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ content: "第一章正文内容" }),
  });
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-sync-%"));
});

describe("sync 文件级推送（工单 20）", () => {
  it("未配置同步 → 400 可读文案", async () => {
    const res = await fetch(`${BASE}/api/v1/sync/push`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("尚未配置");
  });

  it("配置后推送：mock 返回 pushed 计数（空正文章节跳过）", async () => {
    const cfg = await fetch(`${BASE}/api/v1/sync/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        url: "https://dav.example.com/mozhou/",
        username: "test-user",
        password: "app-pass",
        autoSync: true,
      }),
    });
    expect(cfg.status).toBe(200);

    const res = await fetch(`${BASE}/api/v1/sync/push`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { pushed: number; at: string };
    expect(data.pushed).toBe(1); // 只有第一章有正文
    expect(typeof data.at).toBe("string");
  });

  it("无正文章节时：pushed 0 不报错", async () => {
    // 把第一章正文清空
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapter1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "" }),
    });
    const res = await fetch(`${BASE}/api/v1/sync/push`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { pushed: number };
    expect(data.pushed).toBe(0);
  });

  it("未登录 401", async () => {
    const res = await fetch(`${BASE}/api/v1/sync/push`, {
      method: "POST",
      headers: {},
    });
    expect(res.status).toBe(401);
  });
});
