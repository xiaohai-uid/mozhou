/**
 * 任务 worker 循环（spec §6.4；选项 A 语义：请求内/常驻可切换，可注入驱动）。
 * claim → 逐 step（beginAttempt → handler → settleAttempt → completeStep/failStep）→ finish；
 * 每 step 前观察 cancel_requested；心跳续租可注入 timer。
 */
import { getJob, claimNextJob, heartbeatJob, finalizeCancelled, beginAttempt, settleAttempt, completeStep, failStep, finishJob, listSteps, updateExecutionCheckpoint, type ClaimFilter } from "./service";
import type { generationAttempts, generationJobs, generationSteps } from "@/lib/schema";

export interface StepHandlerContext {
  job: typeof generationJobs.$inferSelect;
  step: typeof generationSteps.$inferSelect;
  attempt: typeof generationAttempts.$inferSelect;
  /** 每次 step 前刷新：取消观察结果。 */
  cancelRequested: boolean;
  /** 将 provider/job 身份写入当前 worker 持有的 checkpoint。 */
  setCheckpoint: (checkpoint: Record<string, unknown>, providerJobId?: string | null) => Promise<boolean>;
}

export type StepResult =
  | { status: "succeeded"; usage?: { promptTokens?: number; completionTokens?: number } }
  | { status: "failed"; errorClass?: string | null; usage?: { promptTokens?: number; completionTokens?: number } };

export type StepHandler = (ctx: StepHandlerContext) => Promise<StepResult>;

export interface WorkerOptions {
  leaseSeconds?: number;
  /** 心跳间隔 ms；0 = 不自动心跳（测试注入）。 */
  heartbeatMs?: number;
  /** claim 范围过滤（测试隔离/按类任务专用 worker）。 */
  claimFilter?: ClaimFilter;
}

export interface RunOnceResult {
  processed: boolean;
  jobId: string | null;
  finalStatus: string | null;
}

export class TaskWorker {
  private opts: WorkerOptions;
  private leaseSeconds: number;
  private heartbeatMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private workerId: string,
    opts: WorkerOptions = {},
  ) {
    this.opts = opts;
    this.leaseSeconds = opts.leaseSeconds ?? 30;
    this.heartbeatMs = opts.heartbeatMs ?? 0;
  }

  /** 单轮：claim 一个任务并处理到终态。 */
  async runOnce(handler: StepHandler): Promise<RunOnceResult> {
    const job = await claimNextJob(this.workerId, this.leaseSeconds, this.opts.claimFilter);
    if (!job) return { processed: false, jobId: null, finalStatus: null };
    if (this.heartbeatMs > 0) this.startHeartbeat(job.jobId);

    const triggerOf = (attemptCount: number) =>
      attemptCount === 0 ? "initial" : "recovery_reissue";

    try {
      const steps = await listSteps(job.jobId);
      for (const step of steps) {
        if (step.status === "succeeded") continue;
        // 取消观察（step 边界）
        const fresh = await getJob(job.jobId);
        if (fresh?.cancelRequested) {
          await finalizeCancelled(job.jobId, this.workerId);
          return { processed: true, jobId: job.jobId, finalStatus: "cancelled" };
        }
        const attempt = await beginAttempt({
          stepId: step.id,
          trigger: triggerOf(step.attemptCount) as "initial" | "recovery_reissue",
        });
        const checkpointed = await updateExecutionCheckpoint(job.jobId, this.workerId, {
          stepKey: step.stepKey,
          attemptId: attempt.id,
          attemptNo: attempt.attemptNo,
          trigger: attempt.trigger,
        });
        if (!checkpointed) {
          return { processed: true, jobId: job.jobId, finalStatus: (await getJob(job.jobId))?.status ?? null };
        }
        const result = await handler({
          job: fresh ?? job,
          step,
          attempt,
          cancelRequested: fresh?.cancelRequested ?? false,
          setCheckpoint: (checkpoint, providerJobId) =>
            updateExecutionCheckpoint(
              job.jobId,
              this.workerId,
              { ...checkpoint, stepKey: step.stepKey, attemptId: attempt.id, attemptNo: attempt.attemptNo },
              providerJobId,
            ).then(Boolean),
        });
        const afterHandler = await getJob(job.jobId);
        if (!afterHandler) {
          return { processed: true, jobId: job.jobId, finalStatus: null };
        }
        if (afterHandler.cancelRequested) {
          await settleAttempt({ attemptId: attempt.id, status: "cancelled", errorClass: "user_cancelled" });
          await finalizeCancelled(job.jobId, this.workerId);
          return { processed: true, jobId: job.jobId, finalStatus: "cancelled" };
        }
        if (afterHandler.status !== "running" || afterHandler.owner !== this.workerId) {
          await settleAttempt({
            attemptId: attempt.id,
            status: "failed",
            errorClass: afterHandler.errorClass ?? "provider_network",
          });
          return { processed: true, jobId: job.jobId, finalStatus: afterHandler.status };
        }
        if (result.status === "succeeded") {
          const settled = await settleAttempt({
            attemptId: attempt.id,
            status: "succeeded",
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
          });
          if (!settled) {
            return { processed: true, jobId: job.jobId, finalStatus: (await getJob(job.jobId))?.status ?? null };
          }
          await completeStep(step.id);
        } else {
          const settled = await settleAttempt({
            attemptId: attempt.id,
            status: "failed",
            errorClass: result.errorClass ?? null,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
          });
          if (!settled) {
            return { processed: true, jobId: job.jobId, finalStatus: (await getJob(job.jobId))?.status ?? null };
          }
          await failStep(step.id);
          await finishJob(job.jobId, this.workerId, "failed", result.errorClass ?? null);
          return { processed: true, jobId: job.jobId, finalStatus: (await getJob(job.jobId))?.status ?? "failed" };
        }
      }
      const finished = await finishJob(job.jobId, this.workerId, "succeeded");
      return { processed: true, jobId: job.jobId, finalStatus: finished?.status ?? (await getJob(job.jobId))?.status ?? null };
    } finally {
      this.stopHeartbeat();
    }
  }

  /** 心跳续租；timer 可注入（测试用 fake clock 驱动）。 */
  startHeartbeat(jobId: string) {
    this.stopHeartbeat();
    if (this.heartbeatMs <= 0) return;
    this.timer = setInterval(() => {
      void heartbeatJob(jobId, this.workerId, this.leaseSeconds);
    }, this.heartbeatMs);
  }

  stopHeartbeat() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 驱动循环：连续处理直到无任务（可注入 shouldContinue）。 */
  async drain(handler: StepHandler, shouldContinue: () => boolean = () => true) {
    let count = 0;
    while (shouldContinue()) {
      const r = await this.runOnce(handler);
      if (!r.processed) break;
      count += 1;
    }
    return count;
  }
}
