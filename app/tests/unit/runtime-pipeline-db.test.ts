// 临时复现：runtime 管线 DB 路径（保留为正式 DB 单测）
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { novelTrackings, novels, users } from "@/lib/schema";
import { runPostWriteValidators, runRuntimePipeline } from "@/lib/runtime/service";
import { getRuntimeArtifact } from "@/lib/runtime/artifacts";
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
    // 工单 03：pre-write 阶段 4 个运行行（post_write 归质量门阶段）
    expect(result.runs).toHaveLength(4);
    expect(result.runs.some((r) => r.skillKey === "quality_gate")).toBe(false);
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
    // 工单 03：post_write 质量门（候选存在 → 执行；两组检查分开记录；产物落 runtime_artifacts）
    const postWriteRuns = await runPostWriteValidators({
      userId,
      novelId,
      chapterId: null,
      request: "续写第一章",
      candidate: "火苗在灰罐里静了一会儿。值得注意的是，它没有熄灭。",
      generationId: result.generationId,
      definitions,
    });
    expect(postWriteRuns).toHaveLength(1);
    const qg = postWriteRuns[0]!;
    expect(qg.skillKey).toBe("quality_gate");
    expect(qg.status).toBe("completed");
    expect(qg.evidence).toBe("applied");
    expect(qg.promptSection).toBeNull(); // 校验器不进模型载荷
    expect(qg.outputRefs[0]!.kind).toBe("check_report");
    const artifact = await getRuntimeArtifact(qg.outputRefs[0]!.artifactId);
    expect(artifact).not.toBeNull();
    const report = artifact!.data as {
      consistency: Array<{ name: string; ok: boolean }>;
      aiPattern: Array<{ name: string; ok: boolean }>;
      summary: string;
    };
    expect(report.consistency.length).toBeGreaterThan(0);
    expect(report.aiPattern.length).toBeGreaterThan(0);
    expect(report.summary).toContain("AI 腔套话"); // 候选含「值得注意的是」→ 未通过项出现在摘要
    // 证据落库可查
    const { listSkillRunsByGeneration } = await import("@/lib/runtime/skill-run");
    const persisted = await listSkillRunsByGeneration(result.generationId);
    expect(persisted).toHaveLength(5);
  });
});
