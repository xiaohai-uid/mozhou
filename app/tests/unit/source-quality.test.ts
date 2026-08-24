import { describe, it, expect } from "vitest";
import { containsPua, filterPua } from "@/lib/source/quality";

describe("书源 PUA 质量门", () => {
  it("私用区字符（U+E000–U+F8FF）被检出", () => {
    expect(containsPua("惹\uE0D2枝")).toBe(true);
    expect(containsPua("攀\uE85E枝")).toBe(true);
    expect(containsPua("灰烬有籽")).toBe(false);
    expect(containsPua("笨蛋美人替嫁后被疯批王爷宠上天")).toBe(false);
  });

  it("filterPua 剔除含 PUA 的候选，保留干净候选", () => {
    const rows = [
      { name: "惹\uE0D2枝" },
      { name: "灰烬有籽" },
      { name: "攀\uE85E枝" },
    ];
    expect(filterPua(rows)).toEqual([{ name: "灰烬有籽" }]);
  });

  it("全部候选含 PUA 时返回空数组（调用方应降级）", () => {
    expect(filterPua([{ name: "a\uE000" }, { name: "b\uF8FF" }])).toEqual([]);
  });
});
