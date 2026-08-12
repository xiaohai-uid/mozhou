// 章节级续写契约测试（V1.1 Journey ⑦，工单 16）：章节正文读写（content 落库 + 归属校验）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapterMessages, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-chcont-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-chcont-o-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";
const OBSERVER_FILE = "tests/http/.payload-observer.jsonl";

function readPayloadObservations(): Array<{
  route: string;
  message_count: number;
  message_roles: string[];
  current_user_present: boolean;
  chapter_scope_present: boolean;
  skill_count: number;
  system_sections: string[];
}> {
  try {
    return readFileSync(OBSERVER_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function providerCallCount(): number {
  return readPayloadObservations().filter((entry) => entry.route === "chapter-chat").length;
}

let cookie = "";
let otherCookie = "";
let novelId = 0;
let chapterId = 0;
let userId = 0;

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
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  userId = user!.id;
  // 准备作品 + 章节
  const novel = await fetch(`${BASE}/api/v1/novels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "正文读写测试", requestKey: `chapter-${RUN}` }),
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

describe("章节正文读写（工单 16）", () => {  it("GET 单章：初始 content 为空串", async () => {
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

describe("章节对话引擎（工单 17）", () => {
  /** SSE 文本 → 事件数组 */
  function parseSse(text: string) {
    return text
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
  }

  it("POST chat：SSE start/delta/done + 消息落库（skills 快照 + snapshot）", async () => {
    // 先给章节写一段正文（注入链正文参考）
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "黄土坡上，老周把锄头抡起来。" }),
    });
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "继续写：夜里起风了", skills: ["章节续写", "去 AI 味"] }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    expect(events[0].type).toBe("start");
    expect(events.some((e) => e.type === "delta")).toBe(true);
    const done = events.find((e) => e.type === "done") as { messageId?: number };
    expect(done?.messageId).toBeTruthy();
    expect(done).toEqual({ type: "done", messageId: done!.messageId });

    const chapterObservation = readPayloadObservations().find((entry) => entry.route === "chapter-chat");
    expect(chapterObservation).toMatchObject({
      route: "chapter-chat",
      message_count: 1,
      message_roles: ["user"],
      current_user_present: true,
      current_user_occurrences: 1,
      chapter_scope_present: true,
      system_sections: ["base_identity", "mode_contract", "chapter_reference", "skill"],
    });

    // 落库断言：user + assistant（skills 快照 + snapshot=生成时正文）
    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as {
      messages: Array<{
        role: string;
        content: string;
        skills: string[];
        snapshot: string;
        status: string;
      }>;
    };
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("user");
    expect(messages[0].skills).toEqual(["章节续写", "去 AI 味"]);
    expect(messages[0].snapshot).toBe("黄土坡上，老周把锄头抡起来。");
    expect(messages[0].status).toBe("completed_candidate");
  });

  it("注入链：mock 回显可见 [正文参考] 与 [技能] 与 [风格]", async () => {
    // 保存一个风格（styleId 注入路径）
    const style = await fetch(`${BASE}/api/v1/styles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        name: "章节对话风格",
        guide: { narrative: "N", sentence: "S", imagery: "I", rhythm: "R" },
      }),
    });
    const { style: s } = (await style.json()) as { style: { id: number } };

    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          content: "写一段",
          styleId: s.id,
          skills: ["章节续写"],
        }),
      },
    );
    const text = await res.text();
    expect(text).toContain("[正文参考] 当前章节前文");
    expect(text).toContain("[技能] 章节续写：通读前文与作品设定");
    expect(text).toContain("[风格] 章节对话风格：叙事视角——N");
  });

  it("未安装技能名 → 注入忽略不报错（场景技能外的名字查 skills 表）", async () => {
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "hi", skills: ["不存在的技能"] }),
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("[技能] 不存在的技能");
    expect(text).toContain('"type":"done"');
    const latest = readPayloadObservations()
      .filter((entry) => entry.route === "chapter-chat")
      .at(-1);
    expect(latest?.skill_count).toBe(0);
    expect(latest?.system_sections).not.toContain("skill");
  });

  it("J9 selection 注入：发送时带选区 → mock 回显 [所选片段]；越界/与正文不符 → 400", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "老周蹲下来。他抬头看天。" }),
    });
    const ok = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          content: "改写这段",
          skills: ["章节续写"],
          selection: { start: 0, end: 2, text: "老周" },
        }),
      },
    );
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toContain("[所选片段]");
    expect(text).toContain("老周");
    expect(text).toContain('"type":"done"');

    // 越界
    const bad1 = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "x", selection: { start: 0, end: 999, text: "x" } }),
      },
    );
    expect(bad1.status).toBe(400);
    // 与正文区间不符（防伪造注入）
    const bad2 = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "x", selection: { start: 0, end: 2, text: "不是老周" } }),
      },
    );
    expect(bad2.status).toBe(400);
  });

  it("多轮对话：历史新→旧，第二轮后 4 条消息", async () => {
    // 等待 SSE done（done 在 AI 消息落库后发出）再断言，避免与落库赛跑（A3 确定性修复）
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "第二轮", skills: ["章节续写"] }),
      },
    );
    const done = parseSse(await res.text()).find((e) => e.type === "done");
    expect(done?.messageId).toBeGreaterThan(0);
    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(messages.length).toBeGreaterThanOrEqual(4); // 前一轮 2 + 本轮 2
    expect(messages[0].role).toBe("assistant");
    expect(messages[1].role).toBe("user");
  });

  it("断开请求（abort）→ assistant 候选精确持久化为 stopped", async () => {
    const content = `abort-${RUN}`;
    const controller = new AbortController();
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content, skills: ["章节续写"] }),
        signal: controller.signal,
      },
    );
    controller.abort();
    await res.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const [stopped] = await db
      .select({ status: chapterMessages.status })
      .from(chapterMessages)
      .where(
        and(
          eq(chapterMessages.chapterId, chapterId),
          eq(chapterMessages.userId, userId),
          eq(chapterMessages.role, "assistant"),
          sql`${chapterMessages.id} = (
            select max(id) from chapter_messages
            where chapter_id = ${chapterId} and user_id = ${userId}
          )`,
        ),
      );
    expect(stopped?.status).toBe("stopped");
    // 服务端仍健康
    const after = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "中断后正常请求", skills: [] }),
      },
    );
    expect(after.status).toBe(200);
  });

  it("越权在 provider 调用和候选写入前同步返回 404", async () => {
    // 前一条 abort 测试的服务端流可能仍在完成落库；先等观察流稳定，
    // 再断言本次非 owner 请求没有进入 provider seam。
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = providerCallCount();
    const cross = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: otherCookie },
        body: JSON.stringify({ content: "x" }),
      },
    );
    expect(cross.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(providerCallCount()).toBe(before);
  });

  it("校验：空消息 400 / 缺 chapterId 400 / 未登录 401", async () => {

    const empty = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "  " }),
      },
    );
    expect(empty.status).toBe(400);

    const noId = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "x" }),
    });
    expect(noId.status).toBe(400);

    const anon = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "x" }),
      },
    );
    expect(anon.status).toBe(401);
  });
});

