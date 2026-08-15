// narrative_style：style_note 渲染（格式与旧直拼一致）
import { describe, it, expect } from "vitest";
import { renderStyleNote } from "@/lib/runtime/executors/narrative-style";

describe("renderStyleNote", () => {
  it("四维指南按旧格式渲染（消费端行为不漂移）", () => {
    const text = renderStyleNote({
      name: "注入测试风格",
      guide: {
        narrative: "N-视角",
        sentence: "S-句式",
        imagery: "I-意象",
        rhythm: "R-节奏",
      },
    });
    expect(text).toBe(
      "[风格] 注入测试风格：叙事视角——N-视角；句式节奏——S-句式；意象偏好——I-意象；情绪节奏——R-节奏",
    );
  });

  it("脏输入 → 空字符串（不伪造）", () => {
    expect(renderStyleNote(null)).toBe("");
    expect(renderStyleNote({})).toBe("");
    expect(renderStyleNote({ name: "x" })).toBe("");
  });
});
