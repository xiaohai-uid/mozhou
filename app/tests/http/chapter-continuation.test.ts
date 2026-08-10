// 章节级续写契约测试（V1.1 Journey ⑦，工单 16）：章节正文读写（content 落库 + 归属校验）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-chcont-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-chcont-o-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let otherCookie = "";
let novelId = 0;
let chapterId = 0;

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
  await db.delete(users).where(like(users.email, "mozhou-chcont-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
  // 准备作品 + 章节
  const novel = await fetch(`${BASE}/api/v1/novels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "正文读写测试" }),
  });
  const { novel: n } = (await novel.json()) as { novel: { id: number } };
  novelId = n.id;
  const ch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ title: "第一章 开篇" }),
  });
  const { chapter } = (await ch.json()) as { chapter: { id: number } };
  chapterId = chapter.id;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-chcont-%"));
});

describe("章节正文读写（工单 16）", () => {
  it("GET 单章：初始 content 为空串", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const { chapter } = (await res.json()) as {
      chapter: { id: number; title: string; content: string; status: string };
    };
    expect(chapter.id).toBe(chapterId);
    expect(chapter.title).toBe("第一章 开篇");
    expect(chapter.content).toBe("");
    expect(chapter.status).toBe("draft");
  });

  it("PATCH content：保存正文 → GET 往返一致", async () => {
    const body = "黄土坡上，老周把锄头抡起来。\n\n土腥气顺着风钻进鼻子里。";
    const patch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: body }),
    });
    expect(patch.status).toBe(200);
    const { chapter } = (await patch.json()) as { chapter: { content: string } };
    expect(chapter.content).toBe(body);

    const get = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      headers: { cookie },
    });
    const { chapter: got } = (await get.json()) as { chapter: { content: string } };
    expect(got.content).toBe(body);
  });

  it("PATCH content 覆盖保存（自动保存幂等）", async () => {
    const second = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "覆盖后的正文" }),
    });
    expect(second.status).toBe(200);
    const get = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      headers: { cookie },
    });
    const { chapter } = (await get.json()) as { chapter: { content: string } };
    expect(chapter.content).toBe("覆盖后的正文");
  });

  it("title/status 与 content 可同时更新", async () => {
    const patch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ title: "第一章 开篇（改）", status: "final", content: "定稿正文" }),
    });
    expect(patch.status).toBe(200);
    const { chapter } = (await patch.json()) as {
      chapter: { title: string; status: string; content: string };
    };
    expect(chapter.title).toBe("第一章 开篇（改）");
    expect(chapter.status).toBe("final");
    expect(chapter.content).toBe("定稿正文");
  });

  it("越权：他人作品/章节 → 404", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      headers: { cookie: otherCookie },
    });
    expect(res.status).toBe(404);
    const patch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ content: "x" }),
    });
    expect(patch.status).toBe(404);
  });

  it("非法入参：缺 chapterId 400 / 空 PATCH 400 / 未登录 401", async () => {
    const noId = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters`, {
      headers: { cookie },
    });
    expect(noId.status).toBe(400);

    const emptyPatch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    expect(emptyPatch.status).toBe(400);

    const anon = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      headers: {},
    });
    expect(anon.status).toBe(401);
  });
});
