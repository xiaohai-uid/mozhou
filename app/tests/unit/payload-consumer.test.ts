import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  characterEntries,
  chapterMessages,
  chapters,
  messages,
  novels,
  sessions,
  users,
} from "@/lib/schema";
import { runChat, SessionNotFoundError } from "@/lib/chat/service";
import { runChapterChat } from "@/lib/novels/chapter-chat";
import {
  getCapturedChatRequests,
  resetPayloadObservations,
} from "@/lib/chat/payload";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-payload-consumer-${RUN}@example.com`;
const PASSWORD_HASH = "test-only";

let userId = 0;
let otherUserId = 0;
let novelId = 0;
let chapterId = 0;

async function createSession(novelId?: number | null): Promise<number> {
  const [row] = await db
    .insert(sessions)
    .values({ userId: userId, title: "payload consumer test", novelId: novelId ?? null })
    .returning({ id: sessions.id });
  return row!.id;
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, passwordHash: PASSWORD_HASH })
    .returning({ id: users.id });
  userId = user!.id;

  const [otherUser] = await db
    .insert(users)
    .values({ email: `mozhou-payload-consumer-other-${RUN}@example.com`, passwordHash: PASSWORD_HASH })
    .returning({ id: users.id });
  otherUserId = otherUser!.id;

  const [novel] = await db
    .insert(novels)
    .values({ userId, name: "payload consumer novel" })
    .returning({ id: novels.id });
  novelId = novel!.id;

  const [chapter] = await db
    .insert(chapters)
    .values({ novelId, ch: "001", title: "payload consumer chapter", content: "前文" })
    .returning({ id: chapters.id });
  chapterId = chapter!.id;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

beforeEach(async () => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.CHAT_PROVIDER = "mock";
  process.env.CHAT_CAPTURE = "1";
  await db.delete(chapterMessages).where(eq(chapterMessages.chapterId, chapterId));
  await db.delete(characterEntries).where(eq(characterEntries.novelId, novelId));
  await db.delete(novels).where(and(eq(novels.userId, userId), ne(novels.id, novelId)));
  resetPayloadObservations();
});

describe("real chat consumers at the PreparedChatRequest seam", () => {
  it("captures the independent runChat payload, including the current user", async () => {
    const sessionId = await createSession();
    await runChat({
      userId,
      sessionId,
      model: "deepseek-v4-flash",
      content: "独立 consumer 当前请求",
      onDelta: () => {},
    });

    const capture = getCapturedChatRequests()[0];
    expect(capture).toMatchObject({
      messages: [{ role: "user", content: "独立 consumer 当前请求" }],
      observation: {
        route: "chat",
        system_present: true,
        current_user_present: true,
        current_user_occurrences: 1,
        novel_scope_present: false,
        system_sections: ["base_identity", "mode_contract"],
      },
    });
    expect(capture?.system).toContain("墨舟");
    expect(capture?.system).toContain("独立写作对话模式");
  });

  it("closes RAG for an unbound session even when the client supplies a novelId", async () => {
    await db.insert(characterEntries).values({
      novelId,
      name: "未绑定作品人物",
      note: "不应进入独立会话",
    });
    const sessionId = await createSession();

    const result = await runChat({
      userId,
      sessionId,
      model: "deepseek-v4-flash",
      content: "请讨论未绑定作品人物",
      novelId,
      onDelta: () => {},
    });

    expect(result.injected).toEqual([]);
    const capture = getCapturedChatRequests()[0];
    expect(capture?.observation).toMatchObject({
      novel_scope_present: false,
      rag_entry_count: 0,
      owner_scope_resolved: true,
    });
  });

  it("uses the session-bound novel scope instead of a client override", async () => {
    const [otherNovel] = await db
      .insert(novels)
      .values({ userId, name: "bound override novel" })
      .returning({ id: novels.id });
    await db.insert(characterEntries).values([
      { novelId, name: "绑定作品人物", note: "服务端绑定作品" },
      { novelId: otherNovel!.id, name: "覆盖作品人物", note: "客户端不应切换到这里" },
    ]);
    const sessionId = await createSession(novelId);

    const result = await runChat({
      userId,
      sessionId,
      model: "deepseek-v4-flash",
      content: "请讨论绑定作品人物",
      novelId: otherNovel!.id,
      onDelta: () => {},
    });

    expect(result.injected.map((entry) => entry.name)).toContain("绑定作品人物");
    expect(result.injected.map((entry) => entry.name)).not.toContain("覆盖作品人物");
    expect(getCapturedChatRequests()[0]?.observation).toMatchObject({
      novel_scope_present: true,
    });
    expect(getCapturedChatRequests()[0]?.observation.rag_entry_count).toBeGreaterThanOrEqual(1);
  });

  it("rejects a non-owner session before provider consumption", async () => {
    const sessionId = await createSession();

    await expect(
      runChat({
        userId: otherUserId,
        sessionId,
        model: "deepseek-v4-flash",
        content: "越权请求",
        onDelta: () => {},
      }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(getCapturedChatRequests()).toHaveLength(0);
  });

  it("separates the current user from independent history before compression", async () => {
    const sessionId = await createSession();
    await db.insert(messages).values(
      Array.from({ length: 8 }, (_, index) => ({
        sessionId,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `${index}-长历史`.repeat(2000),
      })),
    );

    await runChat({
      userId,
      sessionId,
      model: "deepseek-v4-flash",
      content: "压缩 consumer 当前请求",
      onDelta: () => {},
    });

    const capture = getCapturedChatRequests()[0];
    expect(capture?.observation).toMatchObject({
      route: "chat",
      compression_applied: true,
      current_user_present: true,
      current_user_occurrences: 1,
      history_count_before: 8,
      history_count_after: 7,
    });
    expect(capture?.system).toContain("历史摘要");
    expect(capture?.messages.length).toBe(7);
    expect(capture?.messages.some((message) => message.content.includes("0-长历史"))).toBe(false);
    expect(capture?.messages.some((message) => message.content.includes("1-长历史"))).toBe(false);
    expect(capture?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "压缩 consumer 当前请求",
    });
  });

  it("uses message identity instead of content equality to preserve repeated requests", async () => {
    const sessionId = await createSession();
    await db.insert(messages).values([
      { sessionId, role: "user", content: "重复请求" },
      { sessionId, role: "assistant", content: "历史答复" },
    ]);

    await runChat({
      userId,
      sessionId,
      model: "deepseek-v4-flash",
      content: "重复请求",
      onDelta: () => {},
    });

    const capture = getCapturedChatRequests()[0];
    expect(capture?.messages).toEqual([
      { role: "user", content: "重复请求" },
      { role: "assistant", content: "历史答复" },
      { role: "user", content: "重复请求" },
    ]);
    expect(capture?.observation).toMatchObject({
      current_user_present: true,
      current_user_occurrences: 1,
    });
  });

  it("fails open with the complete history when compression is unavailable", async () => {
    const sessionId = await createSession();
    await db.insert(messages).values(
      Array.from({ length: 8 }, (_, index) => ({
        sessionId,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `${index}-不可压缩历史`.repeat(2000),
      })),
    );

    const originalProvider = process.env.CHAT_PROVIDER;
    const originalFetch = globalThis.fetch;
    process.env.CHAT_PROVIDER = "one-api";
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      if (fetchCount === 1) return new Response(null, { status: 503 });
      return new Response(
        'data: {"choices":[{"delta":{"content":"fail-open reply"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };

    try {
      await runChat({
        userId,
        sessionId,
        model: "deepseek-v4-flash",
        content: "压缩失败仍要保留完整历史",
        onDelta: () => {},
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalProvider === undefined) delete process.env.CHAT_PROVIDER;
      else process.env.CHAT_PROVIDER = originalProvider;
    }

    const capture = getCapturedChatRequests()[0];
    expect(fetchCount).toBe(2);
    expect(capture?.observation).toMatchObject({
      compression_applied: false,
      history_count_before: 8,
      history_count_after: 9,
      current_user_present: true,
      current_user_occurrences: 1,
    });
    expect(capture?.system).not.toContain("历史摘要");
    expect(capture?.messages).toHaveLength(9);
    expect(capture?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "压缩失败仍要保留完整历史",
    });
  });

  it("captures the chapter consumer payload through the same provider seam", async () => {
    await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "章节 consumer 当前请求",
      skills: ["章节续写"],
      onDelta: () => {},
    });

    const capture = getCapturedChatRequests()[0];
    expect(capture).toMatchObject({
      messages: [{ role: "user", content: "章节 consumer 当前请求" }],
      observation: {
        route: "chapter-chat",
        message_count: 1,
        current_user_present: true,
        current_user_occurrences: 1,
        chapter_scope_present: true,
        // V1.3 工单 02：章节规划技能已接入；fixture 无追踪数据 → degraded（无 planner 区段，不伪造）
        system_sections: ["base_identity", "mode_contract", "chapter_reference", "skill"],
      },
    });
    expect(capture?.system).toContain("章节写作对话模式");
    expect(capture?.system).toContain("前文");
  });

  it("normalizes legacy completed chapter history and appends the current user once", async () => {
    const seeded = await db.insert(chapterMessages).values([
      {
        chapterId,
        userId,
        role: "user",
        content: "章节历史问题",
      },
      {
        chapterId,
        userId,
        role: "assistant",
        content: "章节历史分析",
        // Legacy persisted success value; chapter-chat must normalize it before replay.
        status: "done",
      },
    ]).returning({ id: chapterMessages.id });
    expect(seeded).toHaveLength(2);

    await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "章节当前问题",
      onDelta: () => {},
    });

    const capture = getCapturedChatRequests()[0];
    expect(capture?.messages).toEqual([
      { role: "user", content: "章节历史问题" },
      { role: "assistant", content: "章节历史分析" },
      { role: "user", content: "章节当前问题" },
    ]);
    expect(capture?.observation).toMatchObject({
      history_count_before: 2,
      history_count_after: 3,
      current_user_present: true,
      current_user_occurrences: 1,
    });
  });

  it("compresses only old chapter history and keeps the current request last", async () => {
    const seeded = await db.insert(chapterMessages).values(
      Array.from({ length: 8 }, (_, index) => ({
        chapterId,
        userId,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `${index}-章节长历史`.repeat(2000),
      })),
    ).returning({ id: chapterMessages.id });
    expect(seeded).toHaveLength(8);

    await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "章节压缩当前请求",
      onDelta: () => {},
    });

    const capture = getCapturedChatRequests()[0];
    expect(capture?.observation).toMatchObject({
      compression_applied: true,
      history_count_before: 8,
      history_count_after: 7,
      current_user_present: true,
      current_user_occurrences: 1,
    });
    expect(capture?.system).toContain("历史摘要");
    expect(capture?.system).toContain("章节写作对话模式");
    expect(capture?.messages).toHaveLength(7);
    expect(capture?.messages.slice(0, -1)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({
        role: (index + 2) % 2 === 0 ? "user" : "assistant",
        content: `${index + 2}-章节长历史`.repeat(2000),
      })),
    );
    expect(capture?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "章节压缩当前请求",
    });
  });

  it("fails open with complete chapter history when compression is unavailable", async () => {
    const seeded = await db.insert(chapterMessages).values(
      Array.from({ length: 8 }, (_, index) => ({
        chapterId,
        userId,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `${index}-章节不可压缩历史`.repeat(2000),
      })),
    ).returning({ id: chapterMessages.id });
    expect(seeded).toHaveLength(8);

    const originalProvider = process.env.CHAT_PROVIDER;
    const originalFetch = globalThis.fetch;
    process.env.CHAT_PROVIDER = "one-api";
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      if (fetchCount === 1) return new Response(null, { status: 503 });
      return new Response(
        'data: {"choices":[{"delta":{"content":"chapter fail-open reply"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };

    try {
      await runChapterChat({
        userId,
        novelId,
        chapterId,
        model: "deepseek-v4-flash",
        content: "章节压缩失败当前请求",
        onDelta: () => {},
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalProvider === undefined) delete process.env.CHAT_PROVIDER;
      else process.env.CHAT_PROVIDER = originalProvider;
    }

    const capture = getCapturedChatRequests()[0];
    expect(fetchCount).toBe(2);
    expect(capture?.observation).toMatchObject({
      compression_applied: false,
      history_count_before: 8,
      history_count_after: 9,
      current_user_present: true,
      current_user_occurrences: 1,
    });
    expect(capture?.system).not.toContain("历史摘要");
    expect(capture?.messages).toEqual([
      ...Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `${index}-章节不可压缩历史`.repeat(2000),
      })),
      { role: "user", content: "章节压缩失败当前请求" },
    ]);
    expect(capture?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "章节压缩失败当前请求",
    });
  });

});
