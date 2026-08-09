// 小说项目管理 API 契约测试（05 工单）：作品 CRUD + 章节 + 人物/世界观条目 + 归属校验
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-novel-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

interface TestUser {
  cookie: string;
  id: number;
}

async function registerUser(email: string): Promise<TestUser> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie")!;
  const token = setCookie.match(/mozhou_session=([^;]+)/)![1];
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  return { cookie: `mozhou_session=${token}`, id: row!.id };
}

let me: TestUser;
let other: TestUser;
let novelId: number;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-novel-%"));
  me = await registerUser(EMAIL);
  other = await registerUser(`mozhou-novel-other-${RUN}@example.com`);
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-novel-%"));
});

describe("POST/GET /api/v1/novels", () => {
  it("创建作品：201 + 归属当前用户", async () => {
    const res = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "零界道种" }),
    });
    expect(res.status).toBe(201);
    const { novel } = (await res.json()) as { novel: { id: number; name: string } };
    expect(novel.name).toBe("零界道种");
    novelId = novel.id;
  });

  it("非法入参：空书名 400 / 超长书名 400", async () => {
    const empty = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "   " }),
    });
    expect(empty.status).toBe(400);

    const long = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "长".repeat(101) }),
    });
    expect(long.status).toBe(400);
  });

  it("列表只返回自己的作品；未登录 401", async () => {
    const res = await fetch(`${BASE}/api/v1/novels`, {
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    const { novels } = (await res.json()) as {
      novels: Array<{ id: number; name: string; meta: string }>;
    };
    expect(novels.length).toBeGreaterThan(0);
    expect(novels[0].meta).toContain("章");

    const otherRes = await fetch(`${BASE}/api/v1/novels`, {
      headers: { cookie: other.cookie },
    });
    const { novels: otherNovels } = (await otherRes.json()) as {
      novels: Array<{ id: number }>;
    };
    expect(otherNovels).toHaveLength(0);

    const anon = await fetch(`${BASE}/api/v1/novels`);
    expect(anon.status).toBe(401);
  });
});

describe("GET/PATCH/DELETE /api/v1/novels/[id]", () => {
  it("详情：三栏结构（章节/人物/世界观）+ meta", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      novel: { name: string; meta: string };
      chapters: unknown[];
      characters: unknown[];
      worldviews: unknown[];
    };
    expect(detail.novel.name).toBe("零界道种");
    expect(detail.chapters).toEqual([]);
    expect(detail.characters).toEqual([]);
    expect(detail.worldviews).toEqual([]);
  });

  it("编辑书名：PATCH 生效", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "零界道种（修订）" }),
    });
    expect(res.status).toBe(200);
    const { novel } = (await res.json()) as { novel: { name: string } };
    expect(novel.name).toBe("零界道种（修订）");
  });

  it("越权：他人访问/编辑/删除 → 404", async () => {
    const get = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: other.cookie },
    });
    expect(get.status).toBe(404);

    const patch = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: other.cookie },
      body: JSON.stringify({ name: "越权改名" }),
    });
    expect(patch.status).toBe(404);

    const del = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      method: "DELETE",
      headers: { cookie: other.cookie },
    });
    expect(del.status).toBe(404);

    // me 的书名未被篡改
    const verify = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { novel } = (await verify.json()) as { novel: { name: string } };
    expect(novel.name).toBe("零界道种（修订）");
  });
});

describe("章节 CRUD", () => {
  it("新建章节：ch 自动编号，列表可见", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ title: "灰烬有籽" }),
    });
    expect(res.status).toBe(201);
    const { chapter } = (await res.json()) as {
      chapter: { id: number; ch: string; title: string; status: string };
    };
    expect(chapter.ch).toBe("001");
    expect(chapter.status).toBe("draft");

    const detail = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { chapters } = (await detail.json()) as {
      chapters: Array<{ ch: string; title: string }>;
    };
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("灰烬有籽");
  });

  it("编辑章节状态：final；删除章节", async () => {
    const detail = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { chapters } = (await detail.json()) as {
      chapters: Array<{ id: number }>;
    };
    const cid = chapters[0].id;

    const patch = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${cid}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: me.cookie },
        body: JSON.stringify({ status: "final" }),
      },
    );
    expect(patch.status).toBe(200);
    const { chapter } = (await patch.json()) as { chapter: { status: string } };
    expect(chapter.status).toBe("final");

    const del = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${cid}`,
      { method: "DELETE", headers: { cookie: me.cookie } },
    );
    expect(del.status).toBe(200);

    const after = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { chapters: afterChapters } = (await after.json()) as {
      chapters: unknown[];
    };
    expect(afterChapters).toHaveLength(0);
  });

  it("越权：他人对章节操作 → 404", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: other.cookie },
      body: JSON.stringify({ title: "越权章节" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("人物/世界观条目 CRUD", () => {
  it("新建条目（kind=character/worldview）", async () => {
    const c = await fetch(`${BASE}/api/v1/novels/${novelId}/entries?kind=character`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "陆沉舟", note: "阿雀的兄长" }),
    });
    expect(c.status).toBe(201);
    const { entry } = (await c.json()) as { entry: { id: number; name: string } };
    expect(entry.name).toBe("陆沉舟");

    const w = await fetch(`${BASE}/api/v1/novels/${novelId}/entries?kind=worldview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "零界" }),
    });
    expect(w.status).toBe(201);

    const detail = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const d = (await detail.json()) as {
      characters: Array<{ name: string; note: string | null }>;
      worldviews: Array<{ name: string }>;
    };
    expect(d.characters).toHaveLength(1);
    expect(d.characters[0].note).toBe("阿雀的兄长");
    expect(d.worldviews).toHaveLength(1);
  });

  it("非法 kind → 400；越权删除 → 404", async () => {
    const bad = await fetch(`${BASE}/api/v1/novels/${novelId}/entries?kind=foo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "x" }),
    });
    expect(bad.status).toBe(400);

    const detail = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { characters } = (await detail.json()) as {
      characters: Array<{ id: number }>;
    };
    const del = await fetch(
      `${BASE}/api/v1/novels/${novelId}/entries?kind=character&entryId=${characters[0].id}`,
      { method: "DELETE", headers: { cookie: other.cookie } },
    );
    expect(del.status).toBe(404);
  });

  it("删除作品级联清空章节与条目", async () => {
    const del = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      method: "DELETE",
      headers: { cookie: me.cookie },
    });
    expect(del.status).toBe(200);

    const after = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    expect(after.status).toBe(404);
  });
});
