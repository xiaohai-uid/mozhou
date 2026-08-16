import { describe, expect, it } from "vitest";
import { getBackNavigationMode } from "@/lib/navigation/back";

describe("创作台返回导航", () => {
  it("从应用内其他页面进入创作台时使用浏览器历史返回", () => {
    expect(getBackNavigationMode({ historyLength: 2, fallback: "/workspace" })).toBe("history");
  });

  it("直接打开创作台且没有上一级时回到稳定入口", () => {
    expect(getBackNavigationMode({ historyLength: 1, fallback: "/workspace" })).toBe("fallback");
  });
});
