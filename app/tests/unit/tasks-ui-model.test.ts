// 任务中心 UI 模型纯函数（票 09 折回：B 看板三列 + C 驾驶舱五问）
// seam：app/lib/tasks/ui-model.ts —— 不依赖 DOM/DB，node 环境可直接测。
import { describe, it, expect } from "vitest";
import {
  categorizeJob,
  canEnd,
  retryTarget,
  sumTokens,
  answerFiveQuestions,
  formatEventLabel,
} from "@/lib/tasks/ui-model";

// 形状对齐 API 序列化（generation_jobs/steps/attempts/events 表行）
interface TJob { jobId: string; status: string; errorClass: string | null }
interface TStep { id: number; stepKey: string; ordinal: number; status: string; outputArtifactId: string | null }
interface TAttempt {
  id: number; stepId: number; attemptNo: number; trigger: string;
  status: string; errorClass: string | null; promptTokens: number; completionTokens: number;
}
const job = (over: Partial<TJob> = {}): TJob => ({ jobId: "j1", status: "failed", errorClass: null, ...over });
const step = (id: number, over: Partial<Omit<TStep, "id">> = {}): TStep => ({
  id, stepKey: "generate", ordinal: 1, status: "planned", outputArtifactId: null, ...over,
});
const attempt = (id: number, over: Partial<Omit<TAttempt, "id">> = {}): TAttempt => ({
  id, stepId: 1, attemptNo: 1, trigger: "initial", status: "failed", errorClass: null,
  promptTokens: 100, completionTokens: 20, ...over,
});

describe("categorizeJob — B 看板三列归类", () => {
  it("queued/running/waiting_retry → 进行中", () => {
    expect(categorizeJob("queued")).toBe("active");
    expect(categorizeJob("running")).toBe("active");
    expect(categorizeJob("waiting_retry")).toBe("active");
  });
  it("failed → 失败待处理", () => {
    expect(categorizeJob("failed")).toBe("failed");
  });
  it("succeeded/cancelled → 已完成列（终态）", () => {
    expect(categorizeJob("succeeded")).toBe("done");
    expect(categorizeJob("cancelled")).toBe("done");
  });
});

describe("canEnd — 人工结束按钮显隐（对齐 service.endJob 条件）", () => {
  it("queued/running/waiting_retry 可结束", () => {
    expect(canEnd("queued")).toBe(true);
    expect(canEnd("running")).toBe(true);
    expect(canEnd("waiting_retry")).toBe(true);
  });
  it("终态不可结束", () => {
    expect(canEnd("succeeded")).toBe(false);
    expect(canEnd("failed")).toBe(false);
    expect(canEnd("cancelled")).toBe(false);
  });
});

describe("retryTarget — 重试按钮显隐（spec US4：仅失败的可恢复任务）", () => {
  it("failed + 可恢复 + 有未产生结果 step → 返回该 stepId", () => {
    const t = retryTarget(
      job({ status: "failed", errorClass: "provider_rate_limit" }),
      [step(7, { status: "failed" })],
    );
    expect(t).toBe(7);
  });
  it("failed + 可恢复但 step 已产生结果 → null（不重复扣费底线）", () => {
    const t = retryTarget(
      job({ status: "failed", errorClass: "provider_network" }),
      [step(7, { status: "succeeded", outputArtifactId: "a-1" })],
    );
    expect(t).toBeNull();
  });
  it("failed + 终态错误类（4xx/manual_ended）→ null（不给重试）", () => {
    expect(retryTarget(job({ status: "failed", errorClass: "provider_client_error" }), [step(7)])).toBeNull();
    expect(retryTarget(job({ status: "failed", errorClass: "manual_ended" }), [step(7)])).toBeNull();
  });
  it("cancelled 是最终决定 → 无重试；waiting_retry 自动调度 → 无人工重试", () => {
    expect(retryTarget(job({ status: "cancelled" }), [step(7)])).toBeNull();
    expect(retryTarget(job({ status: "waiting_retry", errorClass: "provider_network" }), [step(7)])).toBeNull();
  });
});

