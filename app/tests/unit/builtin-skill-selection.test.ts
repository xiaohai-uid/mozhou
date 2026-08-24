import { describe, expect, it } from "vitest";
import { selectBuiltinDefinitions, TOGGLEABLE_BUILTIN_KEYS } from "@/lib/runtime/skill-registry";
import type { SkillDefinition } from "@/lib/runtime/types";

function def(key: string, name: string, enabled = true): SkillDefinition {
  return {
    key,
    name,
    description: "",
    role: key as SkillDefinition["role"],
    kind: key === "quality_gate" ? "validator" : "context",
    trigger: key === "quality_gate" ? "post_write" : "pre_write",
    enabled,
    priority: 10,
    tokenBudget: 100,
    executor: key,
    builtin: true,
    input: { sources: [] },
    output: { artifactKind: "context_pack", structured: true },
  };
}

const SEED = [
  def("story_grounding", "故事状态"),
  def("chapter_planning", "章节规划"),
  def("audience_genre", "读者与题材"),
  def("narrative_style", "叙事声音"),
  def("quality_gate", "成稿质量门"),
];

describe("selectBuiltinDefinitions（选项乙：真实开关）", () => {
  it("基础设施型内置技能不受选择控制，始终注入", () => {
    for (const selected of [[], ["章节规划"], ["章节规划", "叙事声音", "读者与题材"]]) {
      const keys = selectBuiltinDefinitions(SEED, selected).map((d) => d.key);
      expect(keys).toContain("story_grounding");
      expect(keys).toContain("quality_gate");
    }
  });

  it("开关型内置技能未选中即不注入，选中才注入（按显示名）", () => {
    const keys = selectBuiltinDefinitions(SEED, []).map((d) => d.key);
    expect(keys).not.toContain("chapter_planning");
    expect(keys).not.toContain("audience_genre");
    expect(keys).not.toContain("narrative_style");

    const withPlanning = selectBuiltinDefinitions(SEED, ["章节规划"]).map((d) => d.key);
    expect(withPlanning).toContain("chapter_planning");
    expect(withPlanning).not.toContain("narrative_style");
  });

  it("enabled=false 的技能一律不注入（管理端开关优先于用户选择）", () => {
    const seed = [...SEED.slice(0, 1), def("chapter_planning", "章节规划", false)];
    const keys = selectBuiltinDefinitions(seed, ["章节规划"]).map((d) => d.key);
    expect(keys).toEqual(["story_grounding"]);
  });

  it("开关清单恰好是三个非基础设施技能", () => {
    expect([...TOGGLEABLE_BUILTIN_KEYS].sort()).toEqual([
      "audience_genre",
      "chapter_planning",
      "narrative_style",
    ]);
  });
});
