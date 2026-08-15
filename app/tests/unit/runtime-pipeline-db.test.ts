// 临时复现：runtime 管线 DB 路径（保留为正式 DB 单测）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { novelTrackings, novels, users } from "@/lib/schema";
import { runRuntimePipeline } from "@/lib/runtime/service";
import { loadBuiltinSkillDefinitions } from "@/lib/runtime/skill-registry";

const EMAIL = "runtime-db-probe@example.com";

describe("runRuntimePipeline (DB)", () => {
  let userId = 0;
  let novelId = 0;
  beforeAll(async () => {
    await db.delete(users).where(like(users.email, "runtime-db-probe%"));
    const [u] = await db.insert(users).values({ email: EMAIL, passwordHash: "x" }).returning({ id: users.id });
    userId = u!.id;
    const [n] = await db.insert(novels).values({ userId, name: "探针作品" }).returning({ id: novels.id });
    novelId = n!.id;
    // 预置追踪状态：让 story_grounding 有真实产物（否则 degraded，另测）
    await db.insert(novelTrackings).values({
      novelId,
      state: {
        statusCard: { currentChapterId: 1, currentChapter: "001", settledChapters: 0, lastSettledAt: null },
        characterStates: [{ name: "阿雀", state: "在场", chapterId: 1 }],
        promises: [{ id: "p1", text: "火苗的秘密", status: "open", chapterId: 1 }],
        timeline: [{ text: "火苗偏转", chapterId: 1, chapter: "001" }],
        readerKnowledge: [{ text: "阿雀知道火苗秘密", chapterId: 1 }],
        chapterRecords: [],
      },
    });
  });
  afterAll(async () => {
    await db.delete(users).where(like(users.email, "runtime-db-probe%"));
  });

  it("管线执行并落库 plan/runs", async () => {
    const definitions = await loadBuiltinSkillDefinitions();
    expect(definitions.length).toBe(5);
    const result = await runRuntimePipeline({
      userId,
      novelId,
      chapterId: null,
      chapterContent: null,
      request: "续写第一章",
      mode: "independent",
      scopeType: "session",
      scopeId: 1,
      definitions,
    });
    expect(result.runs).toHaveLength(5);
    const sg = result.runs.find((r) => r.skillKey === "story_grounding")!;
    expect(sg.status).toBe("completed");
    expect(sg.evidence).toBe("applied");
    // 工单 02：章节规划同样接入（有追踪数据）
    const cp = result.runs.find((r) => r.skillKey === "chapter_planning")!;
    expect(cp.status).toBe("completed");
    expect(cp.evidence).toBe("applied");
    expect(cp.promptSection?.kind).toBe("planner");
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections.some((s) => s.kind === "planner")).toBe(true);
    // 证据落库可查
    const { listSkillRunsByGeneration } = await import("@/lib/runtime/skill-run");
    const persisted = await listSkillRunsByGeneration(result.generationId);
    expect(persisted).toHaveLength(5);
  });
});
