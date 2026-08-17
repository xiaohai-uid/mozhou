import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chapters,
  characterEntries,
  novels,
  users,
  worldviewEntries,
} from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-export-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-export-other-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let otherCookie = "";
let userId = 0;
let novelId = 0;

async function register(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(201);
  const token = response.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  return `mozhou_session=${token}`;
}

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-export-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  userId = user!.id;

  const [novel] = await db
    .insert(novels)
    .values({ userId, name: "服务端导出测试", description: "服务端当前真源" })
    .returning({ id: novels.id });
  novelId = novel!.id;

  await db.insert(chapters).values([
    {
      novelId,
      ch: "002",
      title: "第二章",
      content: "第二章当前正文",
      sortOrder: 2,
      revision: 7,
    },
    {
      novelId,
      ch: "001",
      title: "第一章",
      content: "第一章当前正文",
      sortOrder: 1,
      revision: 4,
    },
  ]);
  await db.insert(characterEntries).values({ novelId, name: "主角", note: "当前人物设定" });
  await db.insert(worldviewEntries).values({ novelId, name: "边城", note: "当前世界观设定" });
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-export-%"));
});

describe("GET /api/v1/books/:bookId/export", () => {
  it("输出稳定 canonical JSON：服务端当前正文、revision 与章节顺序", async () => {
    const first = await fetch(`${BASE}/api/v1/books/${novelId}/export?format=json`, {
      headers: { cookie },
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("application/json");
    expect(first.headers.get("content-disposition")).toMatch(/attachment/);
    const firstBody = (await first.json()) as {
      schemaVersion: string;
      kind: string;
      novel: { id: number; name: string; description: string | null };
      chapters: Array<{ ch: string; revision: number; content: string }>;
      characters: Array<{ name: string; note: string | null }>;
      worldviews: Array<{ name: string; note: string | null }>;
    };
    expect(firstBody.schemaVersion).toBe("mozhou.novel.export.v1");
    expect(firstBody.kind).toBe("novel");
    expect(firstBody.novel).toMatchObject({ id: novelId, name: "服务端导出测试", description: "服务端当前真源" });
    expect(firstBody.chapters.map(({ ch, revision, content }) => ({ ch, revision, content }))).toEqual([
      { ch: "001", revision: 4, content: "第一章当前正文" },
      { ch: "002", revision: 7, content: "第二章当前正文" },
    ]);
    expect(firstBody.characters.map(({ name, note }) => ({ name, note }))).toEqual([
      { name: "主角", note: "当前人物设定" },
    ]);
    expect(firstBody.worldviews.map(({ name, note }) => ({ name, note }))).toEqual([
      { name: "边城", note: "当前世界观设定" },
    ]);

    const second = await fetch(`${BASE}/api/v1/books/${novelId}/export?format=json`, {
      headers: { cookie },
    });
    expect(await second.text()).toBe(JSON.stringify(firstBody));
  });

  it("鉴权、归属和 format 校验由服务端执行", async () => {
    const anonymous = await fetch(`${BASE}/api/v1/books/${novelId}/export?format=json`);
    expect(anonymous.status).toBe(401);

    const other = await fetch(`${BASE}/api/v1/books/${novelId}/export?format=json`, {
      headers: { cookie: otherCookie },
    });
    expect(other.status).toBe(404);

    const missingFormat = await fetch(`${BASE}/api/v1/books/${novelId}/export`, { headers: { cookie } });
    expect(missingFormat.status).toBe(400);
    const unsupportedFormat = await fetch(`${BASE}/api/v1/books/${novelId}/export?format=txt`, {
      headers: { cookie },
    });
    expect(unsupportedFormat.status).toBe(400);
  });
});
