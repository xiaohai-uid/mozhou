// 小说项目管理 API 契约测试（05 工单）：作品 CRUD + 章节 + 人物/世界观条目 + 归属校验
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { novels, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-novel-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";
const OBSERVER_FILE = "tests/http/.payload-observer.jsonl";

function observerCount(): number {
  try {
    return readFileSync(OBSERVER_FILE, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

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
      body: JSON.stringify({
        name: "零界道种",
        description: "一个失去记忆的修理师，在近未来城市追查自己的过去",
        requestKey: `legacy-route-${RUN}`,
      }),
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
      novels: Array<{ id: number; name: string; description: string | null; meta: string }>;
    };
    expect(novels.length).toBeGreaterThan(0);
    expect(novels[0].meta).toContain("章");
    expect(novels[0].description).toContain("失去记忆");

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

describe("POST /api/v1/novels/bootstrap", () => {
  it("原子准备首写：作品、第一章和工作流一次完成；重试幂等", async () => {
    const requestKey = `bootstrap-${RUN}`;
    const first = await fetch(`${BASE}/api/v1/novels/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "首写黄金路径", requestKey }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      created: boolean;
      novel: { id: number };
      chapter: { id: number; ch: string; title: string };
      workflow: { novelId: number; firstChapterId: number; state: string };
    };
    expect(firstBody.created).toBe(true);
    expect(firstBody.chapter.ch).toBe("001");
    expect(firstBody.chapter.title).toBe("第一章");
    expect(firstBody.workflow.novelId).toBe(firstBody.novel.id);
    expect(firstBody.workflow.firstChapterId).toBe(firstBody.chapter.id);
    expect(firstBody.workflow.state).toBe("ready");

    const retry = await fetch(`${BASE}/api/v1/novels/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "不同书名不应覆盖", requestKey }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as {
      created: boolean;
      novel: { id: number; name: string };
      chapter: { id: number };
    };
    expect(retryBody.created).toBe(false);
    expect(retryBody.novel.id).toBe(firstBody.novel.id);
    expect(retryBody.novel.name).toBe("首写黄金路径");
    expect(retryBody.chapter.id).toBe(firstBody.chapter.id);

    const detail = await fetch(`${BASE}/api/v1/novels/${firstBody.novel.id}`, {
      headers: { cookie: me.cookie },
    });
    const detailBody = (await detail.json()) as { chapters: Array<{ ch: string }> };
    expect(detailBody.chapters).toHaveLength(1);
    expect(detailBody.chapters[0].ch).toBe("001");
  });

  it("缺少请求键时拒绝，避免无法幂等的首写创建", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "没有请求键" }),
    });
    expect(res.status).toBe(400);
  });

  it("历史 0 章节作品可恢复首写，重复恢复不重复创建首章", async () => {
    const [legacyNovel] = await db
      .insert(novels)
      .values({ userId: me.id, name: "历史空作品" })
      .returning({ id: novels.id });
    const legacyBody = { novel: { id: legacyNovel.id } };

    const first = await fetch(`${BASE}/api/v1/novels/${legacyBody.novel.id}/start-writing`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      chapter: { id: number; ch: string };
      workflow: { firstChapterId: number };
    };
    expect(firstBody.chapter.ch).toBe("001");
    expect(firstBody.workflow.firstChapterId).toBe(firstBody.chapter.id);

    const retry = await fetch(`${BASE}/api/v1/novels/${legacyBody.novel.id}/start-writing`, {
      method: "POST",
      headers: { cookie: me.cookie },
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { chapter: { id: number } };
    expect(retryBody.chapter.id).toBe(firstBody.chapter.id);

    const detail = await fetch(`${BASE}/api/v1/novels/${legacyBody.novel.id}`, {
      headers: { cookie: me.cookie },
    });
    const detailBody = (await detail.json()) as { chapters: unknown[] };
    expect(detailBody.chapters).toHaveLength(1);
  });

  it("首写工作流保护第一章不被删除", async () => {
    const created = await fetch(`${BASE}/api/v1/novels/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "首章保护测试", requestKey: `protect-${RUN}` }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      novel: { id: number };
      chapter: { id: number };
    };

    const response = await fetch(
      `${BASE}/api/v1/novels/${body.novel.id}/chapters?chapterId=${body.chapter.id}`,
      { method: "DELETE", headers: { cookie: me.cookie } },
    );
    expect(response.status).toBe(409);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "第一章是首写入口，不能删除",
    });
  });
});

describe("POST /api/v1/novels/import", () => {
  it("导入自有正文：作品、首章和工作流原子创建；重试保留正文且幂等", async () => {
    const requestKey = `import-${RUN}`;
    const content = "这是用户拥有使用权的导入正文。".repeat(80);
    const first = await fetch(`${BASE}/api/v1/novels/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "导入作品", content, requestKey }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      created: boolean;
      novel: { id: number };
      chapter: { id: number; content: string; revision: number };
      workflow: { state: string };
    };
    expect(firstBody.created).toBe(true);
    expect(firstBody.chapter.content).toBe(content);
    expect(firstBody.chapter.revision).toBe(1);
    expect(firstBody.workflow.state).toBe("active");

    const retry = await fetch(`${BASE}/api/v1/novels/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "不应覆盖", content: `${content} changed`, requestKey }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as {
      created: boolean;
      novel: { id: number };
      chapter: { id: number; content: string };
    };
    expect(retryBody.created).toBe(false);
    expect(retryBody.novel.id).toBe(firstBody.novel.id);
    expect(retryBody.chapter.id).toBe(firstBody.chapter.id);
    expect(retryBody.chapter.content).toBe(content);
  });

  it("缺少请求键或正文过短时拒绝", async () => {
    const missingKey = await fetch(`${BASE}/api/v1/novels/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "无幂等键", content: "x".repeat(300) }),
    });
    expect(missingKey.status).toBe(400);
    const short = await fetch(`${BASE}/api/v1/novels/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "短正文", content: "太短", requestKey: `short-import-${RUN}` }),
    });
    expect(short.status).toBe(400);
  });
});

describe("GET/PATCH/DELETE /api/v1/novels/[id]", () => {
  it("详情：三栏结构（章节/人物/世界观）+ meta", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      novel: { name: string; description: string | null; meta: string };
      chapters: unknown[];
      characters: unknown[];
      worldviews: unknown[];
    };
    expect(detail.novel.name).toBe("零界道种");
    expect(detail.novel.description).toContain("失去记忆");
    expect(detail.chapters).toHaveLength(1);
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
    expect(chapter.ch).toBe("002");
    expect(chapter.status).toBe("draft");

    const detail = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { chapters } = (await detail.json()) as {
      chapters: Array<{ ch: string; title: string }>;
    };
    expect(chapters).toHaveLength(2);
    expect(chapters[1].title).toBe("灰烬有籽");
  });

  it("编辑章节状态：final；删除章节", async () => {
    const detail = await fetch(`${BASE}/api/v1/novels/${novelId}`, {
      headers: { cookie: me.cookie },
    });
    const { chapters } = (await detail.json()) as {
      chapters: Array<{ id: number }>;
    };
    const cid = chapters[1].id;

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
    expect(afterChapters).toHaveLength(1);
    expect((afterChapters[0] as { title: string }).title).toBe("第一章");
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

describe("RAG 设定注入（06 工单，关键词检索）", () => {
  let ragNovelId: number;

  it("前置：创建作品 + 人物/世界观条目", async () => {
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "RAG测试书", requestKey: `rag-${RUN}` }),
    });
    expect(novel.status).toBe(201);
    ragNovelId = ((await novel.json()) as { novel: { id: number } }).novel.id;

    const c = await fetch(`${BASE}/api/v1/novels/${ragNovelId}/entries?kind=character`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "陆沉舟", note: "阿雀的兄长，沉默寡言" }),
    });
    expect(c.status).toBe(201);

    const w = await fetch(`${BASE}/api/v1/novels/${ragNovelId}/entries?kind=worldview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "零界", note: "火苗偏斜的方向，无人提及" }),
    });
    expect(w.status).toBe(201);
  });

  it("相关话题：SSE done 事件携带注入条目", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "写一段陆沉舟走向零界的场景", novelId: ragNovelId }),
    });
    expect(res.status).toBe(200);
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      injected?: Array<{ kind: string; name: string }>;
    };
    expect(done?.injected).toBeDefined();
    const names = done.injected!.map((i) => i.name);
    expect(names).toContain("陆沉舟");
    expect(names).toContain("零界");
  });

  it("不相关话题：注入为空", async () => {
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "聊聊今天吃的苹果", novelId: ragNovelId }),
    });
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      injected?: unknown[];
    };
    expect(done?.injected ?? []).toHaveLength(0);
  });
});

