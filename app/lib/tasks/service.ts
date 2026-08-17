/**
 * 任务门面（lib/tasks）：唯一允许操作任务状态的组件（spec §6.3）。
 * 所有业务路由（章节/拆解/导入）只能经本门面登记与查询任务；
 * 候选生命周期、正文写入、技能运行时保持现有契约。
 * DB 条件更新是最终守卫；lib/tasks/status 的迁移表是防御层。
 */
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  generationAttempts,
  generationEvents,
  generationJobs,
  generationSteps,
} from "@/lib/schema";
import { canTransition, type TaskStatus } from "./status";

export const LEASE_DEFAULT_SECONDS = 30;
const SEQ_CONFLICT = "23505";
const SEQ_MAX_RETRIES = 5;

/** drizzle 把 PostgresError 包装为 DrizzleQueryError：code 在 cause 上，需兜底。 */
function conflictCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
}

// ---------- job 生命周期 ----------

export interface EnqueueInput {
  /** 显式 jobId（Q6：generationId 与 job_id 1:1，章节生成传 generationKey）；缺省随机 uuid。 */
  jobId?: string;
  userId: number;
  novelId: number | null;
  chapterId?: number | null;
  operation: string;
  idempotencyKey: string;
  inputHash: string;
  steps?: Array<{ stepKey: string; inputSnapshot?: unknown }>;
}

export async function enqueueJob(input: EnqueueInput): Promise<{ job: typeof generationJobs.$inferSelect; created: boolean }> {
  let inserted: typeof generationJobs.$inferSelect | undefined;
  try {
    [inserted] = await db
      .insert(generationJobs)
      .values({
        jobId: input.jobId ?? crypto.randomUUID(),
        userId: input.userId,
        novelId: input.novelId,
        chapterId: input.chapterId ?? null,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        inputHash: input.inputHash,
        status: "queued",
      })
      .returning();
  } catch (e) {
    if (conflictCode(e) !== SEQ_CONFLICT) throw e; // 幂等键冲突 → 返回既有
  }
  if (inserted) {
    if (input.steps?.length) {
      await db.insert(generationSteps).values(
        input.steps.map((s, i) => ({
          jobId: inserted.jobId,
          stepKey: s.stepKey,
          ordinal: i + 1,
          status: "planned",
          inputSnapshot: (s.inputSnapshot ?? null) as never,
        })),
      );
    }
    return { job: inserted, created: true };
  }
  const novelCond =
    input.novelId === null ? isNull(generationJobs.novelId) : eq(generationJobs.novelId, input.novelId);
  const [existing] = await db
    .select()
    .from(generationJobs)
    .where(and(novelCond, eq(generationJobs.idempotencyKey, input.idempotencyKey)));
  if (!existing) throw new Error("enqueue: job lost in idempotency race");
  return { job: existing, created: false };
}

/** claim 原子条件更新：queued 或 running 且租约过期；FOR UPDATE SKIP LOCKED 保证单次 claim。
 * filter 可选：把 worker 限定到某类任务（如按 idempotencyKey 前缀/operation），生产与测试共用。 */
export interface ClaimFilter {
  idempotencyKeyLike?: string;
  operation?: string;
}

export async function claimNextJob(workerId: string, leaseSeconds: number = LEASE_DEFAULT_SECONDS, filter?: ClaimFilter) {
  const scope = buildClaimScope(filter);
  const [row] = await db
    .update(generationJobs)
    .set({
      status: "running",
      owner: workerId,
      leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
    })
    .where(sql`id = (
      SELECT id FROM generation_jobs
      WHERE cancel_requested = false
        AND ((status = 'queued') OR (status = 'running' AND lease_until < now()))
        AND ${scope}
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
    )`)
    .returning();
  return row ?? null;
}

function buildClaimScope(filter?: ClaimFilter) {
  const conds: string[] = ["true"];
  if (filter?.idempotencyKeyLike) conds.push(`idempotency_key LIKE '${filter.idempotencyKeyLike}'`);
  if (filter?.operation) conds.push(`operation = '${filter.operation}'`);
  return sql.raw(conds.join(" AND "));
}

