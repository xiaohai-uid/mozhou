// SkillRun 状态机 + GenerationPlan 构建（契约 §4/§6）
import { describe, it, expect } from "vitest";
import { buildGenerationPlan, hashIntent } from "@/lib/runtime/generation-plan";
import {
  makeExecutedRun,
  makeFailedRun,
  makeSkippedRun,
  settleRunEvidence,
} from "@/lib/runtime/skill-run";
import type { SkillDefinition, SkillExecutorOutput } from "@/lib/runtime/types";

const def: SkillDefinition = {
  key: "story_grounding",
  name: "故事状态",
  description: "",
  role: "story_grounding",
  kind: "context",
  trigger: "pre_write",
  enabled: true,
  priority: 10,
  tokenBudget: 1200,
  executor: "story_grounding",
  builtin: true,
  input: { sources: [{ kind: "novel_tracking", required: true }] },
  output: { artifactKind: "context_pack", structured: true },
};

const output: SkillExecutorOutput = {
  status: "completed",
  artifact: { kind: "context_pack", data: { entries: [], tracking: null }, tokenEstimate: 8 },
};

describe("buildGenerationPlan", () => {
  it("plannedSkills 按定义顺序声明，全部 planned", () => {
    const plan = buildGenerationPlan({
      generationId: "g-1",
      request: "续写第 12 章",
      mode: "chapter",
      definitions: [def],
    });
    expect(plan.generationId).toBe("g-1");
    expect(plan.plannedSkills).toEqual([
      { skillKey: "story_grounding", trigger: "pre_write", status: "planned" },
    ]);
    expect(plan.route.mode).toBe("chapter");
    expect(plan.route.phase).toBe("generation");
    expect(plan.contextBudget.perSection.story_grounding).toBe(1200);
  });

  it("意图 hash 确定性且不可逆", () => {
    const a = buildGenerationPlan({ generationId: "g", request: "同一句话", mode: "independent", definitions: [] });
    const b = buildGenerationPlan({ generationId: "g", request: "同一句话", mode: "independent", definitions: [] });
    expect(a.intent.hash).toBe(b.intent.hash);
    expect(a.intent.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.intent.hash).not.toContain("同一句话");
  });

  it("讨论请求 → plan.route.phase = discussion", () => {
    const plan = buildGenerationPlan({ generationId: "g", request: "帮我分析剧情", mode: "independent", definitions: [] });
    expect(plan.route.phase).toBe("discussion");
  });

  it("hashIntent 与 buildGenerationPlan 一致", () => {
    expect(hashIntent("x")).toBe(buildGenerationPlan({ generationId: "g", request: "x", mode: "independent", definitions: [] }).intent.hash);
  });
});

describe("SkillRun 状态机", () => {
  const base = { runId: "r-1", generationId: "g-1", definition: def };

  it("skipped：evidence=not_applied + 可读原因", () => {
    const run = makeSkippedRun({ ...base, reason: "未绑定作品" });
    expect(run.status).toBe("skipped");
    expect(run.evidence).toBe("not_applied");
    expect(run.reason).toBe("未绑定作品");
    expect(run.promptSection).toBeNull();
  });

  it("failed：evidence=not_applied + 失败原因", () => {
    const run = makeFailedRun({ ...base, reason: "执行器抛错" });
    expect(run.status).toBe("failed");
    expect(run.evidence).toBe("not_applied");
  });

  it("executed：outputRefs 带产物引用，evidence 待裁决", () => {
    const run = makeExecutedRun({ ...base, output });
    expect(run.status).toBe("completed");
    expect(run.outputRefs).toHaveLength(1);
    expect(run.outputRefs[0]!.kind).toBe("context_pack");
    expect(run.outputRefs[0]!.provenance.source).toBe("executor:story_grounding");
    expect(run.evidence).toBe("not_applied");
  });

  it("settleRunEvidence：applied 回填 promptSection（kind+tokens，无正文）", () => {
    const run = makeExecutedRun({ ...base, output });
    const settled = settleRunEvidence(run, true, { kind: "owner_context", tokens: 8 }, null);
    expect(settled.evidence).toBe("applied");
    expect(settled.promptSection).toEqual({ kind: "owner_context", tokens: 8 });
  });

  it("settleRunEvidence：not_applied 保留原因且 promptSection 为空", () => {
    const run = makeExecutedRun({ ...base, output });
    const settled = settleRunEvidence(run, false, null, "产物未进入载荷");
    expect(settled.evidence).toBe("not_applied");
    expect(settled.promptSection).toBeNull();
    expect(settled.reason).toBe("产物未进入载荷");
  });
});
