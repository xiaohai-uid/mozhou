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
    expect(messages[0].status).toBe("done");
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

  it("断开请求（abort）→ 服务端不崩，消息落库状态为 done 或 stopped", async () => {
    const controller = new AbortController();
    const res = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "会被中断的一条", skills: ["章节续写"] }),
        signal: controller.signal,
      },
    );
    controller.abort();
    await res.body?.cancel().catch(() => {});
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

  it("越权/校验：他人章节 404 / 空消息 400 / 缺 chapterId 400 / 未登录 401", async () => {
    const cross = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: otherCookie },
        body: JSON.stringify({ content: "x" }),
      },
    );
    expect(cross.status).toBe(404);

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
  /** 走一轮对话拿到 assistant messageId */
  async function chatAndGetReplyId(content: string, skills: string[] = ["章节续写"]): Promise<number> {
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
      .find((e) => e.type === "done") as { messageId?: number };
    return done.messageId!;
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
    const messageId = await chatAndGetReplyId("插入测试一轮");
    const insertedText = "（插入测试：翻不死。老周把碗搁下。）";
    const res = await insert(messageId, insertedText);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      chapter: { content: string };
      message: { inserted: boolean };
    };
    expect(data.chapter.content).toBe(before + "\n\n" + insertedText);
    expect(data.message.inserted).toBe(true);

    // 刷新（重新 GET 消息）→ inserted 持久
    const list = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters/messages?chapterId=${chapterId}`,
      { headers: { cookie } },
    );
    const { messages } = (await list.json()) as { messages: Array<{ id: number; inserted: boolean }> };
    const target = messages.find((m) => m.id === messageId);
    expect(target?.inserted).toBe(true);
  });

  it("重复插入同一条 → 400", async () => {
    const messageId = await chatAndGetReplyId("重复插入测试");
    await insert(messageId, "第一次插入");
    const again = await insert(messageId, "第二次插入");
    expect(again.status).toBe(400);
    const { error } = (await again.json()) as { error: string };
    expect(error).toContain("已插入");
  });

  it("J9 收紧：生成期间整章变化不再必然 409（点击时正文已保存则照常插入）", async () => {
    const messageId = await chatAndGetReplyId("J9 收紧测试");
    // 生成后修改正文（J7 旧语义：快照不一致 → 409；J9 新语义：插入以点击时已保存正文为准，expectedContent 比对）
    const patched = await fetch(
      `${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ content: "（用户在生成后手动修改的正文）" }),
      },
    );
    expect(patched.status).toBe(200);
    // 客户端已把修改落盘 → expectedContent 与当前一致 → 插入成功，用户内容不丢
    const res = await insert(messageId, "这条基于点击时的正文", false, {
      expectedContent: "（用户在生成后手动修改的正文）",
    });
    expect(res.status).toBe(200);
    const content = await currentContent();
    expect(content).toContain("（用户在生成后手动修改的正文）");
    expect(content).toContain("这条基于点击时的正文");
  });

  it("J9 第一层冲突：expectedContent 与当前正文不一致 → 409 ContentChanged；force 跳过", async () => {
    // 构造竞态：客户端点击时正文为 V1，服务端已被另一请求改为 V2
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "V2-服务端已被其他请求修改" }),
    });
    const messageId = await chatAndGetReplyId("第一层冲突测试");
    const res = await insert(messageId, "客户端旧版插入", false, {
      expectedContent: "V1-客户端点击时看到的正文",
    });
    expect(res.status).toBe(409);
    const data = (await res.json()) as { code?: string };
    expect(data.code).toBe("ContentChanged");

    // 用户确认 → force → 跳过内容冲突，但校验不绕过
    const forced = await insert(messageId, "客户端旧版插入", true, {
      expectedContent: "V1-客户端点击时看到的正文",
    });
    expect(forced.status).toBe(200);
    const content = await currentContent();
    expect(content).toContain("V2-服务端已被其他请求修改");
    expect(content).toContain("客户端旧版插入");
  });

  it("J9 精确插入：position 中间/开头/末尾 splice（无自动分隔符）", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "ABCDEF" }),
    });
    const mid = await chatAndGetReplyId("中间插入");
    const midRes = await insert(mid, "XY", false, { mode: "insert", position: 3 }); // 显式 mode:"insert" 必须被接受
    expect(midRes.status).toBe(200);
    expect(((await midRes.json()) as { chapter: { content: string } }).chapter.content).toBe("ABCXYDEF");

    const start = await chatAndGetReplyId("开头插入");
    const startRes = await insert(start, "Z", false, { position: 0 });
    expect(startRes.status).toBe(200);
    expect(((await startRes.json()) as { chapter: { content: string } }).chapter.content).toBe("ZABCXYDEF");

    const end = await chatAndGetReplyId("末尾插入");
    const endRes = await insert(end, "W", false, { position: 9 });
    expect(endRes.status).toBe(200);
    expect(((await endRes.json()) as { chapter: { content: string } }).chapter.content).toBe("ZABCXYDEFW");
  });

  it("J9 精确替换：mode=replace 只替换目标区间，前后文不变", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "ABCDEF" }),
    });
    const messageId = await chatAndGetReplyId("替换测试");
    const res = await insert(messageId, "XY", false, { mode: "replace", range: { start: 1, end: 3 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chapter: { content: string } }).chapter.content).toBe("AXYDEF");
  });

  it("J9 非法 target：负数/越界/NaN/字符串/非整数 position 与 range → 400 且正文不变", async () => {
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "ABCDEF" }),
    });
    const messageId = await chatAndGetReplyId("非法 target 测试");
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
      const res = await insert(messageId, "X", false, extra);
      expect(res.status).toBe(400);
    }
    expect(await currentContent()).toBe("ABCDEF");
  });

  it("J9 中文/emoji 混排：position 按 UTF-16 code unit 精确插入不错位", async () => {
    // "中文😀ABC" = 中(1)文(1)😀(2 代理对)…：length=7
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "中文😀ABC" }),
    });
    const messageId = await chatAndGetReplyId("emoji 测试");
    // position=2（"中文"后、emoji 代理对前）→ "中文" + "X" + "😀ABC"
    const res = await insert(messageId, "X", false, { position: 2 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chapter: { content: string } }).chapter.content).toBe("中文X😀ABC");
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
