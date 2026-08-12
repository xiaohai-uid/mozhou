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

    expect(getCapturedChatRequests()).toMatchObject([
      {
        system: "",
        messages: [{ role: "user", content: "独立 consumer 当前请求" }],
        observation: {
          route: "chat",
          system_present: false,
          current_user_present: true,
          current_user_occurrences: 1,
        },
      },
    ]);
  });

  it("captures the real compression consumer state without fixing its known history behavior", async () => {
    const sessionId = await createSession();
    await db.insert(messages).values(
      Array.from({ length: 6 }, (_, index) => ({
        sessionId,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: "长历史".repeat(2000),
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
      // 01 records the current implementation: kept history is not yet wired in.
      history_count_after: capture?.observation.history_count_before,
    });
    expect(capture?.system).toContain("历史摘要");
    expect(capture?.messages.length).toBe(capture?.observation.history_count_before);
    expect(capture?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "压缩 consumer 当前请求",
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

    expect(getCapturedChatRequests()).toMatchObject([
      {
        messages: [],
        observation: {
          route: "chapter-chat",
          message_count: 0,
          current_user_present: false,
          chapter_scope_present: true,
        },
      },
    ]);
  });
});
