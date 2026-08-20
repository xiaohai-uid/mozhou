// P0-C Retry semantics: retry must reuse the original user message and create
// a new inference attempt, not duplicate the user row.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chapterMessages,
  chapters,
  generationAttempts,
  generationJobs,
  generationSteps,
  novels,
  users,
} from "@/lib/schema";
import { runChapterChat } from "@/lib/novels/chapter-chat";
import { prepareChapterCandidate } from "@/lib/novels/chapter-candidate";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-retry-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-retry-other-${RUN}@example.com`;

let userId = 0;
let novelId = 0;
let chapterId = 0;
let otherUserId = 0;
let otherNovelId = 0;
let otherChapterId = 0;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, passwordHash: "test-only" })
    .returning({ id: users.id });
  userId = user!.id;
  const [novel] = await db
    .insert(novels)
    .values({ userId, name: "Retry语义测试" })
    .returning({ id: novels.id });
  novelId = novel!.id;
  const [chapter] = await db
    .insert(chapters)
    .values({ novelId, ch: "001", title: "第一章", content: "前文" })
    .returning({ id: chapters.id });
  chapterId = chapter!.id;

  const [otherUser] = await db
    .insert(users)
    .values({ email: OTHER_EMAIL, passwordHash: "test-only" })
    .returning({ id: users.id });
  otherUserId = otherUser!.id;
  const [otherNovel] = await db
    .insert(novels)
    .values({ userId, name: "Retry另一本书" })
    .returning({ id: novels.id });
  otherNovelId = otherNovel!.id;
  const [otherChapter] = await db
    .insert(chapters)
    .values({ novelId: otherNovelId, ch: "001", title: "另一章", content: "前文" })
    .returning({ id: chapters.id });
  otherChapterId = otherChapter!.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
});

beforeEach(async () => {
  process.env.CHAT_PROVIDER = "mock";
  await db.delete(chapterMessages).where(eq(chapterMessages.chapterId, chapterId));
  await db.delete(chapterMessages).where(eq(chapterMessages.chapterId, otherChapterId));
});

async function countUserMessages(): Promise<number> {
  const rows = await db
    .select({ id: chapterMessages.id })
    .from(chapterMessages)
    .where(
      and(
        eq(chapterMessages.chapterId, chapterId),
        eq(chapterMessages.userId, userId),
        eq(chapterMessages.role, "user"),
      ),
    );
  return rows.length;
}

async function countAssistantMessages(): Promise<number> {
  const rows = await db
    .select({ id: chapterMessages.id })
    .from(chapterMessages)
    .where(
      and(
        eq(chapterMessages.chapterId, chapterId),
        eq(chapterMessages.userId, userId),
        eq(chapterMessages.role, "assistant"),
      ),
    );
  return rows.length;
}

async function countAttempts(generationIds: string[]): Promise<number> {
  const jobs = await db
    .select({ jobId: generationJobs.jobId })
    .from(generationJobs)
    .where(and(eq(generationJobs.userId, userId), inArray(generationJobs.jobId, generationIds)));
  const jobIds = jobs.map((j) => j.jobId);
  if (jobIds.length === 0) return 0;
  const steps = await db
    .select({ id: generationSteps.id })
    .from(generationSteps)
    .where(inArray(generationSteps.jobId, jobIds));
  const stepIds = steps.map((s) => s.id);
  if (stepIds.length === 0) return 0;
  const attempts = await db
    .select({ id: generationAttempts.id })
    .from(generationAttempts)
    .where(inArray(generationAttempts.stepId, stepIds));
  return attempts.length;
}

describe("chapter retry reuses user message and creates a new attempt", () => {
  it("does not insert a second user row and creates a second assistant/attempt", async () => {
    const first = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "续写这一章",
      onDelta: () => {},
    });
    expect(first.status).toBe("completed_candidate");
    expect(await countUserMessages()).toBe(1);
    expect(await countAssistantMessages()).toBe(1);

    const second = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "续写这一章",
      retryOfGenerationKey: first.generationId,
      onDelta: () => {},
    });
    expect(second.status).toBe("completed_candidate");
    expect(second.generationId).not.toBe(first.generationId);

    expect(await countUserMessages()).toBe(1);
    expect(await countAssistantMessages()).toBe(2);
    expect(await countAttempts([first.generationId, second.generationId])).toBe(2);
  });

  it("cross-user cannot retry another user's generation", async () => {
    const original = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "属于 A 的请求",
      onDelta: () => {},
    });

    await expect(
      prepareChapterCandidate({
        userId: otherUserId,
        novelId,
        chapterId,
        content: "属于 A 的请求",
        skills: [],
        generationKey: "cross-user-retry",
        requestHash: "hash",
        retryOfGenerationKey: original.generationId,
      }),
    ).rejects.toThrow("章节不存在");
  });

  it("cross-novel cannot retry a generation from another chapter", async () => {
    const original = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "属于第一章的请求",
      onDelta: () => {},
    });

    await expect(
      prepareChapterCandidate({
        userId,
        novelId: otherNovelId,
        chapterId: otherChapterId,
        content: "属于第一章的请求",
        skills: [],
        generationKey: "cross-novel-retry",
        requestHash: "hash",
        retryOfGenerationKey: original.generationId,
      }),
    ).rejects.toThrow("原始生成不存在");
  });

  it("invalid retry key is rejected", async () => {
    await expect(
      prepareChapterCandidate({
        userId,
        novelId,
        chapterId,
        content: "任意内容",
        skills: [],
        generationKey: "invalid-retry",
        requestHash: "hash",
        retryOfGenerationKey: "no-such-generation-key",
      }),
    ).rejects.toThrow("原始生成不存在");
  });

  it("rapid double retry with the same new key is idempotent", async () => {
    const original = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "快速双击重试",
      onDelta: () => {},
    });

    const first = await prepareChapterCandidate({
      userId,
      novelId,
      chapterId,
      content: "快速双击重试",
      skills: [],
      generationKey: "double-retry-same-key",
      requestHash: "hash",
      retryOfGenerationKey: original.generationId,
    });
    expect(first.reused).toBe(false);

    const second = await prepareChapterCandidate({
      userId,
      novelId,
      chapterId,
      content: "快速双击重试",
      skills: [],
      generationKey: "double-retry-same-key",
      requestHash: "hash",
      retryOfGenerationKey: original.generationId,
    });
    expect(second.reused).toBe(true);

    expect(await countUserMessages()).toBe(1);
    expect(await countAssistantMessages()).toBe(2); // 原始 + 1 个重试候选
  });

  it("rapid double retry with different keys keeps one user message and creates separate candidates", async () => {
    const original = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "快速两次重试",
      onDelta: () => {},
    });

    await prepareChapterCandidate({
      userId,
      novelId,
      chapterId,
      content: "快速两次重试",
      skills: [],
      generationKey: "double-retry-key-1",
      requestHash: "hash",
      retryOfGenerationKey: original.generationId,
    });
    await prepareChapterCandidate({
      userId,
      novelId,
      chapterId,
      content: "快速两次重试",
      skills: [],
      generationKey: "double-retry-key-2",
      requestHash: "hash",
      retryOfGenerationKey: original.generationId,
    });

    expect(await countUserMessages()).toBe(1);
    expect(await countAssistantMessages()).toBe(3); // 原始 + 2 个重试候选
  });
});
