// 契约测试：PATCH 章节的乐观并发保护（Contract Delta 2026-08-21）。
// expectedRevision 选填但携带即强制（与 insert 的 expectedContent 同构）：
//   携带且与当前 revision 不一致 → 409 { code: "ContentChanged", chapter: 当前行 }
//   未携带 → 无条件写入（契约要求客户端随 content 必须携带；服务端不代偿）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-conflict-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let novelId = 0;
let chapterId = 0;

async function patchChapter(body: Record<string, unknown>) {
  return fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-conflict-%"));
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(reg.status).toBe(201);
  const token = reg.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  cookie = `mozhou_session=${token}`;

  // quickStart 创建作品并自带第一章（revision 0）
  const novel = await fetch(`${BASE}/api/v1/novels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: `并发测试-${RUN}`, requestKey: `conflict-${RUN}` }),
  });
  expect(novel.status).toBe(201);
  const novelJson = (await novel.json()) as {
    novel: { id: number };
    chapter: { id: number; revision: number };
  };
  novelId = novelJson.novel.id;
  chapterId = novelJson.chapter.id;
  expect(novelJson.chapter.revision).toBe(0);
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-conflict-%"));
});

describe("PATCH /api/v1/novels/[id]/chapters 乐观并发（expectedRevision）", () => {
  it("携带正确 expectedRevision 写入成功，revision 递增", async () => {
    const res = await patchChapter({ content: "第一版正文", expectedRevision: 0 });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { chapter: { revision: number; content: string } };
    expect(json.chapter.revision).toBe(1);
    expect(json.chapter.content).toBe("第一版正文");
  });

  it("携带过期 expectedRevision → 409 ContentChanged，返回当前行", async () => {
    const res = await patchChapter({ content: "过期写入", expectedRevision: 0 });
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      code?: string;
      chapter?: { revision: number; content: string };
    };
    expect(json.code).toBe("ContentChanged");
    expect(json.chapter!.revision).toBe(1);
    expect(json.chapter!.content).toBe("第一版正文");
  });

  it("未携带 expectedRevision → 无条件写入（契约：客户端必须携带，服务端不代偿）", async () => {
    const res = await patchChapter({ content: "无保护写入" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { chapter: { revision: number } };
    expect(json.chapter.revision).toBe(2);
  });

  it("仅改标题不带 expectedRevision → 不受并发门控限制", async () => {
    const res = await patchChapter({ title: "改名不影响正文" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { chapter: { revision: number; title: string } };
    expect(json.chapter.revision).toBe(2); // 标题变更不递增 revision
    expect(json.chapter.title).toBe("改名不影响正文");
  });

  it("expectedRevision 非法（负数/非整数）→ 400", async () => {
    for (const bad of [-1, 1.5]) {
      const res = await patchChapter({ content: "x", expectedRevision: bad });
      expect(res.status).toBe(400);
    }
  });
});
