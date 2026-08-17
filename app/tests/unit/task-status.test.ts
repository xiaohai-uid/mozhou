import { describe, expect, it } from "vitest";
import {
  ATTEMPT_STATUSES,
  TaskStatus,
  isTaskTerminal,
  canTransition,
  classifyOutcome,
  TASK_TRANSITIONS,
  TaskFiveQuestionAnswer,
} from "@/lib/tasks/status";

describe("task status vocabulary (spec §6.1, Q1)", () => {
  it("has the exact frozen enums", () => {
    expect(TASK_TRANSITIONS).toEqual([
      "planned", "queued", "running", "waiting_retry", "succeeded", "failed", "cancelled",
    ]);
    expect(ATTEMPT_STATUSES).toEqual(["queued", "running", "succeeded", "failed", "cancelled"]);
  });

  it("recognizes terminal states", () => {
    for (const s of ["succeeded", "failed", "cancelled"] as TaskStatus[]) {
      expect(isTaskTerminal(s)).toBe(true);
    }
    for (const s of ["planned", "queued", "running", "waiting_retry"] as TaskStatus[]) {
      expect(isTaskTerminal(s)).toBe(false);
    }
  });

  it("enforces legal transitions only", () => {
    expect(canTransition("planned", "queued")).toBe(true);
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("running", "waiting_retry")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
    expect(canTransition("waiting_retry", "queued")).toBe(true);
    expect(canTransition("waiting_retry", "cancelled")).toBe(true);
    // 非法迁移
    expect(canTransition("planned", "running")).toBe(false);
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
    expect(canTransition("running", "planned")).toBe(false);
    expect(canTransition("queued", "waiting_retry")).toBe(false);
  });

  it("classifies outcomes (succeeded / failed_recoverable / failed_terminal)", () => {
    expect(classifyOutcome("succeeded", null)).toBe("succeeded");
    expect(classifyOutcome("failed", "provider_timeout")).toBe("failed_recoverable");
    expect(classifyOutcome("failed", "provider_network")).toBe("failed_recoverable");
    expect(classifyOutcome("failed", "provider_rate_limit")).toBe("failed_recoverable");
    expect(classifyOutcome("failed", "provider_unavailable")).toBe("failed_recoverable");
    expect(classifyOutcome("failed", "invalid_json")).toBe("failed_recoverable");
    expect(classifyOutcome("failed", "provider_client_error")).toBe("failed_terminal");
    expect(classifyOutcome("failed", "provider_protocol")).toBe("failed_terminal");
    expect(classifyOutcome("failed", "user_cancelled")).toBe("failed_terminal");
    expect(classifyOutcome("failed", "manual_ended")).toBe("failed_terminal");
    expect(classifyOutcome("failed", null)).toBe("failed_terminal");
    expect(classifyOutcome("cancelled", null)).toBe("failed_terminal");
    expect(classifyOutcome("waiting_retry", "provider_5xx")).toBe("failed_recoverable");
  });

  it("shapes the five-question acceptance answer (spec §6.1)", () => {
    const answer: TaskFiveQuestionAnswer = {
      status: "running",
      currentStep: "compose",
      lastAttempt: { attemptNo: 2, status: "failed", errorClass: "provider_rate_limit" },
      outcomeClass: "failed_recoverable",
      tokens: { prompt: 120, completion: 80 },
      artifactAvailable: false,
    };
    expect(answer.status).toBe("running");
    expect(answer.lastAttempt?.attemptNo).toBe(2);
    expect(answer.outcomeClass).toBe("failed_recoverable");
    expect(answer.artifactAvailable).toBe(false);
  });
});
