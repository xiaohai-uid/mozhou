// 任务门面测试（票 03）：真实 Postgres，场景对应原型 17 断言与 spec §6.3
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { generationJobs, generationSteps, users } from "@/lib/schema";
import {
  appendEvent,
  beginAttempt,
  cancelJob,
  claimNextJob,
  completeStep,
  enqueueJob,
  finalizeCancelled,
  finishJob,
  getJob,
  heartbeatJob,
  readEvents,
  recoverScan,
  requeueDue,
  retryStep,
  settleAttempt,
} from "@/lib/tasks/service";

const EMAIL = "tasks-service-probe@example.com";

describe("任务门面 lib/tasks (DB)", () => {
  let userId = 0;
  beforeEach(async () => {
    // 场景隔离：只清本文件 key 前缀（t-），避免与并行执行的 tasks-worker/tasks-usage-ledger 交叉删除
    await db.delete(generationJobs).where(like(generationJobs.idempotencyKey, "t-%"));
  });
  beforeAll(async () => {
    await db.delete(users).where(like(users.email, "tasks-service-probe%"));
    const [u] = await db.insert(users).values({ email: EMAIL, passwordHash: "x" }).returning({ id: users.id });
    userId = u!.id;
  });
  afterAll(async () => {
    await db.delete(users).where(like(users.email, "tasks-service-probe%"));
  });

  it("enqueue 幂等：并发同 key → 单 job", async () => {
    const input = { userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-enq-1", inputHash: "h1" };
    const [a, b] = await Promise.all([enqueueJob(input), enqueueJob(input)]);
    expect(a.job.jobId).toBe(b.job.jobId);
    expect(a.created !== b.created).toBe(true);
    const all = await db.select().from(generationJobs).where(eq(generationJobs.idempotencyKey, "t-enq-1"));
    expect(all.length).toBe(1);
  });

  it("claim 原子：5 worker 争抢恰好 1 个成功", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-claim-1", inputHash: "h2" });
    const winners = (await Promise.all(["w1", "w2", "w3", "w4", "w5"].map((w) => claimNextJob(w, 30, { idempotencyKeyLike: "t-%" })))).filter(Boolean);
    expect(winners.length).toBe(1);
    expect(winners[0]!.jobId).toBe(job.jobId);
  });

  it("lease 过期 → 崩溃接管", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "deconstruction", idempotencyKey: "t-lease-1", inputHash: "h3" });
    await claimNextJob("workerA", 30, { idempotencyKeyLike: "t-%" });
    await db.execute(`UPDATE generation_jobs SET lease_until = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    const taken = await claimNextJob("workerB", 30, { idempotencyKeyLike: "t-%" });
    expect(taken?.jobId).toBe(job.jobId);
    expect(taken?.owner).toBe("workerB");
  });

  it("cancel → 迟到 finish 0 行，终态保持 cancelled", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-cancel-1", inputHash: "h4" });
    await claimNextJob("workerC", 30, { idempotencyKeyLike: "t-%" });
    await cancelJob(job.jobId);
    const cancelled = await finalizeCancelled(job.jobId, "workerC");
    expect(cancelled?.status).toBe("cancelled");
    const late = await finishJob(job.jobId, "workerC", "succeeded");
    expect(late).toBeNull();
    expect((await getJob(job.jobId))?.status).toBe("cancelled");
  });

  it("queued cancel 直接进入终态，claim 不再接管", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-cancel-queued", inputHash: "h4q" });
    expect((await cancelJob(job.jobId))?.status).toBe("cancelled");
    expect(await claimNextJob("worker-queued", 30, { idempotencyKeyLike: "t-cancel-queued" })).toBeNull();
    expect((await getJob(job.jobId))?.status).toBe("cancelled");
  });

  it("事件 seq 并发单调 + client_key 幂等", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-ev-1", inputHash: "h5" });
    const evs = await Promise.all([
      appendEvent({ jobId: job.jobId, eventType: "phase", payload: { kind: "a" }, clientKey: "ck-a" }),
      appendEvent({ jobId: job.jobId, eventType: "phase", payload: { kind: "b" }, clientKey: "ck-b" }),
      appendEvent({ jobId: job.jobId, eventType: "phase", payload: { kind: "c" }, clientKey: "ck-c" }),
    ]);
    const seqs = evs.map((e) => e.seq).sort((x, y) => x - y);
    expect(seqs).toEqual([1, 2, 3]);
    // 幂等：重复 client_key 返回最初那次事件（并发下 ck-b 的 seq 不保证是中间值，必须按事件自身比对）
    const ckB = evs.find((e) => e.clientKey === "ck-b")!;
    const dup = await appendEvent({ jobId: job.jobId, eventType: "phase", payload: { kind: "b" }, clientKey: "ck-b" });
    expect(dup.seq).toBe(ckB.seq);
    expect((await readEvents(job.jobId, 1)).map((e) => e.seq)).toEqual([2, 3]);
  });

  it("step/attempt：attempt_no 递增、settle 幂等、completeStep 守卫", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-st-1", inputHash: "h6", steps: [{ stepKey: "generate" }] });
    await claimNextJob("workerD", 30, { idempotencyKeyLike: "t-%" });
    const [step] = await db.select().from(generationSteps).where(eq(generationSteps.jobId, job.jobId));
    const a1 = await beginAttempt({ stepId: step!.id, trigger: "initial", provider: "one-api", model: "m" });
    expect(a1.attemptNo).toBe(1);
    const a2 = await beginAttempt({ stepId: step!.id, trigger: "auto_retry", provider: "one-api", model: "m" });
    expect(a2.attemptNo).toBe(2);
    const settled = await settleAttempt({ attemptId: a2.id, status: "succeeded", promptTokens: 10, completionTokens: 5 });
    expect(settled?.status).toBe("succeeded");
    expect(await settleAttempt({ attemptId: a2.id, status: "failed" })).toBeNull(); // 终态幂等
    const done = await completeStep(step!.id, "artifact-x");
    expect(done?.outputArtifactId).toBe("artifact-x");
    expect(await completeStep(step!.id, "artifact-y")).toBeNull(); // 已成功不重复
  });

  it("retryStep 仅未产生结果；已产生结果拒绝", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-rt-1", inputHash: "h7", steps: [{ stepKey: "s1" }, { stepKey: "s2" }] });
    const steps = await db.select().from(generationSteps).where(eq(generationSteps.jobId, job.jobId)).orderBy(generationSteps.ordinal);
    // s1 失败（未产生结果）可重试
    await db.execute(`UPDATE generation_steps SET status = 'failed' WHERE id = ${steps[0]!.id}`);
    await db.execute(`UPDATE generation_jobs SET status = 'failed' WHERE job_id = '${job.jobId}'`);
    const retried = await retryStep(job.jobId, steps[0]!.id);
    expect(retried?.status).toBe("queued");
    // s2 已产生结果 → 拒绝
    await db.execute(`UPDATE generation_steps SET status = 'failed', output_artifact_id = 'x' WHERE id = ${steps[1]!.id}`);
    await db.execute(`UPDATE generation_jobs SET status = 'failed' WHERE job_id = '${job.jobId}'`);
    expect(await retryStep(job.jobId, steps[1]!.id)).toBeNull();
  });

  it("recoverScan：租约过期的 running → waiting_retry → 到期 requeue", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-rec-1", inputHash: "h8" });
    await claimNextJob("workerE", 30, { idempotencyKeyLike: "t-%" });
    await db.execute(`UPDATE generation_jobs SET lease_until = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    const r1 = await recoverScan();
    expect(r1.interrupted).toBeGreaterThanOrEqual(1);
    expect((await getJob(job.jobId))?.status).toBe("waiting_retry");
    // 到期前不重排
    expect((await requeueDue()).requeued).toBeGreaterThanOrEqual(0);
    expect((await getJob(job.jobId))?.status).toBe("waiting_retry");
    // 时间推进到 retry_at 之后 → requeue
    await db.execute(`UPDATE generation_jobs SET retry_at = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    const r2 = await requeueDue();
    expect(r2.requeued).toBeGreaterThanOrEqual(1);
    expect((await getJob(job.jobId))?.status).toBe("queued");
  });

  it("终态守卫：succeeded 后 finish 返回 null", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "t-term-1", inputHash: "h9" });
    await claimNextJob("workerF", 30, { idempotencyKeyLike: "t-%" });
    expect((await finishJob(job.jobId, "workerF", "succeeded"))?.status).toBe("succeeded");
    expect(await finishJob(job.jobId, "workerF", "failed")).toBeNull();
  });
});