describe("storyrepo 作品级追踪适配器", () => {
  let trackingNovelId = 0;
  let trackingChapterId = 0;

  it("结算章节：持久化追踪、检查历史和幂等 workflow run", async () => {
    const created = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "追踪测试书", requestKey: `tracking-${RUN}` }),
    });
    const body = (await created.json()) as { novel: { id: number }; chapter: { id: number } };
    trackingNovelId = body.novel.id;
    trackingChapterId = body.chapter.id;
    const saved = await fetch(`${BASE}/api/v1/novels/${trackingNovelId}/chapters?chapterId=${trackingChapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "第一章追踪正文".repeat(500) }),
    });
    expect(saved.status).toBe(200);

    const settle = () => fetch(`${BASE}/api/v1/novels/${trackingNovelId}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({
        chapterId: trackingChapterId,
        idempotencyKey: `settle-${RUN}`,
        facts: {
          result: "主角在雨夜找到旧钥匙",
          characterStates: [{ name: "主角", state: "持有旧钥匙" }],
          promises: [{ id: "P-001", text: "查明钥匙来历", status: "open" }],
          timeline: [{ text: "雨夜发现旧钥匙", kind: "fact" }],
          readerKnowledge: [{ text: "读者知道钥匙与旧屋有关" }],
        },
      }),
    });
    const first = await settle();
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      tracking: {
        stateRevision: number;
        state: {
          statusCard: { settledChapters: number };
          characterStates: Array<{ name: string; state: string }>;
          promises: Array<{ id?: string; status: string }>;
          timeline: Array<{ text: string; chapter: string }>;
          readerKnowledge: Array<{ text: string }>;
        };
      };
      records: Array<{ chapterId: number }>;
      reviews: Array<{ chapterId: number }>;
      runs: Array<{ idempotencyKey: string; status: string }>;
      workflow: { status: string };
    };
    expect(firstBody.workflow.status).toBe("completed");
    expect(firstBody.tracking.state.statusCard.settledChapters).toBe(1);
    expect(firstBody.records.some((record) => record.chapterId === trackingChapterId)).toBe(true);
    expect(firstBody.reviews.some((review) => review.chapterId === trackingChapterId)).toBe(true);
    expect(firstBody.runs.some((run) => run.idempotencyKey === `settle-${RUN}` && run.status === "completed")).toBe(true);
    expect(firstBody.tracking.state.characterStates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "主角", state: "持有旧钥匙" })]),
    );
    expect(firstBody.tracking.state.promises).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "P-001", status: "open" })]),
    );
    expect(firstBody.tracking.state.timeline).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "雨夜发现旧钥匙", chapter: "001" })]),
    );
    expect(firstBody.tracking.state.readerKnowledge).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "读者知道钥匙与旧屋有关" })]),
    );

    const retry = await settle();
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as typeof firstBody;
    expect(retryBody.records.filter((record) => record.chapterId === trackingChapterId)).toHaveLength(1);
  });

  it("追踪接口隔离作品归属", async () => {
    const response = await fetch(`${BASE}/api/v1/novels/${trackingNovelId}/tracking`, { headers: { cookie: other.cookie } });
    expect(response.status).toBe(404);
  });
});

