import { describe, it, expect } from "vitest";
import { revisionAfterSave } from "@/lib/novels/save-conflict";

describe("revisionAfterSave —— 保存基准 revision 决策（契约§24）", () => {
  it("409 冲突：保留过期基准（null 保持 null）——后续保存持续 409 逼出人工对账", () => {
    expect(revisionAfterSave(null, 7, true)).toBeNull();
  });

  it("409 冲突：保留过期基准（数字保持原值），即使响应带了服务器 revision", () => {
    expect(revisionAfterSave(5, 7, true)).toBe(5);
  });

  it("保存成功：采纳服务器行 revision", () => {
    expect(revisionAfterSave(5, 6, false)).toBe(6);
  });

  it("保存成功但响应缺 revision 字段：保持原基准", () => {
    expect(revisionAfterSave(5, undefined, false)).toBe(5);
  });

  it("初始加载/插入成功：从 null 建立基准", () => {
    expect(revisionAfterSave(null, 0, false)).toBe(0);
  });
});
