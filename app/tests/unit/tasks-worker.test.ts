// worker 循环测试（票 04）：claim→step→finish、失败中止、取消观察、崩溃恢复
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { generationAttempts, generationJobs, generationSteps, users } from "@/lib/schema";
import { TaskWorker } from "@/lib/tasks/worker";
import { enqueueJob, getJob, listSteps, recoverScan, requeueDue, retryStep } from "@/lib/tasks/service";

const EMAIL = "tasks-worker-probe@example.com";

describe("任务 worker (票 04)", () => {
  let userId = 0;
  beforeAll(async () => {
    await db.delete(users).where(like(users.email, "tasks-worker-probe%"));
    const [u] = await db.insert(users).values({ email: EMAIL, passwordHash: "x" }).returning({ id: users.id });
    userId = u!.id;
  });
  afterAll(async () => {
    await db.delete(users).where(like(users.email, "tasks-worker-probe%"));
  });
  beforeEach(async () => {
    // 只清本文件 key 前缀（w）
    await db.delete(generationJobs).where(like(generationJobs.idempotencyKey, "w%"));
  });

  it("全成功：job → succeeded，attempt/step 落账", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w1", inputHash: "h", steps: [{ stepKey: "plan" }, { stepKey: "write" }] });
    const w = new TaskWorker("w-A", { claimFilter: { idempotencyKeyLike: "w%" } });
    const r = await w.runOnce(async ({ step }) => {
      expect(step.stepKey).toBeTruthy();
      return { status: "succeeded", usage: { promptTokens: 10, completionTokens: 5 } };
    });
    expect(r.finalStatus).toBe("succeeded");
    const steps = await listSteps(job.jobId);
    expect(steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(steps[0]!.attemptCount).toBe(1);
    expect(await getJob(job.jobId)).toMatchObject({
      executionCheckpoint: { stepKey: "write" },
    });
  });

  it("中间失败：step1 成功 step2 失败 → job failed + errorClass，step1 不重放", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w2", inputHash: "h", steps: [{ stepKey: "a" }, { stepKey: "b" }] });
    const w = new TaskWorker("w-B", { claimFilter: { idempotencyKeyLike: "w%" } });
    let calls = 0;
    const r = await w.runOnce(async ({ step }) => {
      calls += 1;
      if (step.stepKey === "b") return { status: "failed", errorClass: "provider_rate_limit" };
      return { status: "succeeded" };
    });
    expect(r.finalStatus).toBe("failed");
    expect((await getJob(job.jobId))?.errorClass).toBe("provider_rate_limit");
    const steps = await listSteps(job.jobId);
    expect(steps[0]!.status).toBe("succeeded");
    expect(steps[1]!.status).toBe("failed");
    expect(calls).toBe(2);
  });

  it("取消观察：step 边界检测 cancel_requested → finalizeCancelled", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w3", inputHash: "h", steps: [{ stepKey: "a" }, { stepKey: "b" }] });
    const w = new TaskWorker("w-C", { claimFilter: { idempotencyKeyLike: "w%" } });
    let stepNo = 0;
    const r = await w.runOnce(async ({ step }) => {
      stepNo += 1;
      if (stepNo === 1) {
        // 第一次 handler 期间用户取消
        await db.execute(`UPDATE generation_jobs SET cancel_requested = true WHERE job_id = '${job.jobId}'`);
      }
      return { status: "succeeded" };
    });
    expect(r.finalStatus).toBe("cancelled");
    expect((await getJob(job.jobId))?.status).toBe("cancelled");
  });

  it("handler 返回迟到成功时，取消优先于结果，step/attempt 不得成功", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w-cancel-late", inputHash: "h", steps: [{ stepKey: "a" }] });
    const w = new TaskWorker("w-cancel-late", { claimFilter: { idempotencyKeyLike: "w%" } });
    const r = await w.runOnce(async () => {
      await db.execute(`UPDATE generation_jobs SET cancel_requested = true WHERE job_id = '${job.jobId}'`);
      return { status: "succeeded" };
    });
    expect(r.finalStatus).toBe("cancelled");
    expect((await getJob(job.jobId))?.status).toBe("cancelled");
    expect((await listSteps(job.jobId))[0]!.status).not.toBe("succeeded");
    const attempts = await db
      .select({ status: generationAttempts.status })
      .from(generationAttempts)
      .where(eq(generationAttempts.stepId, (await listSteps(job.jobId))[0]!.id));
    expect(attempts).toEqual([{ status: "cancelled" }]);
  });

  it("崩溃恢复：worker 半途崩溃 → recoverScan+requeue → 新 worker 从失败 step 继续", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w4", inputHash: "h", steps: [{ stepKey: "a" }, { stepKey: "b" }, { stepKey: "c" }] });
    // worker1 只完成 step a 然后"崩溃"（不 finish）
    const w1 = new TaskWorker("w-D", { heartbeatMs: 0, claimFilter: { idempotencyKeyLike: "w%" } });
    let firstRun = true;
    await w1.runOnce(async ({ step, attempt }) => {
      if (step.stepKey === "b") {
        if (firstRun) {
          firstRun = false;
          // 模拟崩溃：直接抛错且不写终态（handler 抛错 → runOnce 不 finish）
          throw new Error("simulated crash");
        }
      }
      return { status: "succeeded" };
    }).catch(() => {});
    // 租约过期 → 恢复扫描
    await db.execute(`UPDATE generation_jobs SET lease_until = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    await recoverScan();
    // 手动把 retry_at 置过去并 requeue
    await db.execute(`UPDATE generation_jobs SET retry_at = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    await requeueDue();
    expect((await getJob(job.jobId))?.status).toBe("queued");
    // worker2 接手：step a 不重放，从 b 继续
    const w2 = new TaskWorker("w-E", { claimFilter: { idempotencyKeyLike: "w%" } });
    const r2 = await w2.runOnce(async ({ step }) => ({ status: "succeeded" }));
    expect(r2.finalStatus).toBe("succeeded");
    const steps = await listSteps(job.jobId);
    expect(steps.every((s) => s.status === "succeeded")).toBe(true);
    expect(steps[0]!.attemptCount).toBe(1); // step a 只跑过一次
  });

  it("租约接管后旧 handler 迟到返回不结算，恢复 worker 创建新 Attempt", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w-stale", inputHash: "h", steps: [{ stepKey: "a" }] });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const oldWorker = new TaskWorker("w-stale-old", { claimFilter: { idempotencyKeyLike: "w%" } });
    const oldRun = oldWorker.runOnce(async () => {
      started();
      await releasePromise;
      return { status: "succeeded" };
    });
    await startedPromise;
    await db.execute(`UPDATE generation_jobs SET lease_until = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    expect((await recoverScan()).interrupted).toBeGreaterThanOrEqual(1);
    await db.execute(`UPDATE generation_jobs SET retry_at = now() - interval '1 second' WHERE job_id = '${job.jobId}'`);
    expect((await requeueDue()).requeued).toBeGreaterThanOrEqual(1);

    const newWorker = new TaskWorker("w-stale-new", { claimFilter: { idempotencyKeyLike: "w%" } });
    expect((await newWorker.runOnce(async () => ({ status: "succeeded" }))).finalStatus).toBe("succeeded");
    release();
    await oldRun;

    const attempts = await db
      .select({ attemptNo: generationAttempts.attemptNo, status: generationAttempts.status, trigger: generationAttempts.trigger })
      .from(generationAttempts)
      .where(eq(generationAttempts.stepId, (await listSteps(job.jobId))[0]!.id))
      .orderBy(generationAttempts.attemptNo);
    expect(attempts).toEqual([
      { attemptNo: 1, status: "failed", trigger: "initial" },
      { attemptNo: 2, status: "succeeded", trigger: "recovery_reissue" },
    ]);
    expect((await getJob(job.jobId))?.status).toBe("succeeded");
  });

  it("失败 step 重试时由新 worker 创建 recovery_reissue Attempt", async () => {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: "w-retry", inputHash: "h", steps: [{ stepKey: "a" }] });
    const first = new TaskWorker("w-retry-first", { claimFilter: { idempotencyKeyLike: "w%" } });
    expect((await first.runOnce(async () => ({ status: "failed", errorClass: "provider_timeout" }))).finalStatus).toBe("failed");
    const step = (await listSteps(job.jobId))[0]!;
    expect(await retryStep(job.jobId, step.id)).not.toBeNull();
    const second = new TaskWorker("w-retry-second", { claimFilter: { idempotencyKeyLike: "w%" } });
    expect((await second.runOnce(async () => ({ status: "succeeded" }))).finalStatus).toBe("succeeded");
    const attempts = await db
      .select({ attemptNo: generationAttempts.attemptNo, status: generationAttempts.status, trigger: generationAttempts.trigger })
      .from(generationAttempts)
      .where(eq(generationAttempts.stepId, step.id))
      .orderBy(generationAttempts.attemptNo);
    expect(attempts).toEqual([
      { attemptNo: 1, status: "failed", trigger: "initial" },
      { attemptNo: 2, status: "succeeded", trigger: "recovery_reissue" },
    ]);
  });
});
