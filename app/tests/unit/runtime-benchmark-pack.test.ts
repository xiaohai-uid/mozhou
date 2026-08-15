// BenchmarkPack（工单 06）：拆解运行 → 方法包绑定 → chapter_planning 消费（inputRefs + 方法参考）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, deconstructionRuns, novelTrackings, novels, users } from "@/lib/schema";
import { runChapterChat } from "@/lib/novels/chapter-chat";
import { createBenchmarkPack } from "@/lib/story/benchmark-packs";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-bp-${RUN}@example.com`;

let userId = 0;
let novelId = 0;
let chapterId = 0;
let runId = 0;

const minimalResult = {
  mode: "long" as const,
  structure: [],
  plot: [],
  rhythm: [],
  stages: [
    { stage: 0, name: "s0", status: "completed" as const, artifact: { id: "a0", kind: "k", schemaVersion: 1, premise: "灰烬中的火苗", chapterCount: 1, chapterIndex: [] } },
    { stage: 2, name: "s2", status: "completed" as const, artifact: { id: "a2", kind: "k", schemaVersion: 1, chapters: [] } },
    { stage: 3, name: "s3", status: "completed" as const, artifact: { id: "a3", kind: "k", schemaVersion: 1, mainline: "M", subplots: [], units: [], foreshadowing: [], emotionCurve: [], coverage: [] } },
    { stage: 4, name: "s4", status: "completed" as const, artifact: { id: "a4", kind: "k", schemaVersion: 1, characters: [], worldview: {}, factions: [], relationships: [] } },
    { stage: 6, name: "s6", status: "completed" as const, artifact: { id: "a6", kind: "k", schemaVersion: 1, sentence: "S", rhythm: "R", dialogue: "D", emotion: "E", techniques: ["信息差悬念", "章尾钩子"] } },
  ],
  quality: { sourceLength: 100, chapterCount: 1, completedStages: [0, 2, 3, 4, 6], warnings: [] },
};

beforeAll(async () => {
  const [user] = await db.insert(users).values({ email: EMAIL, passwordHash: "test-only" }).returning({ id: users.id });
  userId = user!.id;
  const [novel] = await db.insert(novels).values({ userId, name: "方法包测试" }).returning({ id: novels.id });
  novelId = novel!.id;
  const [chapter] = await db.insert(chapters).values({ novelId, ch: "001", title: "第一章", content: "前文" }).returning({ id: chapters.id });
  chapterId = chapter!.id;
  await db.insert(novelTrackings).values({
    novelId,
    state: {
      statusCard: { currentChapterId: 1, currentChapter: "001", settledChapters: 1, lastSettledAt: null },
      characterStates: [{ name: "阿雀", state: "在场", chapterId: 1 }],
      promises: [{ id: "p1", text: "火苗的秘密", status: "open", chapterId: 1 }],
      timeline: [],
      readerKnowledge: [],
      chapterRecords: [],
    },
  });
  const [run] = await db.insert(deconstructionRuns).values({
    userId,
    title: "方法包源",
    sourceHash: "hash",
    sourceLength: 100,
    requestKey: `bp-${RUN}`,
    status: "completed",
    result: minimalResult as never,
  }).returning({ id: deconstructionRuns.id });
  runId = run!.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

beforeEach(async () => {
  process.env.CHAT_PROVIDER = "mock";
});

describe("BenchmarkPack（工单 06）", () => {
  it("创建并绑定 → 章节对话 chapter_planning 消费（inputRefs + 方法参考进入任务卡）", async () => {
    const created = await createBenchmarkPack({ userId, novelId, runId });
    expect(created).not.toBeNull();
    expect(created!.version).toMatch(/^v\d+$/);
    const result = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "续写这一章",
      onDelta: () => {},
    });
    const cp = result.skillRuns.find((r) => r.skillKey === "chapter_planning")!;
    expect(cp.status).toBe("completed");
    expect(cp.evidence).toBe("applied");
    expect(cp.inputRefs.some((ref) => ref.kind === "benchmark_pack")).toBe(true);
    expect(cp.inputRefs[0]!.artifactId).toBe(created!.artifactId);
    expect(result.reply).toContain("方法参考（BenchmarkPack）：信息差悬念；章尾钩子");
  });
});
