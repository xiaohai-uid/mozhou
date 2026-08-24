// code-review 修复轮：fullPayloadSections + assembler 双预算 + narrative_style 方法参考
import { describe, it, expect } from "vitest";
import { fullPayloadSections } from "@/lib/runtime/generation-manifest";
import { assembleSkillSections, type SkillOutputWithRun } from "@/lib/runtime/context-assembler";
import { renderStyleNote } from "@/lib/runtime/executors/narrative-style";
import type { SkillDefinition } from "@/lib/runtime/types";

describe("fullPayloadSections（code-review 修复：manifest 反映精确载荷）", () => {
  it("必选 base_identity/mode_contract 在组装区段之前", () => {
    const sections = fullPayloadSections("chapter", [{ kind: "owner_context", content: "x" }]);
    expect(sections.map((s) => s.kind)).toEqual(["base_identity", "mode_contract", "owner_context"]);
    expect(sections[0]!.content).toContain("墨舟");
    expect(sections[1]!.content).toContain("章节写作对话模式");
  });
});

describe("assembleSkillSections 双重预算（契约 §7）", () => {
  const def: SkillDefinition = {
    key: "story_grounding", name: "故事状态", description: "", role: "story_grounding",
    kind: "context", trigger: "pre_write", enabled: true, priority: 10, tokenBudget: 1200,
    executor: "story_grounding", builtin: true,
    input: { sources: [] }, output: { artifactKind: "context_pack", structured: true },
  };
  function output(longNote: string): SkillOutputWithRun {
    return {
      definition: def,
      runId: "r-1",
      output: {
        status: "completed",
        artifact: {
          kind: "context_pack",
          tokenEstimate: 1000,
          data: { entries: [{ kind: "character", name: "阿雀", note: longNote }], tracking: null },
        },
      },
    };
  }

  it("plan.contextBudget.perSection 更严时按 plan 预算裁剪", () => {
    const longNote = "秘密".repeat(200); // 400+ 字符
    const { sections } = assembleSkillSections([output(longNote)], { story_grounding: 20 }); // 20 token → 40 字符
    expect(sections).toHaveLength(1);
    expect(sections[0]!.culled).toBe(true);
    expect(sections[0]!.section.content.length).toBeLessThanOrEqual(40);
  });

  it("无 plan 预算时按 tokenBudget 裁剪（默认行为不变）", () => {
    const longNote = "秘密".repeat(1500);
    const { sections } = assembleSkillSections([output(longNote)]);
    expect(sections[0]!.culled).toBe(true);
    expect(sections[0]!.section.content.length).toBeLessThanOrEqual(2400);
  });
});

describe("renderStyleNote 方法参考（code-review 修复：narrative_style 消费 BenchmarkPack）", () => {
  it("绑定方法并入 style_note（只含抽象方法）", () => {
    const text = renderStyleNote({
      name: "注入测试风格",
      guide: { narrative: "N", sentence: "S", imagery: "I", rhythm: "R" },
      methods: ["信息差悬念", "章尾钩子"],
    });
    expect(text).toContain("[风格] 注入测试风格");
    expect(text).toContain("方法参考（BenchmarkPack）：信息差悬念、章尾钩子");
  });

  it("无方法参考 → 原格式不变", () => {
    const text = renderStyleNote({ name: "x", guide: { narrative: "N", sentence: "S", imagery: "I", rhythm: "R" }, methods: [] });
    expect(text).not.toContain("方法参考");
  });
});
