/**
 * 统一状态词表与验收口径（spec §6.1，grilling Q1 定案，FROZEN）。
 * 契约真源：.scratch/mozhou-task-runtime/spec.md §6.1 / §6.9；变更必须 Contract Delta。
 * job 与 step 共用同一枚举；attempt 独立枚举；结局分类四档。
 */

export const TASK_TRANSITIONS = [
  "planned",
  "queued",
  "running",
  "waiting_retry",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_TRANSITIONS)[number];

export const ATTEMPT_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** 结局分类（job 级）：state_degraded 本期只入词表（Phase 2 Canon 结算使用）。 */
export type OutcomeClass =
  | "succeeded"
  | "failed_recoverable"
  | "failed_terminal"
  | "state_degraded";

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["succeeded", "failed", "cancelled"]);

export function isTaskTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

/** 合法迁移表（与 DB 条件更新守卫互为防御；DB 是最终裁决）。 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  planned: ["queued"],
  queued: ["running", "cancelled"],
  running: ["waiting_retry", "succeeded", "failed", "cancelled"],
  waiting_retry: ["queued", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 错误类别（对齐 deconstruction-pipeline 分类，扩展任务语义）。 */
export type TaskErrorClass =
  | "provider_timeout"
  | "provider_network"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "provider_client_error"
  | "provider_protocol"
  | "invalid_json"
  | "artifact_schema_invalid"
  | "artifact_quality_failed"
  | "repair_failed"
  | "user_cancelled"
  | "manual_ended"
  | "internal_error";

const RECOVERABLE_ERRORS: ReadonlySet<string> = new Set([
  "provider_timeout",
  "provider_network",
  "provider_rate_limit",
  "provider_unavailable",
  "invalid_json",
  "artifact_schema_invalid",
  "artifact_quality_failed",
  "repair_failed",
]);

/**
 * 结局分类纯函数：失败是否可恢复按 errorClass 判定；未知/缺失按终态处理
 * （「不重复扣费」底线：无法证明可恢复就不得自动重试）。
 */
export function classifyOutcome(status: TaskStatus, errorClass: string | null): OutcomeClass {
  if (status === "succeeded") return "succeeded";
  if (status === "waiting_retry") return "failed_recoverable";
  if (status === "failed" && errorClass !== null && RECOVERABLE_ERRORS.has(errorClass)) {
    return "failed_recoverable";
  }
  return "failed_terminal";
}

/** 五问查询契约（阶段 0 验收口径）：给 generationId 只看 DB/API 即可回答。 */
export interface TaskFiveQuestionAnswer {
  /** 现在到哪一步 */
  status: TaskStatus;
  /** 当前执行中的 step */
  currentStep: string | null;
  /** 失败发生在哪次尝试 */
  lastAttempt: { attemptNo: number; status: AttemptStatus; errorClass: string | null } | null;
  /** 能否继续 */
  outcomeClass: OutcomeClass;
  /** 花了多少 token */
  tokens: { prompt: number; completion: number };
  /** 产物是否可用 */
  artifactAvailable: boolean;
}