describe("sumTokens — 消耗合计（spec US8：含失败尝试）", () => {
  it("多 attempt 合计 prompt+completion", () => {
    expect(sumTokens([attempt(1), attempt(2, { promptTokens: 50, completionTokens: 5 })])).toEqual({
      prompt: 150,
      completion: 25,
    });
  });
  it("空列表 → 0/0", () => {
    expect(sumTokens([])).toEqual({ prompt: 0, completion: 0 });
  });
});

describe("answerFiveQuestions — C 驾驶舱五问（spec §6.1 验收口径）", () => {
  it("正常成功任务：状态/当前步/无失败尝试/可恢复=succeeded/消耗/产物可用", () => {
    const a = answerFiveQuestions(
      job({ status: "succeeded" }),
      [step(1, { status: "succeeded", outputArtifactId: "a-9" })],
      [attempt(1, { status: "succeeded" })],
    );
    expect(a.status).toBe("succeeded");
    expect(a.currentStep).toBe("generate");
    expect(a.lastAttempt?.attemptNo).toBe(1);
    expect(a.lastAttempt?.status).toBe("succeeded");
    expect(a.outcomeClass).toBe("succeeded");
    expect(a.tokens).toEqual({ prompt: 100, completion: 20 });
    expect(a.artifactAvailable).toBe(true);
  });
  it("失败任务：定位最后一次失败尝试与错误类，可恢复按 errorClass 判定", () => {
    const a = answerFiveQuestions(
      job({ status: "failed", errorClass: "provider_rate_limit" }),
      [step(1, { status: "failed" })],
      [attempt(1, { errorClass: "provider_timeout" }), attempt(2, { attemptNo: 2, errorClass: "provider_rate_limit" })],
    );
    expect(a.currentStep).toBe("generate");
    expect(a.lastAttempt).toMatchObject({ attemptNo: 2, status: "failed", errorClass: "provider_rate_limit" });
    expect(a.outcomeClass).toBe("failed_recoverable");
    expect(a.artifactAvailable).toBe(false);
  });
  it("waiting_retry → failed_recoverable；cancelled/未知错误 → failed_terminal", () => {
    expect(answerFiveQuestions(job({ status: "waiting_retry", errorClass: "provider_network" }), [], []).outcomeClass).toBe("failed_recoverable");
    expect(answerFiveQuestions(job({ status: "cancelled" }), [], []).outcomeClass).toBe("failed_terminal");
    expect(answerFiveQuestions(job({ status: "failed", errorClass: null }), [], []).outcomeClass).toBe("failed_terminal");
  });
  it("无 steps/attempts 兜底：currentStep=null、lastAttempt=null", () => {
    const a = answerFiveQuestions(job({ status: "queued" }), [], []);
    expect(a.currentStep).toBeNull();
    expect(a.lastAttempt).toBeNull();
    expect(a.artifactAvailable).toBe(false);
  });
  it("有 running attempt 时 lastAttempt 反映进行中尝试", () => {
    const a = answerFiveQuestions(
      job({ status: "running" }),
      [step(1, { status: "running" })],
      [attempt(1, { status: "succeeded" }), attempt(2, { attemptNo: 2, status: "running" })],
    );
    expect(a.lastAttempt).toMatchObject({ attemptNo: 2, status: "running" });
  });
});

describe("formatEventLabel — 事件时间线文案（真实值域 phase/done/error）", () => {
  it("phase 按 kind 映射，未知 kind 回退原文", () => {
    expect(formatEventLabel({ eventType: "phase", payload: { kind: "candidate_prepared" } })).toBe("候选已创建");
    expect(formatEventLabel({ eventType: "phase", payload: { kind: "streaming" } })).toBe("流式输出中");
    expect(formatEventLabel({ eventType: "phase", payload: { kind: "unknown_future" } })).toBe("unknown_future");
  });
  it("done / error（含 cancelled）", () => {
    expect(formatEventLabel({ eventType: "done", payload: { status: "succeeded" } })).toBe("已完成");
    expect(formatEventLabel({ eventType: "error", payload: { status: "failed" } })).toBe("失败");
    expect(formatEventLabel({ eventType: "error", payload: { status: "cancelled" } })).toBe("已取消");
    expect(formatEventLabel({ eventType: "error", payload: {} })).toBe("失败");
  });
});