/** 按 jobId 精确 claim（请求内执行）：仅 queued 可被接管。 */
export async function claimJob(jobId: string, workerId: string, leaseSeconds: number = LEASE_DEFAULT_SECONDS) {
  const [row] = await db
    .update(generationJobs)
    .set({
      status: "running",
      owner: workerId,
      leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})`,
    })
    .where(and(eq(generationJobs.jobId, jobId), eq(generationJobs.status, "queued"), eq(generationJobs.cancelRequested, false)))
    .returning();
  return row ?? null;
}

export async function heartbeatJob(jobId: string, workerId: string, leaseSeconds: number = LEASE_DEFAULT_SECONDS): Promise<boolean> {
  const rows = await db
    .update(generationJobs)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${leaseSeconds})` })
    .where(and(eq(generationJobs.jobId, jobId), eq(generationJobs.owner, workerId), eq(generationJobs.status, "running")))
    .returning({ jobId: generationJobs.jobId });
  return rows.length > 0;
}

/** finish：仅 running 且未请求取消可进入终态（0-rows-cancelled 语义）；非法迁移拒绝。 */
export async function finishJob(
  jobId: string,
  workerId: string,
  finalStatus: Extract<TaskStatus, "succeeded" | "failed" | "cancelled">,
  errorClass?: string | null,
) {
  if (!canTransition("running", finalStatus)) return null;
  const [row] = await db
    .update(generationJobs)
    .set({ status: finalStatus, errorClass: errorClass ?? null, finishedAt: sql`now()` })
    .where(
      and(
        eq(generationJobs.jobId, jobId),
        eq(generationJobs.owner, workerId),
        eq(generationJobs.status, "running"),
        eq(generationJobs.cancelRequested, false),
      ),
    )
    .returning();
  return row ?? null;
}

export async function cancelJob(jobId: string) {
  const [queued] = await db
    .update(generationJobs)
    .set({ status: "cancelled", cancelRequested: true, finishedAt: sql`now()` })
    .where(and(eq(generationJobs.jobId, jobId), eq(generationJobs.status, "queued")))
    .returning();
  if (queued) return queued;
  const [running] = await db
    .update(generationJobs)
    .set({ cancelRequested: true })
    .where(and(eq(generationJobs.jobId, jobId), eq(generationJobs.status, "running")))
    .returning();
  return running ?? null;
}

/**
 * 请求内任务的即时取消：用户已经明确停止生成，不能依赖原 SSE 请求
 * 继续存活才能把 job/attempt 收束。后台 worker 仍可安全观察到 cancelled
 * 终态；迟到的 provider 结果只能被幂等守卫忽略。
 */
export async function cancelJobImmediately(jobId: string) {
  const [job] = await db
    .update(generationJobs)
    .set({ status: "cancelled", cancelRequested: true, finishedAt: sql`now()` })
    .where(and(eq(generationJobs.jobId, jobId), inArray(generationJobs.status, ["queued", "running"])))
    .returning();
  if (!job) return { job: null, attempts: [] as Array<typeof generationAttempts.$inferSelect> };

  const steps = await db
    .select({ id: generationSteps.id })
    .from(generationSteps)
    .where(eq(generationSteps.jobId, jobId));
  if (steps.length === 0) return { job, attempts: [] as Array<typeof generationAttempts.$inferSelect> };

  const attempts = await db
    .update(generationAttempts)
    .set({ status: "cancelled", errorClass: "user_cancelled", finishedAt: sql`now()` })
    .where(and(inArray(generationAttempts.stepId, steps.map((step) => step.id)), eq(generationAttempts.status, "running")))
    .returning();
  await db
    .update(generationSteps)
    .set({ status: "cancelled", updatedAt: sql`now()` })
    .where(and(inArray(generationSteps.id, steps.map((step) => step.id)), inArray(generationSteps.status, ["planned", "queued", "running", "waiting_retry"])));
  return { job, attempts };
}

/** 取消后的终态化：仅 cancel_requested 的 running 任务可进 cancelled。 */
export async function finalizeCancelled(jobId: string, workerId: string) {
  const [row] = await db
    .update(generationJobs)
    .set({ status: "cancelled", finishedAt: sql`now()` })
    .where(
      and(
        eq(generationJobs.jobId, jobId),
        eq(generationJobs.owner, workerId),
        eq(generationJobs.status, "running"),
        eq(generationJobs.cancelRequested, true),
      ),
    )
    .returning();
  return row ?? null;
}

