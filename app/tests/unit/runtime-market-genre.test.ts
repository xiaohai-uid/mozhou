// MarketBrief 绑定 → audience_genre 消费链路（DB：runChat 直调 + mock provider）
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { novels, rankingSnapshots, sessions, users } from "@/lib/schema";
import { runChat } from "@/lib/chat/service";
import { bindMarketBriefing, createMarketBriefing } from "@/lib/market/briefing-artifacts";

const RUN = Date.now().toString(36);
const EMAIL = `mozhou-mkt-${RUN}@example.com`;

let userId = 0;
let novelId = 0;
let briefingId = "";

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, passwordHash: "test-only" })
    .returning({ id: users.id });
  userId = user!.id;
  const [novel] = await db
    .insert(novels)
    .values({ userId, name: "市场参照测试" })
    .returning({ id: novels.id });
  novelId = novel!.id;
  // 种子快照 → 简报
  const captured = new Date();
  await db.insert(rankingSnapshots).values([
    { boardId: "test-board", bookId: "t1", name: "灰烬纪元", author: "A", category: "科幻末世", rank: 1, capturedAt: captured },
    { boardId: "test-board", bookId: "t2", name: "都市夜行", author: "B", category: "都市", rank: 2, capturedAt: captured },
    { boardId: "test-board", bookId: "t3", name: "火苗偏转", author: "C", category: "科幻末世", rank: 3, capturedAt: captured },
  ]);
  const created = await createMarketBriefing();
  expect(created).not.toBeNull();
  briefingId = created!.artifactId;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

beforeEach(async () => {
  process.env.CHAT_PROVIDER = "mock";
});

describe("MarketBrief 绑定与消费（工单 05）", () => {
  it("未绑定 → audience_genre skipped「未绑定市场简报」", async () => {
    const [session] = await db.insert(sessions).values({ userId, novelId }).returning({ id: sessions.id });
    const result = await runChat({
      userId,
      sessionId: session!.id,
      model: "deepseek-v4-flash",
      content: "续写第一章",
      skills: ["读者与题材"],
      onDelta: () => {},
    });
    const ag = result.skillRuns.find((r) => r.skillKey === "audience_genre")!;
    expect(ag.status).toBe("skipped");
    expect(ag.reason).toBe("未绑定市场简报");
    expect(result.reply).not.toContain("【market】");
  });

  it("绑定后 → audience_genre completed/applied + market 区段进入载荷（带版本与来源）", async () => {
    expect(await bindMarketBriefing({ userId, novelId, artifactId: briefingId })).toBe(true);
    const [session] = await db.insert(sessions).values({ userId, novelId }).returning({ id: sessions.id });
    const result = await runChat({
      userId,
      sessionId: session!.id,
      model: "deepseek-v4-flash",
      content: "续写第一章",
      skills: ["读者与题材"],
      onDelta: () => {},
    });
    const ag = result.skillRuns.find((r) => r.skillKey === "audience_genre")!;
    expect(ag.status).toBe("completed");
    expect(ag.evidence).toBe("applied");
    expect(ag.promptSection?.kind).toBe("market");
    expect(result.reply).toContain("【market】");
    expect(result.reply).toContain("题材期待");
  });
});
