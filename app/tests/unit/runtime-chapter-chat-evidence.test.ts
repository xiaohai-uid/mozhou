// 章节链路证据（工单 02）：runChapterChat 直调 + mock provider ——
// 放 unit 而非 http：避免共享 observer 文件被额外 chapter-chat 观测污染（既有竞态）。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chapters,
  novelTrackings,
  novels,
  users,
} from "@/lib/schema";
import { runChapterChat } from "@/lib/novels/chapter-chat";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-rt-chapter-${RUN}@example.com`;

let userId = 0;
let novelId = 0;
let chapterId = 0;

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, passwordHash: "test-only" })
    .returning({ id: users.id });
  userId = user!.id;
  const [novel] = await db
    .insert(novels)
    .values({ userId, name: "章节证据测试" })
    .returning({ id: novels.id });
  novelId = novel!.id;
  const [chapter] = await db
    .insert(chapters)
    .values({ novelId, ch: "001", title: "灰烬有籽", content: "前文" })
    .returning({ id: chapters.id });
  chapterId = chapter!.id;
  await db.insert(novelTrackings).values({
    novelId,
    state: {
      statusCard: { currentChapterId: 1, currentChapter: "001", settledChapters: 1, lastSettledAt: null },
      characterStates: [{ name: "阿雀", state: "在场", chapterId: 1 }],
      promises: [{ id: "p1", text: "火苗的秘密", status: "open", chapterId: 1 }],
      timeline: [{ text: "火苗偏转", chapterId: 1, chapter: "001" }],
      readerKnowledge: [{ text: "阿雀知道火苗秘密", chapterId: 1 }],
      chapterRecords: [],
    },
  });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

beforeEach(async () => {
  process.env.CHAT_PROVIDER = "mock";
});

describe("章节链路 SkillRun 证据（工单 02）", () => {
  it("story_grounding + chapter_planning applied；planner 区段进入载荷（mock 回显）", async () => {
    const result = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "续写这一章",
      // DELTA-004：开关型内置技能需显式选中才注入（本用例覆盖全部五技能链路）
      skills: ["章节规划", "读者与题材", "叙事声音"],
      onDelta: () => {},
    });
    expect(result.status).toBe("completed_candidate");
    expect(result.skillRuns.length).toBe(5);
    const sg = result.skillRuns.find((r) => r.skillKey === "story_grounding")!;
    expect(sg.status).toBe("completed");
    expect(sg.evidence).toBe("applied");
    const cp = result.skillRuns.find((r) => r.skillKey === "chapter_planning")!;
    expect(cp.status).toBe("completed");
    expect(cp.evidence).toBe("applied");
    expect(cp.promptSection?.kind).toBe("planner");
    // 工单 03：质量门在生成后运行（候选存在 → completed/applied；不进模型载荷）
    const qg = result.skillRuns.find((r) => r.skillKey === "quality_gate")!;
    expect(qg.status).toBe("completed");
    expect(qg.evidence).toBe("applied");
    expect(qg.promptSection).toBeNull();
    expect(qg.outputRefs[0]!.kind).toBe("check_report");
    // 其余未接入执行器如实 skipped
    const pending = result.skillRuns.filter((r) => ["audience_genre", "narrative_style"].includes(r.skillKey));
    expect(pending.every((r) => r.status === "skipped" && r.reason)).toBe(true);
    // mock 回显 system：owner_context + planner 区段真实进入载荷
    expect(result.reply).toContain("【planner】");
    expect(result.reply).toContain("冲突推进：阿雀：在场");
    expect(result.reply).toContain("【owner_context】");
    expect(result.reply).toContain("[追踪] 角色状态：阿雀——在场");
  });
});
