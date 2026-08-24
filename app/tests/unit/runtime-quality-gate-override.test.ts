// code-review 修复轮：质量门接入候选确认路径（覆盖动作入证据 + 消息摘要）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, novels, users } from "@/lib/schema";
import {
  insertChapterMessage,
  listChapterMessages,
  recordQualityGateOverride,
  runChapterChat,
} from "@/lib/novels/chapter-chat";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-qg-${RUN}@example.com`;

let userId = 0;
let novelId = 0;
let chapterId = 0;

beforeAll(async () => {
  const [user] = await db.insert(users).values({ email: EMAIL, passwordHash: "test-only" }).returning({ id: users.id });
  userId = user!.id;
  const [novel] = await db.insert(novels).values({ userId, name: "质量门覆盖测试" }).returning({ id: novels.id });
  novelId = novel!.id;
  const [chapter] = await db.insert(chapters).values({ novelId, ch: "001", title: "第一章", content: "前文" }).returning({ id: chapters.id });
  chapterId = chapter!.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

beforeEach(async () => {
  process.env.CHAT_PROVIDER = "mock";
});

describe("质量门候选确认路径（code-review 修复）", () => {
  it("候选含未通过检查项 → 消息列表带 qualityGate 摘要；确认插入 → 覆盖动作入证据", async () => {
    // mock 回显含「值得注意的是」→ AI 味检查组未通过
    const result = await runChapterChat({
      userId,
      novelId,
      chapterId,
      model: "deepseek-v4-flash",
      content: "续写这一章",
      onDelta: () => {},
    });
    expect(result.status).toBe("completed_candidate");
    const qg = result.skillRuns.find((r) => r.skillKey === "quality_gate")!;
    expect(qg.status).toBe("completed");
    // 消息列表携带摘要
    const messages = await listChapterMessages(userId, novelId, chapterId);
    const assistant = messages!.find((m) => m.id === result.messageId)!;
    expect(assistant.qualityGate).toBeTruthy();
    expect(assistant.qualityGate).toContain("未通过");
    // 覆盖动作入证据
    const override = await recordQualityGateOverride(chapterId, result.messageId);
    expect(override.overridden).toBe(true);
    expect(override.summary).toContain("未通过");
    const { listSkillRunsByGeneration } = await import("@/lib/runtime/skill-run");
    const runs = await listSkillRunsByGeneration(result.generationId);
    const gateRun = runs.find((r) => r.skillKey === "quality_gate")!;
    expect(gateRun.reason).toContain("覆盖动作已记录");
  });

  it("无质量门证据的候选（不存在消息）→ 不产生覆盖记录", async () => {
    const override = await recordQualityGateOverride(chapterId, 999_999_999);
    expect(override.summary).toBeNull();
    expect(override.overridden).toBe(false);
    void insertChapterMessage;
  });
});