/** 恢复扫描①：running 且租约过期 → waiting_retry（中断判定）。 */
export async function recoverScan(): Promise<{ interrupted: number }> {
  const expired = await db
    .update(generationJobs)
    .set({
      status: "waiting_retry",
      retryAt: sql`now() + interval '30 seconds'`,
      errorClass: sql`COALESCE(error_class, 'provider_network')`,
    })
    .where(and(eq(generationJobs.status, "running"), sql`lease_until < now()`))
    .returning({ jobId: generationJobs.jobId });
  for (const { jobId } of expired) {
    const steps = await db
      .select({ id: generationSteps.id })
      .from(generationSteps)
      .where(eq(generationSteps.jobId, jobId));
    if (steps.length === 0) continue;
    await db
      .update(generationAttempts)
      .set({
        status: "failed",
        errorClass: sql`COALESCE(error_class, 'provider_network')`,
        finishedAt: sql`now()`,
      })
      .where(
        and(
          inArray(generationAttempts.stepId, steps.map((step) => step.id)),
          eq(generationAttempts.status, "running"),
        ),
      );
  }
  return { interrupted: expired.length };
}

/** 恢复扫描②：到期 waiting_retry → queued（延迟重试调度）。 */
export async function requeueDue(): Promise<{ requeued: number }> {
  const due = await db
    .update(generationJobs)
    .set({ status: "queued" })
    .where(and(eq(generationJobs.status, "waiting_retry"), lte(generationJobs.retryAt, sql`now()`)))
    .returning({ jobId: generationJobs.jobId });
  return { requeued: due.length };
}

// ---------- step / attempt ----------

export async function listSteps(jobId: string) {
  return db
    .select()
    .from(generationSteps)
    .where(eq(generationSteps.jobId, jobId))
    .orderBy(generationSteps.ordinal);
}

export async function completeStep(stepId: number, artifactId?: string | null) {
  const [row] = await db
    .update(generationSteps)
    .set({ status: "succeeded", outputArtifactId: artifactId ?? null })
    .where(and(eq(generationSteps.id, stepId), inArray(generationSteps.status, ["planned", "running"])))
    .returning();
  return row ?? null;
}

export async function failStep(stepId: number) {
  const [row] = await db
    .update(generationSteps)
    .set({ status: "failed" })
    .where(and(eq(generationSteps.id, stepId), inArray(generationSteps.status, ["planned", "running"])))
    .returning();
  return row ?? null;
}

export interface BeginAttemptInput {
  stepId: number;
  trigger: "initial" | "auto_retry" | "manual_retry" | "recovery_reissue";
  provider?: string | null;
  model?: string | null;
}

/** 新建 attempt：attempt_no = step 内 MAX+1；并发冲突重试。 */
export async function beginAttempt(input: BeginAttemptInput) {
  for (let i = 0; i < SEQ_MAX_RETRIES; i++) {
    const [row] = await db
      .select({ next: sql<number>`COALESCE(MAX(attempt_no), 0) + 1` })
      .from(generationAttempts)
      .where(eq(generationAttempts.stepId, input.stepId));
    const next = Number(row?.next ?? 1);
    try {
      const [attempt] = await db
        .insert(generationAttempts)
        .values({
          stepId: input.stepId,
          attemptNo: next,
          trigger: input.trigger,
          provider: input.provider ?? null,
          model: input.model ?? null,
          status: "running",
        })
        .onConflictDoNothing({ target: [generationAttempts.stepId, generationAttempts.attemptNo] })
        .returning();
      if (attempt) {
        await db
          .update(generationSteps)
          .set({ attemptCount: sql`attempt_count + 1`, status: "running" })
          .where(eq(generationSteps.id, input.stepId));
        return attempt;
      }
    } catch (e) {
      if (conflictCode(e) !== SEQ_CONFLICT) throw e;
    }
  }
  throw new Error("beginAttempt: attempt_no conflict retries exhausted");
}

