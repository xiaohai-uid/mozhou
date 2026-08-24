/**
 * audience_genre 执行器（读者与题材 / 题材与市场参照，工单 05）。
 * 输入：market_brief（必填，作品已绑定）。
 * 输出：market_note 产物——从简报提炼题材期待/节奏密度/新进元素/差异化约束；
 * 只消费结构化摘要，不把榜单书名当正文素材（ADR-0002 决策 4/6）。
 */
import type { MarketBriefingData } from "@/lib/market/briefing-artifacts";
import { listBoundBriefings } from "@/lib/market/briefing-artifacts";
import type { ArtifactRef, SkillExecutor, SkillExecutorContext, SkillExecutorOutput } from "../types";
import { estimateTokens } from "../units";

export interface MarketNoteData {
  briefingVersion: string;
  provenance: string;
  note: string;
}

/** 从简报数据提炼市场约束（纯函数，可单测）。 */
export function buildMarketNote(data: MarketBriefingData): MarketNoteData {
  const summary = data.summary;
  const categoryHints = summary.categories.slice(0, 3)
    .map((c) => `${c.category}×${c.appearances} 本`)
    .join("、");
  const rising = summary.risers.map((r) => r.name).slice(0, 3).join("、");
  const fresh = summary.newEntries.map((r) => r.name).slice(0, 3).join("、");
  const lines: string[] = [];
  lines.push(`题材期待：当前热门 ${categoryHints || "暂无题材分布"}`);
  if (rising) lines.push(`上升最快参考：${rising}`);
  if (fresh) lines.push(`新进元素：${fresh}`);
  lines.push("差异化约束：榜单书名与素材仅作市场参照，不得作为正文素材或直接仿写");
  return {
    briefingVersion: data.version,
    provenance: `ranking-snapshot · ${data.dayCount} 日`,
    note: lines.join("；"),
  };
}

/** 渲染为 market 区段（带版本与来源，可审计）。 */
export function renderMarketNote(data: unknown): string {
  const note = (data ?? {}) as Partial<MarketNoteData>;
  if (!note.note) return "";
  return `[市场] ${note.briefingVersion ?? ""}${note.provenance ? `（${note.provenance}）` : ""}：${note.note}`;
}

export const audienceGenreExecutor: SkillExecutor = {
  async run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput> {
    if (ctx.novelId == null) {
      throw new Error("未绑定作品");
    }
    const bound = await listBoundBriefings(ctx.novelId);
    const latest = bound[0]?.artifact;
    if (!latest) {
      throw new Error("未绑定市场简报");
    }
    const data = latest.data as MarketBriefingData;
    const note = buildMarketNote(data);
    const rendered = renderMarketNote(note);
    const inputRefs: ArtifactRef[] = [{
      artifactId: latest.artifactId,
      kind: "market_brief",
      version: latest.version,
      scope: "global",
      scopeId: null,
      provenance: latest.provenance,
      tokenBudget: 0,
      culled: false,
    }];
    return {
      status: "completed",
      inputRefs,
      artifact: { kind: "market_note", data: note, tokenEstimate: estimateTokens(rendered) },
    };
  },
};
