// usage_ledger 账本测试（票 08）：append-only、priced/unpriced、聚合
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { generationJobs, usageLedger, users } from "@/lib/schema";
import {
  recordAttemptUsage,
  listLedgerByGeneration,
  ledgerStats,
} from "@/lib/tasks/usage-ledger";
import { beginAttempt, enqueueJob, listSteps, settleAttempt } from "@/lib/tasks/service";

const EMAIL = "usage-ledger-probe@example.com";

describe("调用级成本账本 usage_ledger", () => {
  let userId = 0;
  beforeAll(async () => {
    await db.delete(users).where(like(users.email, "usage-ledger-probe%"));
    const [u] = await db.insert(users).values({ email: EMAIL, passwordHash: "x" }).returning({ id: users.id });
    userId = u!.id;
  });
  afterAll(async () => {
    await db.delete(users).where(like(users.email, "usage-ledger-probe%"));
  });
  beforeEach(async () => {
    // 只清本文件范围：ul- 前缀 job（级联 steps/attempts）+ 当前用户账本行
    await db.delete(generationJobs).where(like(generationJobs.idempotencyKey, "ul-%"));
    await db.delete(usageLedger).where(eq(usageLedger.userId, userId));
  });

  async function makeAttempt(generationId: string): Promise<number> {
    const { job } = await enqueueJob({ userId, novelId: null, operation: "chapter_generation", idempotencyKey: `ul-${generationId}`, inputHash: "h", steps: [{ stepKey: "g" }] });
    const [step] = await listSteps(job.jobId);
    const attempt = await beginAttempt({ stepId: step!.id, trigger: "initial", provider: "one-api", model: "m-x" });
    return attempt.id;
  }

  it("重试累计不覆盖：失败行（unpriced）+ 成功行（priced）两行共存", async () => {
    const a1 = await makeAttempt("g-1");
    const a2 = await makeAttempt("g-1");
    await recordAttemptUsage({ userId, generationId: "g-1", attemptId: a1, provider: "one-api", model: "m-x", promptTokens: 100, completionTokens: 50 });
    await recordAttemptUsage({ userId, generationId: "g-1", attemptId: a2, provider: "one-api", model: "m-x", promptTokens: 120, completionTokens: 80, costAmount: 0.02, currency: "CNY" });
    const rows = await listLedgerByGeneration("g-1");
    expect(rows.length).toBe(2);
    expect(rows[0]!.costStatus).toBe("unpriced");
    expect(rows[0]!.costAmount).toBeNull();
    expect(rows[1]!.costStatus).toBe("priced");
    expect(Number(rows[1]!.costAmount)).toBe(0.02);
  });

  it("无价格调用标记 unpriced（不显示 0 元）；聚合 totalCost 为 null", async () => {
    await recordAttemptUsage({ userId, generationId: "g-2", attemptId: await makeAttempt("g-2"), provider: "one-api", model: "m-y", promptTokens: 10, completionTokens: 5 });
    await recordAttemptUsage({ userId, generationId: "g-2", attemptId: await makeAttempt("g-2"), provider: "one-api", model: "m-y", promptTokens: 20, completionTokens: 10 });
    const stats = await ledgerStats(userId);
    expect(stats.totalCalls).toBe(2);
    expect(stats.pricedCalls).toBe(0);
    expect(stats.unpricedCalls).toBe(2);
    expect(stats.totalPromptTokens).toBe(30);
    expect(stats.totalCompletionTokens).toBe(15);
    expect(stats.totalCost).toBeNull(); // 不是 0
  });

  it("Provider 未返回 usage 时记录 unknown，而不是伪造 0 token", async () => {
    const row = await recordAttemptUsage({
      userId,
      generationId: "g-unknown",
      attemptId: await makeAttempt("g-unknown"),
      provider: "one-api",
      model: "m-unknown",
    });

    expect(row).toMatchObject({ usageStatus: "unknown", promptTokens: null, completionTokens: null });
  });

  it("同一 attempt 的停止账和迟到终态写入只保留一行", async () => {
    const attemptId = await makeAttempt("g-idempotent");
    const cancelled = await recordAttemptUsage({
      userId,
      generationId: "g-idempotent",
      attemptId,
      provider: "one-api",
      model: "m-idempotent",
      route: "chapter",
      status: "cancelled",
      usageStatus: "unknown",
    });
    const late = await recordAttemptUsage({
      userId,
      generationId: "g-idempotent",
      attemptId,
      provider: "one-api",
      model: "m-idempotent",
      route: "chapter",
      status: "succeeded",
      promptTokens: 10,
      completionTokens: 5,
    });

    expect(late?.id).toBe(cancelled?.id);
    const rows = await listLedgerByGeneration("g-idempotent");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "cancelled", usageStatus: "unknown" });
  });

  it("authoritative row 同时保留 request/task、来源与责任归属", async () => {
    const attemptId = await makeAttempt("g-3");
    const row = await recordAttemptUsage({
      userId,
      requestId: "req-g-3",
      taskId: "task-g-3",
      generationId: "g-3",
      attemptId,
      sourceClass: "PUBLIC_FREE",
      provider: "one-api",
      model: "deepseek-v4-flash",
      credentialOwner: "platform",
      billingOwner: "provider",
      route: "chapter",
      status: "succeeded",
      promptTokens: 11,
      completionTokens: 7,
    });
    expect(row).toMatchObject({
      requestId: "req-g-3",
      taskId: "task-g-3",
      sourceClass: "PUBLIC_FREE",
      provider: "one-api",
      model: "deepseek-v4-flash",
      credentialOwner: "platform",
      billingOwner: "provider",
      route: "chapter",
      status: "succeeded",
      promptTokens: 11,
      completionTokens: 7,
      costStatus: "unpriced",
    });
  });

  it("retry/fallback/resume 每次真实 inference 都追加独立 ledger，绝不覆盖前一次", async () => {
    const { job } = await enqueueJob({
      userId,
      novelId: null,
      operation: "chapter_generation",
      idempotencyKey: "ul-n1-attempts",
      inputHash: "h",
      steps: [{ stepKey: "generate" }],
    });
    const [step] = await listSteps(job.jobId);
    expect(step).toBeTruthy();

    const first = await beginAttempt({
      stepId: step!.id,
      trigger: "initial",
      provider: "free-a",
      model: "model-a",
    });
    await settleAttempt({ attemptId: first.id, status: "failed", errorClass: "AiTimeout" });
    const retry = await beginAttempt({
      stepId: step!.id,
      trigger: "manual_retry",
      provider: "free-a",
      model: "model-a",
    });
    await settleAttempt({ attemptId: retry.id, status: "failed", errorClass: "AiNetworkError" });
    const fallback = await beginAttempt({
      stepId: step!.id,
      trigger: "recovery_reissue",
      provider: "free-b",
      model: "model-b",
    });

    await recordAttemptUsage({
      userId,
      requestId: "req-n1",
      taskId: job.jobId,
      generationId: job.jobId,
      attemptId: first.id,
      sourceClass: "PUBLIC_FREE",
      provider: "free-a",
      model: "model-a",
      route: "chapter",
      status: "failed",
    });
    await recordAttemptUsage({
      userId,
      requestId: "req-n1",
      taskId: job.jobId,
      generationId: job.jobId,
      attemptId: retry.id,
      sourceClass: "PUBLIC_FREE",
      provider: "free-a",
      model: "model-a",
      route: "chapter",
      status: "failed",
    });
    await recordAttemptUsage({
      userId,
      requestId: "req-n1",
      taskId: job.jobId,
      generationId: job.jobId,
      attemptId: fallback.id,
      sourceClass: "PUBLIC_FREE",
      provider: "free-b",
      model: "model-b",
      route: "chapter",
      status: "succeeded",
      promptTokens: 8,
      completionTokens: 13,
    });

    const rows = await listLedgerByGeneration(job.jobId);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.attemptId)).toEqual([first.id, retry.id, fallback.id]);
    expect(rows.every((row) => row.sourceClass === "PUBLIC_FREE")).toBe(true);
    expect(rows.slice(0, 2).every((row) => row.usageStatus === "unknown")).toBe(true);
    expect(rows[2]).toMatchObject({
      provider: "free-b",
      model: "model-b",
      status: "succeeded",
      usageStatus: "reported",
      promptTokens: 8,
      completionTokens: 13,
    });
  });

  it("未归因行保留：无 attemptId 的行不被丢弃", async () => {
    await recordAttemptUsage({ userId, generationId: null, attemptId: null, provider: "one-api", model: "m-z", promptTokens: 5, completionTokens: 5 });
    const rows = await db.select().from(usageLedger).where(and(eq(usageLedger.userId, userId), eq(usageLedger.model, "m-z")));
    expect(rows.length).toBe(1);
    expect(rows[0]!.attemptId).toBeNull();
  });
});
