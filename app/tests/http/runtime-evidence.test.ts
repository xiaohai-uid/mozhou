// V1.3 工单 01：技能运行时契约测试——done.skillRuns 证据 + 证据端点 + 归属边界
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { novelTrackings, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `mozhou-rt-${RUN}@example.com`;
const OTHER_EMAIL = `mozhou-rt-o-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

interface RunEvent {
  type: string;
  skillRuns?: Array<{
    runId: string;
    skillKey: string;
    status: string;
    evidence: string;
    reason: string | null;
    promptSection: { kind: string; tokens: number } | null;
  }>;
  generationId?: string;
}

let cookie = "";
let otherCookie = "";
let novelId = 0;

async function register(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  return `mozhou_session=${token}`;
}

async function postChat(body: Record<string, unknown>): Promise<RunEvent[]> {
  const res = await fetch(`${BASE}/api/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ model: "deepseek-v4-flash", ...body }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((e) => e.startsWith("data:"))
    .map((e) => JSON.parse(e.slice(5).trim()) as RunEvent);
}

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "mozhou-rt-%"));
  cookie = await register(EMAIL);
  otherCookie = await register(OTHER_EMAIL);
  const novel = await fetch(`${BASE}/api/v1/novels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "运行时证据测试", requestKey: `rt-${RUN}` }),
  });
  const { novel: n } = (await novel.json()) as { novel: { id: number } };
  novelId = n.id;
  // 预置追踪状态：story_grounding 需要真实数据才产生 applied 证据（无数据 = degraded，另测）
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
  await db.delete(users).where(like(users.email, "mozhou-rt-%"));
});

describe("POST /api/v1/chat done 事件携带 SkillRun 证据（契约 Delta 1）", () => {
  it("绑定作品 + 续写 → story_grounding completed/applied，其余技能如实 skipped", async () => {
    const events = await postChat({ content: "续写第一章", novelId });
    const done = events.find((e) => e.type === "done")!;
    expect(done.skillRuns).toBeDefined();
    expect(done.skillRuns!.length).toBe(5);
    const sg = done.skillRuns!.find((r) => r.skillKey === "story_grounding")!;
    expect(sg.status).toBe("completed");
    expect(sg.evidence).toBe("applied");
    expect(sg.promptSection).not.toBeNull();
    expect(sg.promptSection!.kind).toBe("owner_context");
    // 工单 02：章节规划已接入（追踪数据存在 → completed/applied）
    const cp = done.skillRuns!.find((r) => r.skillKey === "chapter_planning")!;
    expect(cp.status).toBe("completed");
    expect(cp.evidence).toBe("applied");
    expect(cp.promptSection?.kind).toBe("planner");
    // 其余三个执行器未接入 → 如实 skipped + 可读原因
    const pending = done.skillRuns!.filter((r) => ["audience_genre", "narrative_style", "quality_gate"].includes(r.skillKey));
    expect(pending.every((r) => r.status === "skipped" && r.evidence === "not_applied" && r.reason)).toBe(true);
    expect(pending.find((r) => r.skillKey === "audience_genre")!.reason).toContain("工单 05");
    expect(done.generationId).toBeTruthy();
  });

  it("未绑定作品 → story_grounding skipped（未绑定作品），不伪造产物", async () => {
    const events = await postChat({ content: "续写一段" });
    const done = events.find((e) => e.type === "done")!;
    const sg = done.skillRuns!.find((r) => r.skillKey === "story_grounding")!;
    expect(sg.status).toBe("skipped");
    expect(sg.reason).toBe("未绑定作品");
    expect(done.skillRuns!.every((r) => r.evidence === "not_applied")).toBe(true);
  });

  it("讨论请求 → 生成链路技能（章节规划/质量门）因不生成正文而 skipped（可读原因）", async () => {
    const events = await postChat({ content: "帮我分析一下主角的性格", novelId });
    const done = events.find((e) => e.type === "done")!;
    const qg = done.skillRuns!.find((r) => r.skillKey === "quality_gate")!;
    expect(qg.status).toBe("skipped");
    expect(qg.reason).toContain("讨论");
    const cp = done.skillRuns!.find((r) => r.skillKey === "chapter_planning")!;
    expect(cp.status).toBe("skipped");
    expect(cp.reason).toContain("讨论");
  });
});

describe("GET /api/v1/runtime/generations/:generationId（证据端点）", () => {
  it("返回 plan + runs + manifest（脱敏：无正文内容）", async () => {
    const events = await postChat({ content: "续写第一章", novelId });
    const done = events.find((e) => e.type === "done")!;
    const generationId = done.generationId!;
    const res = await fetch(`${BASE}/api/v1/runtime/generations/${generationId}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const { evidence } = (await res.json()) as {
      evidence: {
        plan: { generationId: string; plannedSkills: Array<{ skillKey: string }>; route: { phase: string } };
        runs: Array<{ runId: string; skillKey: string; status: string; evidence: string }>;
        manifest: {
          sections: Array<{ kind: string; tokens: number }>;
          skillRuns: Array<{ runId: string; skillKey: string; evidence: string }>;
        };
      };
    };
    expect(evidence.plan.generationId).toBe(generationId);
    expect(evidence.plan.plannedSkills).toHaveLength(5);
    expect(evidence.plan.route.phase).toBe("generation");
    expect(evidence.runs).toHaveLength(5);
    const sgRun = evidence.runs.find((r) => r.skillKey === "story_grounding")!;
    expect(sgRun.evidence).toBe("applied");
    expect(evidence.manifest.sections.some((s) => s.kind === "owner_context")).toBe(true);
    expect(evidence.manifest.skillRuns.length).toBeGreaterThan(0);
    const raw = JSON.stringify(evidence);
    expect(raw).not.toContain("[人物]");
  });

  it("跨用户读取 → 404（归属边界）", async () => {
    const events = await postChat({ content: "续写第一章", novelId });
    const done = events.find((e) => e.type === "done")!;
    const res = await fetch(`${BASE}/api/v1/runtime/generations/${done.generationId}`, {
      headers: { cookie: otherCookie },
    });
    expect(res.status).toBe(404);
  });

  it("未知 generationId → 404", async () => {
    const res = await fetch(`${BASE}/api/v1/runtime/generations/no-such-id`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});