export interface SettleAttemptInput {
  attemptId: number;
  status: "succeeded" | "failed" | "cancelled";
  errorClass?: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

/** attempt 终态化：仅 running 可终态（幂等守卫）。 */
export async function settleAttempt(input: SettleAttemptInput) {
  const [row] = await db
    .update(generationAttempts)
    .set({
      status: input.status,
      errorClass: input.errorClass ?? null,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      finishedAt: sql`now()`,
    })
    .where(and(eq(generationAttempts.id, input.attemptId), eq(generationAttempts.status, "running")))
    .returning();
  return row ?? null;
}

/** 持久化当前执行位置；只有真正持有 lease 的 worker 能推进 checkpoint。 */
export async function updateExecutionCheckpoint(
  jobId: string,
  workerId: string,
  checkpoint: Record<string, unknown>,
  providerJobId?: string | null,
) {
  const [row] = await db
    .update(generationJobs)
    .set({
      executionCheckpoint: sql`COALESCE(${generationJobs.executionCheckpoint}, '{}'::jsonb) || ${JSON.stringify(checkpoint)}::jsonb`,
      ...(providerJobId !== undefined ? { providerJobId } : {}),
    })
    .where(
      and(
        eq(generationJobs.jobId, jobId),
        eq(generationJobs.owner, workerId),
        eq(generationJobs.status, "running"),
      ),
    )
    .returning();
  return row ?? null;
}

// ---------- events ----------

export interface AppendEventInput {
  jobId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  clientKey?: string | null;
}

/** append 事件：seq = job 内 MAX+1；(job,seq) 冲突重试；(job,client_key) 幂等。 */
export async function appendEvent(input: AppendEventInput) {
  for (let i = 0; i < SEQ_MAX_RETRIES; i++) {
    const [row] = await db
      .select({ next: sql<number>`COALESCE(MAX(seq), 0) + 1` })
      .from(generationEvents)
      .where(eq(generationEvents.jobId, input.jobId));
    const next = Number(row?.next ?? 1);
    try {
      const [event] = await db
        .insert(generationEvents)
        .values({
          jobId: input.jobId,
          seq: next,
          eventType: input.eventType,
          payload: (input.payload ?? {}) as never,
          clientKey: input.clientKey ?? null,
        })
        .onConflictDoNothing({ target: [generationEvents.jobId, generationEvents.clientKey] })
        .returning();
      if (event) return event;
      const [existing] = await db
        .select()
        .from(generationEvents)
        .where(
          and(
            eq(generationEvents.jobId, input.jobId),
            eq(generationEvents.clientKey, input.clientKey ?? ""),
          ),
        );
      if (existing) return existing;
    } catch (e) {
      if (conflictCode(e) !== SEQ_CONFLICT) throw e;
    }
  }
  throw new Error("appendEvent: seq conflict retries exhausted");
}

/** 事件游标读取（Last-Event-ID 续传）。 */
export async function readEvents(jobId: string, afterSeq = 0) {
  return db
    .select()
    .from(generationEvents)
    .where(and(eq(generationEvents.jobId, jobId), gt(generationEvents.seq, afterSeq)))
    .orderBy(generationEvents.seq);
}

// ---------- 人工重试（Q4：step 级，仅未产生结果） ----------

/** 重试指定 step：仅允许「未产生结果」的 step（无 output_artifact_id），job 回到 queued。 */
export async function retryStep(jobId: string, stepId: number) {
  const [step] = await db
    .select()
    .from(generationSteps)
    .where(and(eq(generationSteps.id, stepId), eq(generationSteps.jobId, jobId)));
  if (!step) return null;
  if (step.outputArtifactId) return null; // 已产生结果 → 拒绝重试（不重复扣费底线）
  const [job] = await db
    .update(generationJobs)
    .set({ status: "queued", owner: null, cancelRequested: false, errorClass: null, errorMessage: null })
    .where(and(eq(generationJobs.jobId, jobId), inArray(generationJobs.status, ["failed", "waiting_retry"])))
    .returning();
  if (!job) return null;
  await db
    .update(generationSteps)
    .set({ status: "planned" })
    .where(and(eq(generationSteps.id, stepId), inArray(generationSteps.status, ["failed", "running"])));
  return job;
}

/** 人工结束卡死任务（票 09）：queued/running/waiting_retry → failed（manual_ended）。 */
export async function endJob(jobId: string, reason?: string | null) {
  const [row] = await db
    .update(generationJobs)
    .set({
      status: "failed",
      errorClass: "manual_ended",
      errorMessage: reason ?? "人工结束",
      finishedAt: sql`now()`,
    })
    .where(
      and(
        eq(generationJobs.jobId, jobId),
        inArray(generationJobs.status, ["queued", "running", "waiting_retry"]),
      ),
    )
    .returning();
  return row ?? null;
}

/** 任务详情（票 09）：job + steps + attempts + 事件。 */
export async function getJobDetail(jobId: string) {
  const job = await getJob(jobId);
  if (!job) return null;
  const [steps, attempts, events] = await Promise.all([
    listSteps(jobId),
    db
      .select()
      .from(generationAttempts)
      .where(
        inArray(
          generationAttempts.stepId,
          (await listSteps(jobId)).map((s) => s.id),
        ),
      )
      .orderBy(generationAttempts.id),
    readEvents(jobId, 0),
  ]);
  return { job, steps, attempts, events };
}

// ---------- 查询 ----------

export async function getJob(jobId: string) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.jobId, jobId));
  return job ?? null;
}

export async function listJobs(userId: number, limit = 50) {
  return db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.userId, userId))
    .orderBy(sql`id DESC`)
    .limit(limit);
}
