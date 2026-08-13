import { describe, expect, it } from "vitest";
import {
  classifyProviderResponse,
  runStructuredDeconstruction,
  type ProviderCallResult,
} from "@/lib/story/deconstruction-pipeline";

const validResult = {
  structure: ["开场"],
  plot: ["推进"],
  rhythm: ["收紧"],
  mode: "short",
  stages: [
    { stage: 0, name: "概要与章节边界", status: "completed", artifact: { id: "s0", kind: "overview", schemaVersion: 1, premise: "p", chapterCount: 1, chapterIndex: [] } },
    { stage: 2, name: "逐章摘要", status: "completed", artifact: { id: "s2", kind: "chapters", schemaVersion: 1, chapters: [] } },
    { stage: 3, name: "剧情聚合", status: "completed", artifact: { id: "s3", kind: "plot", schemaVersion: 1, mainline: "m", subplots: [], units: [], foreshadowing: [], emotionCurve: [], coverage: 1 } },
    { stage: 4, name: "设定与关系", status: "completed", artifact: { id: "s4", kind: "world", schemaVersion: 1, characters: [], worldview: [], factions: [], relationships: [] } },
    { stage: 5, name: "汇总报告", status: "completed", artifact: { id: "s5", kind: "aggregate", schemaVersion: 1, readerNeeds: [], emotionEngine: "e", writingTechniques: [], replicableModules: [], risks: [] } },
    { stage: 6, name: "文风", status: "completed", artifact: { id: "s6", kind: "style", schemaVersion: 1, sentence: "s", rhythm: "r", dialogue: "d", emotion: "e", techniques: [] } },
  ],
  quality: { sourceLength: 200, chapterCount: 1, completedStages: [0, 2, 3, 4, 5, 6], warnings: [] },
};

const json = (value: unknown): ProviderCallResult => ({ kind: "success", raw: JSON.stringify(value), usage: {} });

describe("deconstruction provider/workflow contract", () => {
  it.each([
    [{ status: 429 }, "rate_limit"],
    [{ status: 503 }, "provider_5xx"],
    [{ status: 400 }, "provider_4xx"],
  ] as const)("classifies HTTP failure %j", (response, expected) => {
    expect(classifyProviderResponse(response)).toBe(expected);
  });

  it("repairs invalid JSON at most once and completes only after validation", async () => {
    const calls: string[] = [];
    const result = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async ({ repair }) => {
        calls.push(repair ? "repair" : "initial");
        return repair ? json(validResult) : { kind: "success", raw: "not-json", usage: {} };
      },
    });
    expect(result.workflow).toBe("completed");
    expect(result.structured).toBe("valid");
    expect(calls).toEqual(["initial", "repair"]);
    expect(result.result?.stages).toHaveLength(6);
  });

  it("rejects a provider object whose stages omit numeric stage ids", async () => {
    const missingStageIds = structuredClone(validResult);
    missingStageIds.stages = missingStageIds.stages.map((stage) => {
      const copy = structuredClone(stage) as Record<string, unknown>;
      delete copy.stage;
      return copy as never;
    });
    const result = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async ({ repair }) => repair ? json(missingStageIds) : json(missingStageIds),
    });
    expect(result.workflow).toBe("failed_recoverable");
    expect(result.structured).toBe("repair_failed");
  });

  it("normalizes one deterministic provider answer envelope before validating", async () => {
    const result = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async () => json({ answer: validResult }),
    });
    expect(result.workflow).toBe("completed");
    expect(result.structured).toBe("valid");
  });

  it("derives legacy projections only from validated stage fields", async () => {
    const stagedOnly = structuredClone(validResult);
    delete (stagedOnly as Record<string, unknown>).structure;
    delete (stagedOnly as Record<string, unknown>).plot;
    delete (stagedOnly as Record<string, unknown>).rhythm;
    const result = await runStructuredDeconstruction({ mode: "short", sourceLength: 200, request: async () => json(stagedOnly) });
    expect(result.workflow).toBe("completed");
    expect(result.result?.structure).toEqual(["p"]);
    expect(result.result?.plot).toEqual(["m"]);
    expect(result.result?.rhythm).toEqual(["r"]);
  });

  it("fails closed when repair remains invalid and never marks completed", async () => {
    const calls: string[] = [];
    const result = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async ({ repair }) => {
        calls.push(repair ? "repair" : "initial");
        return { kind: "success", raw: "not-json", usage: {} };
      },
    });
    expect(result.workflow).toBe("failed_recoverable");
    expect(result.structured).toBe("repair_failed");
    expect(calls).toEqual(["initial", "repair"]);
    expect(result.result).toBeUndefined();
  });

  it("distinguishes schema-invalid output from invalid JSON", async () => {
    const invalidSchema = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async ({ repair }) => repair ? json({ ...validResult, stages: [] }) : json({ ...validResult, stages: [] }),
    });
    expect(invalidSchema.workflow).toBe("failed_recoverable");
    expect(invalidSchema.structured).toBe("repair_failed");
    expect(invalidSchema.errorClass).toBe("repair_failed");
  });

  it("fails closed on artifact quality violations", async () => {
    const qualityInvalid = structuredClone(validResult);
    qualityInvalid.quality.chapterCount = 0;
    const result = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async () => json(qualityInvalid),
    });
    expect(result.workflow).toBe("failed_recoverable");
    expect(result.structured).toBe("repair_failed");
    expect(result.errorClass).toBe("artifact_quality_failed");
  });

  it.each([
    ["network", "provider_network"],
    ["rate_limit", "provider_rate_limit"],
    ["provider_5xx", "provider_unavailable"],
    ["protocol_error", "provider_protocol"],
  ] as const)("classifies transport %s as %s", async (kind, errorClass) => {
    const result = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async () => ({ kind } as const),
    });
    expect(result.errorClass).toBe(errorClass);
    expect(result.workflow).toBe(kind === "protocol_error" ? "failed_terminal" : "failed_recoverable");
  });

  it("classifies timeout and network failures without leaking raw provider output", async () => {
    const timeout = await runStructuredDeconstruction({
      mode: "short",
      sourceLength: 200,
      request: async () => ({ kind: "timeout", raw: "secret provider body" }),
    });
    expect(timeout.workflow).toBe("failed_recoverable");
    expect(timeout.transport).toBe("timeout");
    expect(timeout.errorClass).toBe("provider_timeout");
    expect(JSON.stringify(timeout)).not.toContain("secret provider body");
  });
});
