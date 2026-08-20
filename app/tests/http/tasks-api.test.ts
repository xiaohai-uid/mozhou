// 任务 API 契约测试（票 09）：列表/详情/人工重试/人工结束 + 越权 404
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { generationJobs, users } from "@/lib/schema";
import { enqueueJob, listSteps, claimJob } from "@/lib/tasks/service";

const BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const RUN = Date.now().toString(36);
const EMAIL = `tasks-api-${RUN}@example.com`;
const OTHER_EMAIL = `tasks-api-o-${RUN}@example.com`;
const PASSWORD = "s3cret-测试密码";

interface U { cookie: string; id: number; }
async function register(email: string): Promise<U> {
  const res = await fetch(`${BASE}/api/v1/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(201);
  const token = res.headers.get("set-cookie")!.match(/mozhou_session=([^;]+)/)![1];
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { cookie: `mozhou_session=${token}`, id: row!.id };
}

let me: U;
let other: U;

beforeAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-api-%"));
  me = await register(EMAIL);
  other = await register(OTHER_EMAIL);
});
afterAll(async () => {
  await db.delete(users).where(like(users.email, "tasks-api-%"));
});

describe("任务 API", () => {
  it("列表：owner scope，只返回自己的任务", async () => {
    await enqueueJob({ userId: me.id, novelId: null, operation: "chapter_generation", idempotencyKey: `l1-${RUN}`, inputHash: "h" });
    await enqueueJob({ userId: other.id, novelId: null, operation: "chapter_generation", idempotencyKey: `l2-${RUN}`, inputHash: "h" });
    const res = await fetch(`${BASE}/api/v1/runtime/jobs`, { headers: { cookie: me.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs.length).toBe(1);
    expect(body.jobs[0]!.idempotencyKey).toBe(`l1-${RUN}`);
    // 未登录
    expect((await fetch(`${BASE}/api/v1/runtime/jobs`)).status).toBe(401);
  });

  it("详情：job + steps + attempts + events；越权统一 404", async () => {
    const { job } = await enqueueJob({ userId: me.id, novelId: null, operation: "deconstruction", idempotencyKey: `d1-${RUN}`, inputHash: "h", steps: [{ stepKey: "analyze" }] });
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}`, { headers: { cookie: me.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.id).toBe(job.id);
    expect(body.steps.length).toBe(1);
    expect(body.steps[0]!.stepKey).toBe("analyze");
    expect(Array.isArray(body.attempts)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    // 越权
    const forbidden = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}`, { headers: { cookie: other.cookie } });
    expect(forbidden.status).toBe(404);
  });

  it("人工重试：仅未产生结果的 step；已产生结果 409；越权 404", async () => {
    const { job } = await enqueueJob({ userId: me.id, novelId: null, operation: "chapter_generation", idempotencyKey: `r1-${RUN}`, inputHash: "h", steps: [{ stepKey: "a" }, { stepKey: "b" }] });
    const steps = await listSteps(job.jobId);
    // job 置 failed（带错误类），step b 失败未产生结果 → 可重试
    await db.execute(`UPDATE generation_jobs SET status = 'failed', error_class = 'provider_rate_limit', error_message = '限流' WHERE job_id = '${job.jobId}'`);
    await db.execute(`UPDATE generation_steps SET status = 'failed' WHERE id = ${steps[1]!.id}`);
    const ok = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ stepId: steps[1]!.id }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("queued");
    // 重试后 job 头清空旧错误（新尝试从零开始；旧错误留在 attempts）
    const [after] = await db.select().from(generationJobs).where(eq(generationJobs.jobId, job.jobId));
    expect(after!.errorClass).toBeNull();
    expect(after!.errorMessage).toBeNull();
    // step a 已成功 → 拒绝
    await db.execute(`UPDATE generation_steps SET status = 'succeeded', output_artifact_id = 'x' WHERE id = ${steps[0]!.id}`);
    await db.execute(`UPDATE generation_jobs SET status = 'failed' WHERE job_id = '${job.jobId}'`);
    const denied = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ stepId: steps[0]!.id }),
    });
    expect(denied.status).toBe(409);
    // 越权
    const forbidden = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: other.cookie },
      body: JSON.stringify({ stepId: steps[1]!.id }),
    });
    expect(forbidden.status).toBe(404);
  });

  it("人工结束：running → failed/manual_ended；终态 409", async () => {
    const { job } = await enqueueJob({ userId: me.id, novelId: null, operation: "chapter_generation", idempotencyKey: `e1-${RUN}`, inputHash: "h" });
    await claimJob(job.jobId, "req:test", 30);
    const res = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}/end`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({ reason: "用户放弃" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.errorClass).toBe("manual_ended");
    const again = await fetch(`${BASE}/api/v1/runtime/jobs/${job.jobId}/end`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie: me.cookie },
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);
  });

  it("通用取消：queued 立即终止，running 只发取消请求等待 owner 收口", async () => {
    const queued = await enqueueJob({
      userId: me.id,
      novelId: null,
      operation: "chapter_generation",
      idempotencyKey: `c-queued-${RUN}`,
      inputHash: "h",
    });
    const queuedRes = await fetch(`${BASE}/api/v1/runtime/jobs/${queued.job.jobId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
    });
    expect(queuedRes.status).toBe(200);
    expect(await queuedRes.json()).toMatchObject({ jobId: queued.job.jobId, status: "cancelled" });
    expect((await db.select().from(generationJobs).where(eq(generationJobs.jobId, queued.job.jobId)))[0]!.status).toBe("cancelled");

    const running = await enqueueJob({
      userId: me.id,
      novelId: null,
      operation: "chapter_generation",
      idempotencyKey: `c-running-${RUN}`,
      inputHash: "h",
    });
    await claimJob(running.job.jobId, "cancel-owner", 30);
    const runningRes = await fetch(`${BASE}/api/v1/runtime/jobs/${running.job.jobId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: me.cookie },
    });
    expect(runningRes.status).toBe(200);
    expect(await runningRes.json()).toMatchObject({ jobId: running.job.jobId, status: "running", cancelRequested: true });
  });
});