describe("会话↔作品绑定（R3 决策）", () => {
  let bindNovelId: number;
  let boundSessionId: number;

  it("前置：创建绑定用作品 + 条目", async () => {
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "绑定测试书", requestKey: `bind-${RUN}` }),
    });
    bindNovelId = ((await novel.json()) as { novel: { id: number } }).novel.id;

    await fetch(`${BASE}/api/v1/novels/${bindNovelId}/entries?kind=character`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "独有角色甲", note: "只属于绑定测试书" }),
    });
  });

  it("新建会话带 novelId：返回并持久化", async () => {
    const res = await fetch(`${BASE}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ novelId: bindNovelId }),
    });
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as {
      session: { id: number; novelId: number | null };
    };
    boundSessionId = session.id;
    expect(session.novelId).toBe(bindNovelId);

    // 列表也带 novelId
    const list = await fetch(`${BASE}/api/v1/sessions`, {
      headers: { cookie: me.cookie },
    });
    const { sessions } = (await list.json()) as {
      sessions: Array<{ novelId: number | null }>;
    };
    expect(sessions.some((s) => s.novelId === bindNovelId)).toBe(true);
  });

  it("绑定作品后 chat：RAG 只注入该作品设定", async () => {
    const before = observerCount();
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({
        sessionId: boundSessionId,
        content: "写独有角色甲的出场",
        novelId,
      }),
    });
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      injected?: Array<{ name: string }>;
    };
    const names = (done?.injected ?? []).map((i) => i.name);
    expect(names).toContain("独有角色甲");
    expect(names).not.toContain("陆沉舟");
    expect(observerCount()).toBeGreaterThan(before);
  });

  it("越权：绑定他人作品 → 404 且不进入 provider", async () => {
    const before = observerCount();
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: other.cookie },
      body: JSON.stringify({ content: "写独有角色甲的出场", novelId: bindNovelId }),
    });
    expect(res.status).toBe(404);
    expect(observerCount()).toBe(before);
  });
});

describe("RAG 开关（06 收尾）", () => {
  let switchNovelId: number;

  it("前置：创建开关测试书 + 条目", async () => {
    const novel = await fetch(`${BASE}/api/v1/novels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "开关测试书", requestKey: `switch-${RUN}` }),
    });
    switchNovelId = ((await novel.json()) as { novel: { id: number } }).novel.id;
    await fetch(`${BASE}/api/v1/novels/${switchNovelId}/entries?kind=character`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ name: "开关人物", note: "开关测试用" }),
    });
  });

  it("默认开启：详情 ragEnabled=true，chat 正常注入", async () => {
    const detail = await fetch(`${BASE}/api/v1/novels/${switchNovelId}`, {
      headers: { cookie: me.cookie },
    });
    const d = (await detail.json()) as { novel: { ragEnabled: boolean } };
    expect(d.novel.ragEnabled).toBe(true);

    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "写开关人物的出场", novelId: switchNovelId }),
    });
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      injected?: Array<{ name: string }>;
    };
    expect((done?.injected ?? []).map((i) => i.name)).toContain("开关人物");
  });

  it("PATCH 关闭 ragEnabled=false：持久化 + chat 注入为空", async () => {
    const patch = await fetch(`${BASE}/api/v1/novels/${switchNovelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ ragEnabled: false }),
    });
    expect(patch.status).toBe(200);

    // 刷新详情：状态保持
    const detail = await fetch(`${BASE}/api/v1/novels/${switchNovelId}`, {
      headers: { cookie: me.cookie },
    });
    const d = (await detail.json()) as { novel: { ragEnabled: boolean } };
    expect(d.novel.ragEnabled).toBe(false);

    // chat 读取开关：注入为空
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "写开关人物的出场", novelId: switchNovelId }),
    });
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      injected?: unknown[];
    };
    expect(done?.injected ?? []).toHaveLength(0);
  });

  it("PATCH 重新开启：注入恢复", async () => {
    await fetch(`${BASE}/api/v1/novels/${switchNovelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ ragEnabled: true }),
    });
    const res = await fetch(`${BASE}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ content: "写开关人物的出场", novelId: switchNovelId }),
    });
    const events = (await res.text())
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = events.find((e) => e.type === "done") as {
      injected?: Array<{ name: string }>;
    };
    expect((done?.injected ?? []).map((i) => i.name)).toContain("开关人物");
  });
});
