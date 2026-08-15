/**
 * chapter_planning 执行器（章节规划 / 结构与节奏，工单 02）。
 * 输入：novel_tracking（必填）+ chapter（可选）。
 * 输出：chapter_task_card 产物（结构化；由 ContextAssembler 渲染为 planner 区段）。
 * 规则化派生（不调用模型）：冲突推进/伏笔铺垫/章尾钩子从追踪状态提炼；
 * 无追踪数据 → degraded（不伪造任务卡）。
 */
import { getStoryTracking } from "@/lib/story/tracking";
import { getBoundBenchmarkPack } from "@/lib/story/benchmark-packs";
import type { StoryTrackingState } from "@/lib/schema";
import type { ArtifactRef, SkillExecutor, SkillExecutorContext, SkillExecutorOutput } from "../types";
import { estimateTokens } from "../units";

export interface ChapterTaskCard {
  chapter: { id: number | null; title: string | null; ch: string | null };
  emotionalGoal: string | null;
  conflictPush: string[];
  payoffSetup: string[];
  chapterHook: string[];
  sourceSummary: string;
  /** BenchmarkPack 抽象方法参考（工单 06；只含方法，不含原文）。 */
  methodHints: string[];
}

const EMPTY_CARD: ChapterTaskCard = {
  chapter: { id: null, title: null, ch: null },
  emotionalGoal: null,
  conflictPush: [],
  payoffSetup: [],
  chapterHook: [],
  sourceSummary: "",
  methodHints: [],
};

/** 从追踪状态派生任务卡（纯函数，可单测）。 */
export function buildTaskCard(
  state: StoryTrackingState | null,
  chapter: { id: number | null; title: string | null; ch: string | null },
): ChapterTaskCard {
  if (!state) return EMPTY_CARD;
  const openPromises = (state.promises ?? []).filter((p) => p.status === "open");
  const conflictPush = [
    ...state.characterStates.map((c) => `${c.name}：${c.state}`),
    ...openPromises.map((p) => p.text),
  ];
  const payoffSetup = [...state.timeline.map((t) => t.text)];
  const chapterHook = [
    ...openPromises.slice(0, 2).map((p) => p.text),
    ...state.readerKnowledge.slice(-2).map((k) => k.text),
  ];
  const settled = state.statusCard?.settledChapters ?? 0;
  const characterCount = state.characterStates.length;
  const hasData = settled > 0 || openPromises.length > 0 || characterCount > 0 || state.timeline.length > 0 || state.readerKnowledge.length > 0;
  return {
    chapter,
    emotionalGoal: null, // 情绪目标需 LLM 或用户输入，规则化不伪造
    conflictPush: [...new Set(conflictPush)],
    payoffSetup: [...new Set(payoffSetup)],
    chapterHook: [...new Set(chapterHook)],
    // 无任何数据时摘要为空 → 渲染为空 → degraded（不伪造任务卡）
    sourceSummary: hasData
      ? `${settled} 章已结算 · ${openPromises.length} 条伏笔待回收 · ${characterCount} 个角色状态`
      : "",
    methodHints: [],
  };
}

export function renderChapterTaskCard(data: unknown): string {
  const card = (data ?? {}) as Partial<ChapterTaskCard>;
  const lines: string[] = [];
  const chapterLabel =
    card.chapter?.ch && card.chapter?.title
      ? `第 ${card.chapter.ch} 章 · ${card.chapter.title}`
      : card.chapter?.title ?? null;
  if (chapterLabel) lines.push(chapterLabel);
  if (card.emotionalGoal) lines.push(`情绪目标：${card.emotionalGoal}`);
  if (card.conflictPush?.length) lines.push(`冲突推进：${card.conflictPush.join("；")}`);
  if (card.payoffSetup?.length) lines.push(`伏笔铺垫：${card.payoffSetup.join("；")}`);
  if (card.chapterHook?.length) lines.push(`章尾钩子：${card.chapterHook.join("；")}`);
  if (card.sourceSummary) lines.push(card.sourceSummary);
  if (card.methodHints?.length) {
    lines.push(`方法参考（BenchmarkPack）：${card.methodHints.slice(0, 4).join("；")}`);
  }
  return lines.join("\n");
}

export const chapterPlanningExecutor: SkillExecutor = {
  async run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput> {
    const { userId, novelId } = ctx;
    if (novelId == null) {
      throw new Error("未绑定作品，无法规划章节");
    }
    const snapshot = await getStoryTracking(userId, novelId);
    const state = snapshot?.tracking?.state ?? null;
    const card = buildTaskCard(state, {
      id: ctx.chapterId,
      title: null,
      ch: null,
    });
    // 工单 06：绑定 BenchmarkPack → 抽象方法参考（只消费方法，不消费原文）
    const boundPack = await getBoundBenchmarkPack(novelId);
    let inputRefs: ArtifactRef[] = [];
    if (boundPack) {
      const ref = (boundPack.data as { reference?: { style?: { techniques?: unknown } } })?.reference;
      const techniques = Array.isArray(ref?.style?.techniques)
        ? (ref.style.techniques as Array<unknown>).filter((t): t is string => typeof t === "string").slice(0, 4)
        : [];
      card.methodHints = techniques;
      inputRefs = [{
        artifactId: boundPack.artifactId,
        kind: "benchmark_pack",
        version: boundPack.version,
        scope: "novel",
        scopeId: novelId,
        provenance: boundPack.provenance,
        tokenBudget: 0,
        culled: false,
      }];
    }
    const rendered = renderChapterTaskCard(card);
    if (!rendered.trim()) {
      return {
        status: "degraded",
        reason: "无可用规划数据",
        artifact: { kind: "chapter_task_card", data: card, tokenEstimate: 0 },
      };
    }
    return {
      status: "completed",
      inputRefs,
      artifact: { kind: "chapter_task_card", data: card, tokenEstimate: estimateTokens(rendered) },
    };
  },
};
