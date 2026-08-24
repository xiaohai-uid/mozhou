// ContextAssembler：唯一载荷决策组件（契约 §7）
import { describe, it, expect } from "vitest";
import {
  assembleSkillSections,
  type SkillOutputWithRun,
} from "@/lib/runtime/context-assembler";
import type { SkillDefinition, SkillExecutorOutput } from "@/lib/runtime/types";

const groundingDef: SkillDefinition = {
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

function output(overrides: Partial<SkillExecutorOutput["artifact"]> = {}): SkillOutputWithRun {
  return {
    definition: groundingDef,
    runId: "run-1",
    output: {
      status: "completed",
      artifact: {
        kind: "context_pack",
        tokenEstimate: 10,
        data: {
          entries: [{ kind: "character", name: "阿雀", note: "知道火苗的秘密" }],
          tracking: null,
        },
        ...overrides,
      },
    },
  };
}

describe("assembleSkillSections", () => {
  it("context_pack → owner_context 区段（格式与旧 RAG 直拼兼容）", () => {
    const { sections } = assembleSkillSections([output()]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.section.kind).toBe("owner_context");
    expect(sections[0]!.section.content).toContain("[人物] 阿雀：知道火苗的秘密");
    expect(sections[0]!.runId).toBe("run-1");
    expect(sections[0]!.tokens).toBeGreaterThan(0);
    expect(sections[0]!.culled).toBe(false);
  });

  it("token 预算裁剪：超出 budget 截断并标记 culled（不静默）", () => {
    const longNote = "秘密".repeat(1500); // 3000+ 字符，超出 1200 token（2400 字符）预算
    const { sections } = assembleSkillSections([
      output({ data: { entries: [{ kind: "character", name: "阿雀", note: longNote }], tracking: null } }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.culled).toBe(true);
    // 2 字符 ≈ 1 token：1200 budget → 2400 字符上限
    expect(sections[0]!.section.content.length).toBeLessThanOrEqual(2400);
  });

  it("空产物 → 不产生区段（调用方按 not_applied 处理）", () => {
    const { sections } = assembleSkillSections([
      output({ data: { entries: [], tracking: null }, tokenEstimate: 0 }),
    ]);
    expect(sections).toHaveLength(0);
  });

  it("未注册渲染器的产物类型 → 不进入载荷", () => {
    const { sections } = assembleSkillSections([
      output({ kind: "chapter_task_card", data: { x: 1 }, tokenEstimate: 5 }),
    ]);
    expect(sections).toHaveLength(0);
  });
});