describe("插入与冲突保护（工单 18）", () => {
  /** 走一轮对话拿到服务端候选身份；候选正文必须从服务端读取，不能由客户端伪造。 */
  async function chatAndGetReply(content: string, skills: string[] = ["章节续写"]): Promise<{ id: number; content: string }> {
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content, skills }),
      },
    );
    const text = await res.text();
    const done = text
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()))
      .find((e) => e.type === "done") as { messageId?: number } | undefined;
    if (!done?.messageId) throw new Error(`生成未完成：${text}`);
    const messageId = done.messageId;
    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as { messages: Array<{ id: number; role: string; content: string }> };
    const candidate = messages.find((message) => message.id === messageId && message.role === "assistant");
    expect(candidate).toBeTruthy();
    return { id: messageId, content: candidate!.content };
  }

  async function chatAndGetReplyId(content: string, skills: string[] = ["章节续写"]): Promise<number> {
    return (await chatAndGetReply(content, skills)).id;
  }

  async function chatWithGenerationKey(content: string, generationKey: string) {
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content, skills: ["章节续写"], generationKey }),
      },
    );
    return { response: res, text: await res.text() };
  }

  async function insert(
    messageId: number,
    content: string,
    force = false,
    extra: Record<string, unknown> = {},
  ) {
    return fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages/${messageId}/insert?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content, force, ...extra }),
      },
    );
  }

  async function currentContent(): Promise<string> {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      headers: { cookie },
    });
    const { chapter } = (await res.json()) as { chapter: { content: string } };
    return chapter.content;
  }

  it("插入成功：正文末尾追加 + 消息 inserted（刷新后仍在）", async () => {
    const before = await currentContent();
    const candidate = await chatAndGetReply("插入测试一轮");
    const res = await insert(candidate.id, candidate.content);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      chapter: { content: string };
      message: { inserted: boolean };
    };
    expect(data.chapter.content).toBe(before + "\n\n" + candidate.content.trim());
    expect(data.message.inserted).toBe(true);

    // 刷新（重新 GET 消息）→ inserted 持久
    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as { messages: Array<{ id: number; inserted: boolean }> };
    const target = messages.find((m) => m.id === candidate.id);
    expect(target?.inserted).toBe(true);
  });

  it("插入使用客户端提供的部分编辑，空正文保持 400", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "服务端候选基线" }),
    });
    const candidate = await chatAndGetReply("刷新后确认");
    const partial = candidate.content.trim().slice(0, 12);
    const response = await insert(candidate.id, partial);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { chapter: { content: string } };
    expect(data.chapter.content).toBe(`服务端候选基线\n\n${partial}`);

    const emptyCandidate = await chatAndGetReply("空客户端正文");
    const empty = await insert(emptyCandidate.id, "  ");
    expect(empty.status).toBe(400);
  });

  it("重复确认同一候选 → 400，且不会绕过客户端正文验证", async () => {
    const candidate = await chatAndGetReply("重复插入测试");
    const first = await insert(candidate.id, candidate.content);
    expect(first.status).toBe(200);
    const beforeRetry = await currentContent();
    const again = await insert(candidate.id, "客户端篡改候选");
    expect(again.status).toBe(400);
    expect(await currentContent()).toBe(beforeRetry);
  });

  it("忽略候选持久化且不修改正文", async () => {
    const before = await currentContent();
    const messageId = await chatAndGetReplyId("忽略候选测试");
    const discarded = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages/${messageId}/discard?chapterId=${chapterId}`,
      { method: "POST", headers: { cookie, "Content-Type": "application/json" } },
    );
    expect(discarded.status).toBe(200);
    expect((await discarded.json()) as { status: string }).toMatchObject({ status: "discarded" });
    expect(await currentContent()).toBe(before);

    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as { messages: Array<{ id: number; status: string }> };
    expect(messages.find((m) => m.id === messageId)?.status).toBe("discarded");
  });

  it("generation key 重试复用同一 DB user/candidate 对；内容变化时拒绝复用", async () => {
    const key = `generation-key-${Date.now()}`;
    const first = await chatWithGenerationKey("稳定请求身份", key);
    expect(first.response.status).toBe(200);
    const firstDone = first.text
      .split("\n\n")
      .filter((event) => event.startsWith("data:"))
      .map((event) => JSON.parse(event.slice(5).trim()))
      .find((event) => event.type === "done") as { messageId: number } | undefined;
    expect(firstDone?.messageId).toBeTruthy();
    const firstMessageId = firstDone!.messageId;
    const second = await chatWithGenerationKey("稳定请求身份", key);
    expect(second.text).toContain(`"messageId":${firstMessageId}`);
    const persisted = await db
      .select({ role: chapterMessages.role, generationKey: chapterMessages.generationKey, content: chapterMessages.content })
      .from(chapterMessages)
      .where(and(eq(chapterMessages.chapterId, chapterId), eq(chapterMessages.userId, userId)));
    expect(persisted.filter((row) => row.generationKey === key && row.role === "assistant")).toHaveLength(1);
    expect(persisted.filter((row) => row.role === "user" && row.content === "稳定请求身份")).toHaveLength(1);
    const conflict = await chatWithGenerationKey("篡改同一请求身份", key);
    expect(conflict.text).toContain("GenerationKeyConflict");
  });

  it("并发同 generation key 只持久化一个 DB user/candidate 对", async () => {
    const key = `concurrent-generation-${RUN}`;
    const content = `concurrent generation ${RUN}`;
    const [left, right] = await Promise.all([
      chatWithGenerationKey(content, key),
      chatWithGenerationKey(content, key),
    ]);
    expect([left.text, right.text].filter((text) => text.includes('"type":"done"'))).toHaveLength(1);
    expect([left.text, right.text].filter((text) => text.includes("GenerationInProgress"))).toHaveLength(1);
    const persisted = await db
      .select({ role: chapterMessages.role, generationKey: chapterMessages.generationKey, content: chapterMessages.content })
      .from(chapterMessages)
      .where(and(eq(chapterMessages.chapterId, chapterId), eq(chapterMessages.userId, userId)));
    expect(persisted.filter((row) => row.role === "assistant" && row.generationKey === key)).toHaveLength(1);
    expect(persisted.filter((row) => row.role === "user" && row.content === content)).toHaveLength(1);
  });

  it("stale generating becomes error; only a new key creates the next DB user/candidate pair", async () => {
    const staleKey = `stale-${RUN}`;
    const freshKey = `fresh-${RUN}`;
    const staleContent = `stale request ${RUN}`;
    const freshContent = `fresh request ${RUN}`;
    const first = await chatWithGenerationKey(staleContent, staleKey);
    expect(first.response.status).toBe(200);
    const [stale] = await db
      .select({ id: chapterMessages.id })
      .from(chapterMessages)
      .where(and(eq(chapterMessages.chapterId, chapterId), eq(chapterMessages.generationKey, staleKey)));
    await db
      .update(chapterMessages)
      .set({ status: "generating", updatedAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(chapterMessages.id, stale!.id));

    const sameKey = await chatWithGenerationKey(staleContent, staleKey);
    expect(sameKey.text).toContain("AiGenerationFailed");
    const fresh = await chatWithGenerationKey(freshContent, freshKey);
    expect(fresh.text).toContain('"type":"done"');

    const persisted = await db
      .select({ role: chapterMessages.role, generationKey: chapterMessages.generationKey, content: chapterMessages.content, status: chapterMessages.status })
      .from(chapterMessages)
      .where(and(eq(chapterMessages.chapterId, chapterId), eq(chapterMessages.userId, userId)));
    expect(persisted.filter((row) => row.role === "assistant" && row.generationKey === staleKey)).toEqual([
      expect.objectContaining({ status: "error" }),
    ]);
    expect(persisted.filter((row) => row.role === "assistant" && row.generationKey === freshKey)).toHaveLength(1);
    expect(persisted.filter((row) => row.role === "user" && row.content === staleContent)).toHaveLength(1);
    expect(persisted.filter((row) => row.role === "user" && row.content === freshContent)).toHaveLength(1);
  });

  it("生成期间正文发生变化 → 候选基线冲突；用户确认后 force 应用", async () => {
    const candidate = await chatAndGetReply("候选基线冲突测试");
    // 生成后修改正文：候选 baseRevision 过期，默认确认必须拒绝，不能静默覆盖。
    const patched = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "（用户在生成后手动修改的正文）" }),
      },
    );
    expect(patched.status).toBe(200);
    const res = await insert(candidate.id, candidate.content, false, {
      expectedContent: "（用户在生成后手动修改的正文）",
    });
    expect(res.status).toBe(409);

    const forced = await insert(candidate.id, candidate.content, true, {
      expectedContent: "（用户在生成后手动修改的正文）",
    });
    expect(forced.status).toBe(409);
    const content = await currentContent();
    expect(content).toContain("（用户在生成后手动修改的正文）");
    expect(content).not.toContain("这条基于点击时的正文");
  });

  it("并发确认同一候选 → 只有一次正文变更，失败方不覆盖正文", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "并发确认基线" }),
    });
    const candidate = await chatAndGetReply("并发确认候选");
    const responses = await Promise.all([
      insert(candidate.id, candidate.content),
      insert(candidate.id, candidate.content),
    ]);
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(responses.filter((res) => res.status !== 200).every((res) => [400, 409].includes(res.status))).toBe(true);
    expect((await currentContent())).toBe(`并发确认基线\n\n${candidate.content.trim()}`);
  });

  it("J9 第一层冲突：expectedContent 与当前正文不一致 → 409 ContentChanged；force 跳过", async () => {
    // 构造竞态：客户端点击时正文为 V1，服务端已被另一请求改为 V2
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "V2-服务端已被其他请求修改" }),
    });
    const candidate = await chatAndGetReply("第一层冲突测试");
    const res = await insert(candidate.id, candidate.content, false, {
      expectedContent: "V1-客户端点击时看到的正文",
    });
    expect(res.status).toBe(409);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe("ContentChanged");

    // 用户确认 → force → 跳过内容冲突，但校验不绕过
    const forced = await insert(candidate.id, candidate.content, true, {
      expectedContent: "V1-客户端点击时看到的正文",
    });
    expect(forced.status).toBe(200);
    const content = await currentContent();
    expect(content).toContain("V2-服务端已被其他请求修改");
    expect(content).toContain(candidate.content.trim());
  });

  it("J9 精确插入：position 中间/开头/末尾 splice（无自动分隔符）", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "ABCDEF" }),
    });
    const mid = await chatAndGetReply("中间插入");
    const midRes = await insert(mid.id, mid.content, false, { mode: "insert", position: 3 }); // 显式 mode:"insert" 必须被接受
    expect(midRes.status).toBe(200);
    expect(((await midRes.json()) as { chapter: { content: string } }).chapter.content).toBe(`ABC${mid.content.trim()}DEF`);

    const start = await chatAndGetReply("开头插入");
    const startRes = await insert(start.id, start.content, false, { position: 0 });
    expect(startRes.status).toBe(200);
    expect(((await startRes.json()) as { chapter: { content: string } }).chapter.content).toBe(`${start.content.trim()}ABC${mid.content.trim()}DEF`);

    const end = await chatAndGetReply("末尾插入");
    const endRes = await insert(end.id, end.content, false, { position: `${start.content.trim()}ABC${mid.content.trim()}DEF`.length });
    expect(endRes.status).toBe(200);
    expect(((await endRes.json()) as { chapter: { content: string } }).chapter.content).toBe(`${start.content.trim()}ABC${mid.content.trim()}DEF${end.content.trim()}`);
  });

  it("J9 精确替换：mode=replace 只替换目标区间，前后文不变", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "ABCDEF" }),
    });
    const candidate = await chatAndGetReply("替换测试");
    const res = await insert(candidate.id, candidate.content, false, { mode: "replace", range: { start: 1, end: 3 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chapter: { content: string } }).chapter.content).toBe(`A${candidate.content.trim()}DEF`);
  });

  it("J9 非法 target：负数/越界/NaN/字符串/非整数 position 与 range → 400 且正文不变", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "ABCDEF" }),
    });
    const candidate = await chatAndGetReply("非法 target 测试");
    const bad: Array<Record<string, unknown>> = [
      { position: -1 },
      { position: 7 }, // 越界
      { position: "3" }, // 字符串偷渡
      { position: 1.5 }, // 非整数
      { mode: "replace", range: { start: 3, end: 1 } }, // start > end
      { mode: "replace", range: { start: -1, end: 2 } }, // 负数
      { mode: "replace", range: { start: 0, end: 99 } }, // 越界
      { mode: "replace", range: { start: 0, end: 2.5 } }, // 非整数
      { mode: "weird" }, // 非法 mode
    ];
    for (const extra of bad) {
      const res = await insert(candidate.id, candidate.content, false, extra);
      expect(res.status).toBe(400);
    }
    // force 不绕过 target 校验（用户确认的只是内容冲突，不是非法位置）
    const forcedBad = await insert(candidate.id, candidate.content, true, { position: -5 });
    expect(forcedBad.status).toBe(400);
    expect(await currentContent()).toBe("ABCDEF");
  });

  it("J9 中文/emoji 混排：position 按 UTF-16 code unit 精确插入不错位", async () => {
    // "中文😀ABC" = 中(1)文(1)😀(2 代理对)…：length=7
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "中文😀ABC" }),
    });
    const candidate = await chatAndGetReply("emoji 测试");
    // position=2（"中文"后、emoji 代理对前）→ "中文" + "X" + "😀ABC"
    const res = await insert(candidate.id, candidate.content, false, { position: 2 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chapter: { content: string } }).chapter.content).toBe(`中文${candidate.content.trim()}😀ABC`);
  });

  it("非法入参：空 content 400 / 非 assistant 消息 400 / 消息不存在 400", async () => {
    const messageId = await chatAndGetReplyId("空内容测试");
    const empty = await insert(messageId, "  ");
    expect(empty.status).toBe(400);

    // user 消息 id 不可插入
    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as { messages: Array<{ id: number; role: string }> };
    const userMsg = messages.find((m) => m.role === "user");
    const userInsert = await insert(userMsg!.id, "x");
    expect(userInsert.status).toBe(400);

    const missing = await insert(999999, "x");
    expect(missing.status).toBe(400);
  });

  it("越权/未登录：他人章节插入 404 / 匿名 401", async () => {
    const messageId = await chatAndGetReplyId("越权测试");
    const cross = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages/${messageId}/insert?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: otherCookie },
        body: JSON.stringify({ content: "x" }),
      },
    );
    expect(cross.status).toBe(404);

    const anon = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages/${messageId}/insert?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "x" }),
      },
    );
    expect(anon.status).toBe(401);
  });
});
