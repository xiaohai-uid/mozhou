/**
 * 任务中心 UI 模型（票 09 折回：B 看板三列 + C 驾驶舱五问）。
 * 纯函数层：三列归类 / 动作显隐 / 五问回答 / 事件文案，供 task-center-view 消费。
 * 动作显隐与 service 端条件对齐（retryStep：failed+可恢复+无产物；endJob：非终态）。
 */
import {
  classifyOutcome,
  type AttemptStatus,
  type TaskFiveQuestionAnswer,
  type TaskStatus,
} from "./status";

/** B 看板三列。 */
export type BoardColumn = "active" | "failed" | "done";

export function categorizeJob(status: TaskStatus): BoardColumn {
  if (status === "failed") return "failed";
  if (status === "succeeded" || status === "cancelled") return "done";
  return "active"; // planned / queued / running / waiting_retry
}

/** 人工结束按钮显隐（对齐 service.endJob 的非终态条件）。 */
export function canEnd(status: TaskStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting_retry";
}

interface RetryableStep {
  id: number;
  status: string;
  outputArtifactId: string | null;
}
interface RetryableJob {
  status: string;
  errorClass: string | null;
}

/**
 * 重试按钮目标 step（spec US4：仅「失败的可恢复任务」且该 step 未产生结果）。
 * 返回 null 时 UI 不显示重试。cancelled 是最终决定；waiting_retry 由自动调度接管。
 */
export function retryTarget(
  job: RetryableJob,
  steps: RetryableStep[],
): number | null {
  if (job.status !== "failed") return null;
  if (classifyOutcome("failed", job.errorClass) !== "failed_recoverable") return null;
  const pending = steps.find((s) => s.outputArtifactId === null && s.status !== "succeeded");
  return pending?.id ?? null;
}

interface TokenAttempt {
  promptTokens: number;
  completionTokens: number;
}

/** 消耗合计（spec US8：含失败尝试）。 */
export function sumTokens(attempts: TokenAttempt[]): { prompt: number; completion: number } {
  return attempts.reduce(
    (acc, a) => ({ prompt: acc.prompt + (a.promptTokens || 0), completion: acc.completion + (a.completionTokens || 0) }),
    { prompt: 0, completion: 0 },
  );
}

interface FiveJob {
  status: string;
  errorClass: string | null;
}
interface FiveStep {
  stepKey: string;
  status: string;
  outputArtifactId: string | null;
}
interface FiveAttempt {
  id: number;
  attemptNo: number;
  status: string;
  errorClass: string | null;
  promptTokens: number;
  completionTokens: number;
}

/** C 驾驶舱五问（spec §6.1 验收口径；status.ts 的 TaskFiveQuestionAnswer 契约）。 */
export function answerFiveQuestions(
  job: FiveJob,
  steps: FiveStep[],
  attempts: FiveAttempt[],
): TaskFiveQuestionAnswer {
  const ordered = [...steps].sort((a, b) => 0); // 保持 API 顺序（按 ordinal 已排）
  const current =
    ordered.find((s) => s.status === "running") ??
    ordered.find((s) => s.status === "planned") ??
    (ordered.length > 0 ? ordered[ordered.length - 1]! : null);
  const lastFailed = [...attempts].reverse().find((a) => a.status === "failed");
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1]! : null;
  return {
    status: job.status as TaskStatus,
    currentStep: current?.stepKey ?? null,
    lastAttempt: lastFailed
      ? { attemptNo: lastFailed.attemptNo, status: lastFailed.status as AttemptStatus, errorClass: lastFailed.errorClass }
      : lastAttempt
        ? { attemptNo: lastAttempt.attemptNo, status: lastAttempt.status as AttemptStatus, errorClass: lastAttempt.errorClass }
        : null,
    outcomeClass: classifyOutcome(job.status as TaskStatus, job.errorClass),
    tokens: sumTokens(attempts),
    artifactAvailable: steps.some((s) => s.status === "succeeded" && s.outputArtifactId !== null),
  };
}

const PHASE_LABEL: Record<string, string> = {
  candidate_prepared: "候选已创建",
  streaming: "流式输出中",
  quality_gate: "质量门检查",
  running: "执行中",
  repair: "修复中",
  saving: "保存中",
};

/** 事件时间线文案（真实值域 phase/done/error；未知 kind 回退原文）。 */
export function formatEventLabel(event: { eventType: string; payload: Record<string, unknown> }): string {
  switch (event.eventType) {
    case "phase":
      return typeof event.payload.kind === "string" ? (PHASE_LABEL[event.payload.kind] ?? event.payload.kind) : "执行中";
    case "done":
      return "已完成";
    case "error":
      return event.payload.status === "cancelled" ? "已取消" : "失败";
    case "retry":
      return "自动重试";
    case "cancel":
      return "取消请求";
    case "reconnect":
      return "连接恢复";
    default:
      return event.eventType;
  }
}
