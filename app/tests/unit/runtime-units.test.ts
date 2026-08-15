// 运行时纯函数：token 估算 + 意图/阶段路由（契约 §1/§4）
import { describe, it, expect } from "vitest";
import { estimateTokens, routePhase } from "@/lib/runtime/units";

describe("estimateTokens", () => {
  it("空文本 → 0", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("中文按 2 字符 ≈ 1 token 上取整", () => {
    expect(estimateTokens("火苗在灰罐里")).toBe(3); // 6 字符 → 3 token
    expect(estimateTokens("你好")).toBe(1);
  });
});

describe("routePhase（阶段路由，确定性）", () => {
  it("强写作意图 → generation", () => {
    expect(routePhase("续写第 12 章").phase).toBe("generation");
    expect(routePhase("帮我润色这段").phase).toBe("generation");
    expect(routePhase("改写这一段").phase).toBe("generation");
  });

  it("讨论请求 → discussion + 可读原因", () => {
    const r = routePhase("帮我分析一下这段剧情的合理性");
    expect(r.phase).toBe("discussion");
    expect(r.reason).toContain("讨论");
  });

  it("疑问句（怎么/为什么）→ discussion", () => {
    expect(routePhase("为什么主角要这样做").phase).toBe("discussion");
    expect(routePhase("这里怎么写比较好").phase).toBe("discussion");
  });

  it("一般写作信号 → generation", () => {
    expect(routePhase("这一章让阿雀出场").phase).toBe("generation");
    expect(routePhase("写一个章尾钩子").phase).toBe("generation");
  });

  it("无信号默认 generation（保持现有链路行为）", () => {
    expect(routePhase("嗯").phase).toBe("generation");
    expect(routePhase("").phase).toBe("generation");
  });
});
