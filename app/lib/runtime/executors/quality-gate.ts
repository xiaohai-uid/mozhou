/**
 * quality_gate 执行器（成稿质量门 / 连续性与质量门，工单 03）。
 * post_write 校验：候选生成后、确认前运行；两组检查**分开记录**（契约 §2 互斥边界）：
 * - consistency 组：复用 runWritingChecks（字数/占位符/泄密/实体登记/复读/合同断言；实体库取角色状态）
 * - ai_pattern 组：AI 腔套话 + 平均句长（独立于叙事声音阶段）
 * 结果落 runtime_artifacts（kind=check_report），SkillRun.outputRefs 指向 artifactId（证据可查）。
 * 规则化实现（不调用模型）：不通过给出具体返工原因，不静默放行。
 */
import { getStoryTracking } from "@/lib/story/tracking";
import { runWritingChecks, type WritingCheckResult } from "@/lib/story/checks";
import { persistRuntimeArtifact } from "../artifacts";
import type { SkillExecutor, SkillExecutorContext, SkillExecutorOutput } from "../types";
import { estimateTokens } from "../units";

/** AI 腔套话语料（去 AI 味预检；随产品迭代扩充）。 */
export const AI_PATTERN_MARKERS = [
  "值得注意的是", "总而言之", "不仅如此", "首先", "其次", "最后", "总的来说",
  "综上所述", "众所周知", "值得一提的是", "不禁", "仿佛", "宛如", "引发共鸣",
  "代入感", "让人眼前一亮", "令人印象深刻",
];

export interface AiPatternCheckResult extends WritingCheckResult {
  group: "ai_pattern";
}

export interface ConsistencyCheckResult extends WritingCheckResult {
  group: "consistency";
}

export interface CheckReport {
  candidateLength: number;
  consistency: ConsistencyCheckResult[];
  aiPattern: AiPatternCheckResult[];
  /** 一组一行：通过数/总数 + 未过项（用户可读）。 */
  summary: string;
}

/** AI 味预检（纯函数，可单测）：套话命中 + 平均句长。 */
export function runAiPatternChecks(text: string): AiPatternCheckResult[] {
  const found = AI_PATTERN_MARKERS.filter((marker) => text.includes(marker));
  const sentences = text.split(/[。！？!?；;\n]/).filter((s) => s.trim().length > 0);
  const avg =
    sentences.length > 0
      ? Math.round(sentences.reduce((sum, s) => sum + s.trim().length, 0) / sentences.length)
      : 0;
  return [
    {
      group: "ai_pattern",
      name: "AI 腔套话",
      ok: found.length === 0,
      detail: found.length > 0 ? `命中套话：${found.slice(0, 5).join(" / ")}` : "无套话",
    },
    {
      group: "ai_pattern",
      name: "平均句长",
      ok: avg <= 38,
      detail: `平均 ${avg} 字/句（阈值 38）`,
    },
  ];
}

export function buildCheckReport(
  candidate: string,
  consistency: WritingCheckResult[],
  aiPattern: AiPatternCheckResult[],
): CheckReport {
  const all = [...consistency, ...aiPattern];
  const failed = all.filter((c) => !c.ok);
  const summary =
    failed.length === 0
      ? `全部通过（${consistency.length} 项一致性 + ${aiPattern.length} 项 AI 味预检）`
      : `${failed.length} 项未通过：${failed.map((c) => `${c.name}（${c.detail}）`).join("；")}`;
  return {
    candidateLength: candidate.length,
    consistency: consistency.map((c) => ({ ...c, group: "consistency" as const })),
    aiPattern,
    summary,
  };
}

export const qualityGateExecutor: SkillExecutor = {
  async run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput> {
    const candidate = ctx.candidate?.trim() ?? "";
    if (!candidate) {
      throw new Error("无候选正文，质量门无法运行");
    }
    // 实体库：角色状态名（一致性组「实体登记」用）
    const snapshot = ctx.novelId != null ? await getStoryTracking(ctx.userId, ctx.novelId).catch(() => null) : null;
    const knownEntities = snapshot?.tracking?.state?.characterStates.map((c) => c.name) ?? [];
    try {
      const consistency = runWritingChecks(candidate, { knownEntities });
      const aiPattern = runAiPatternChecks(candidate);
      const report = buildCheckReport(candidate, consistency, aiPattern);
      const artifactId = await persistRuntimeArtifact({
        kind: "check_report",
        scope: ctx.chapterId != null ? "chapter" : "novel",
        scopeId: ctx.chapterId ?? ctx.novelId,
        source: "executor:quality_gate",
        data: report,
      });
      return {
        status: "completed",
        artifact: {
          kind: "check_report",
          artifactId,
          data: report,
          tokenEstimate: estimateTokens(report.summary),
        },
      };
    } catch (err) {
      return {
        status: "degraded",
        reason: `质量门降级：${(err as Error).message}`,
        artifact: { kind: "check_report", data: null, tokenEstimate: 0 },
      };
    }
  },
};
