import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapterMessages, chapters, messages, novels, sessions, users } from "@/lib/schema";
import { runChat } from "@/lib/chat/service";
import { runChapterChat } from "@/lib/novels/chapter-chat";
import {
  getCapturedChatRequests,
  resetPayloadObservations,
} from "@/lib/chat/payload";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-payload-consumer-${RUN}@example.com`;
const PASSWORD_HASH = "test-only";

let userId = 0;
let novelId = 0;
let chapterId = 0;

async function createSession(): Promise<number> {
  const [row] = await db
    .insert(sessions)
    .values({ userId: userId, title: "payload consumer test" })
    .returning({ id: sessions.id });
  return row!.id;
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, passwordHash: PASSWORD_HASH })
    .returning({ id: users.id });
  userId = user!.id;

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
  await db.delete(users).where(eq(users.id, userId));
});

beforeEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  process.env.CHAT_PROVIDER = "mock";
  process.env.CHAT_CAPTURE = "1";
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
      messages: [],
      observation: {
        route: "chapter-chat",
        message_count: 0,
        current_user_present: false,
        chapter_scope_present: true,
      },
    });
  });
});
