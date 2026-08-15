// quality_gate：AI 味预检 + 报告构建（纯函数；执行器 DB 路径由 runtime-pipeline-db 覆盖）
import { describe, it, expect } from "vitest";
import { buildCheckReport, runAiPatternChecks, AI_PATTERN_MARKERS } from "@/lib/runtime/executors/quality-gate";

describe("runAiPatternChecks", () => {
  it("命中套话 → 未通过 + 可读 detail", () => {
    const [first] = runAiPatternChecks("值得注意的是，火苗没有熄灭。");
    expect(first!.ok).toBe(false);
    expect(first!.detail).toContain("值得注意的是");
    expect(first!.group).toBe("ai_pattern");
  });

  it("干净文本 → 通过", () => {
    const results = runAiPatternChecks("火苗在灰罐里静了一会儿。它没有熄灭。");
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("长句（平均 > 38 字）→ 平均句长未通过", () => {
    const longSentence = "他站在灰烬的边缘看着那一粒火苗在风中微微偏转然后伸出手去".repeat(2);
    const avg = runAiPatternChecks(longSentence).find((r) => r.name === "平均句长")!;
    expect(avg.ok).toBe(false);
  });

  it("AI_PATTERN_MARKERS 非空且稳定", () => {
    expect(AI_PATTERN_MARKERS.length).toBeGreaterThan(5);
    expect(new Set(AI_PATTERN_MARKERS).size).toBe(AI_PATTERN_MARKERS.length);
  });
});

describe("buildCheckReport", () => {
  it("全过 → summary 通过；未过 → summary 含具体项（不静默）", () => {
    const ok = { name: "字数窗口", ok: true, detail: "2400 字" };
    const fail = { name: "AI 腔套话", ok: false, detail: "命中套话：值得注意的是" };
    const report = buildCheckReport("文本", [ok], [fail as never]);
    expect(report.candidateLength).toBe(2);
    expect(report.summary).toContain("1 项未通过");
    expect(report.summary).toContain("AI 腔套话");
    expect(report.summary).toContain("命中套话");
    const allPass = buildCheckReport("文本", [ok], [{ name: "平均句长", ok: true, detail: "平均 12 字/句", group: "ai_pattern" }]);
    expect(allPass.summary).toContain("全部通过");
  });

  it("两组分开记录（consistency / ai_pattern）", () => {
    const report = buildCheckReport("文本", [{ name: "字数窗口", ok: true, detail: "x" }], [{ name: "AI 腔套话", ok: true, detail: "无套话", group: "ai_pattern" }]);
    expect(report.consistency[0]!.group).toBe("consistency");
    expect(report.aiPattern[0]!.group).toBe("ai_pattern");
  });
});
