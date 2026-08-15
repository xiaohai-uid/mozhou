// 自定义技能（工单 08 收尾）：渲染/执行器纯函数 + 契约声明语义
import { describe, it, expect } from "vitest";
import { customPromptExecutor, renderCustomSection } from "@/lib/runtime/custom-skills";
import type { SkillDefinition } from "@/lib/runtime/types";

const def: SkillDefinition = {
  key: "custom:悬念铺垫检查",
  name: "悬念铺垫检查",
  description: "",
  role: "custom",
  kind: "context",
  trigger: "explicit",
  enabled: true,
  priority: 60,
  tokenBudget: 800,
  executor: "custom_prompt",
  builtin: false,
  input: { sources: [] },
  output: { artifactKind: "custom_section", structured: false },
  promptText: "写作时登记每个悬念，章节结束前必须回收或推进。",
};

describe("renderCustomSection", () => {
  it("按旧直拼格式渲染（[技能] 名：提示词）", () => {
    expect(renderCustomSection({ name: "悬念铺垫检查", prompt: "登记每个悬念" })).toBe(
      "[技能] 悬念铺垫检查：登记每个悬念",
    );
  });
  it("脏输入 → 空字符串", () => {
    expect(renderCustomSection(null)).toBe("");
    expect(renderCustomSection({ name: "x" })).toBe("");
  });
});

describe("customPromptExecutor", () => {
  it("产出 custom_section 产物（提示词进入载荷）", async () => {
    const output = await customPromptExecutor.run({
      userId: 1,
      novelId: null,
      chapterId: null,
      chapterContent: null,
      request: "续写",
      definition: def,
    });
    expect(output.status).toBe("completed");
    expect(output.artifact.kind).toBe("custom_section");
    expect((output.artifact.data as { name: string }).name).toBe("悬念铺垫检查");
    expect(output.artifact.tokenEstimate).toBeGreaterThan(0);
  });

  it("缺提示词 → 抛错（不静默）", async () => {
    await expect(
      customPromptExecutor.run({
        userId: 1,
        novelId: null,
        chapterId: null,
        chapterContent: null,
        request: "续写",
        definition: { ...def, promptText: "   " },
      }),
    ).rejects.toThrow("缺少提示词");
  });
});
