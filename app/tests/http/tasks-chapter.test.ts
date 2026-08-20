// 章节生成接入任务运行时契约测试（票 06）：chat 后 job/attempt/事件落账 + 候选契约不回归
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { generationAttempts, generationEvents, generationJobs, generationSteps, users } from "@/lib/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `tasks-chapter-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

let cookie = "";
let novelId = 0;
let chapterId = 0;
let userId = 0;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-chapter-%"));
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  cookie = `mozhou_session=${token}`;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  userId = user!.id;
  const novel = await fetch(`${BASE}/api/v1/novels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "任务接入测试", requestKey: `tk-${RUN}` }),
  });
  const { novel: n } = (await novel.json()) as { novel: { id: number } };
  novelId = n.id;
  const ch = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ title: "第一章" }),
  });
  const { chapter } = (await ch.json()) as { chapter: { id: number } };
  chapterId = chapter.id;
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-chapter-%"));
});

describe("章节生成 → 任务运行时落账", () => {
  it("章节 chat 后：job 登记 + attempt 结算 + 事件写盘（job_id = generationKey）", async () => {
    // 先写正文：观察者断言要求 chapter_reference 区段（避免跨文件竞态污染既有契约测试）
    await fetch(`${BASE}/api/v1/novels/${novelId}/chapters?chapterId=${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "黄土坡上，老周把锄头抡起来。" }),
    });
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "帮我写第一章开头", skills: ["章节续写"] }),
    });
    expect(res.status).toBe(200);
    const sse = await res.text();
    const sseEvents = sse
      .split("\n\n")
      .filter((e) => e.startsWith("data:"))
      .map((e) => JSON.parse(e.slice(5).trim()));
    const done = sseEvents.find((e: { type?: string }) => e.type === "done");
    expect(done).toBeTruthy();
    const generationKey = (done as { generationId?: string }).generationId as string;
    expect(generationKey).toBeTruthy();

    const [job] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.jobId, generationKey));
    expect(job).toBeTruthy();
    expect(job!.operation).toBe("chapter_generation");
    expect(job!.userId).toBe(userId);
    expect(job!.novelId).toBe(novelId);
    expect(job!.chapterId).toBe(chapterId);
    expect(job!.status).toBe("succeeded");

    const stepRows = await db
      .select({ id: generationSteps.id })
      .from(generationSteps)
      .where(eq(generationSteps.jobId, generationKey));
    const attempts = stepRows.length > 0
      ? await db
          .select()
          .from(generationAttempts)
          .where(inArray(generationAttempts.stepId, stepRows.map((r) => r.id)))
      : [];
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0]!.status).toBe("succeeded");

    const events = await db
      .select()
      .from(generationEvents)
      .where(eq(generationEvents.jobId, generationKey))
      .orderBy(generationEvents.seq);
    const kinds = events.map((e) => e.clientKey);
    expect(kinds).toContain("prepared");
    expect(kinds).toContain("streaming");
    expect(kinds).toContain("settled");
    // 事件 payload 无正文内容（白名单）
    expect(events.some((e) => JSON.stringify(e.payload).includes("帮我写第一章"))).toBe(false);
  });

  it("同 generationKey 重发：job 不重复（幂等）", async () => {
    const res = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "再写一段", generationKey: `reuse-${RUN}` }),
    });
    expect(res.status).toBe(200);
    const again = await fetch(`${BASE}/api/v1/novels/${novelId}/chapters/chat?chapterId=${chapterId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ content: "再写一段", generationKey: `reuse-${RUN}` }),
    });
    expect(again.status).toBe(200);
    // 短轮询吸收服务端异步落账（跨文件并发时避免时序闪断）
    let jobs: typeof generationJobs.$inferSelect[] = [];
    for (let i = 0; i < 10 && jobs.length === 0; i++) {
      jobs = await db.select().from(generationJobs).where(eq(generationJobs.idempotencyKey, `reuse-${RUN}`));
      if (jobs.length === 0) await new Promise((r) => setTimeout(r, 300));
    }
    expect(jobs.length).toBe(1);
  });
});
