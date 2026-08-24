/**
 * 运行时纯函数：token 估算 + 意图/阶段路由。
 * 契约：.scratch/mozhou-workbench-a/contracts/01-技能运行时契约.md §1/§4
 */

/** 中文为主文本的粗略 token 估算（2 字符 ≈ 1 token；空文本 0）。 */
export function estimateTokens(text: string): number {
  const length = text.trim().length;
  if (length === 0) return 0;
  return Math.max(1, Math.ceil(length / 2));
}

export type RuntimePhase = "generation" | "discussion";

export interface PhaseRoute {
  phase: RuntimePhase;
  reason: string;
}

/** 强写作意图词：命中即按生成处理（不受讨论词干扰）。 */
const STRONG_GENERATION_HINTS = [
  "续写", "改写", "润色", "起笔", "扩写", "重写", "接着写", "继续写",
  "写正文", "生成正文", "更新正文", "写这一章", "写一章", "重写这段",
];

/** 一般写作信号词。 */
const GENERATION_HINTS = ["写", "生成", "让", "出场", "这一章", "章节", "开篇", "第一章", "正文", "草稿", "初稿", "结尾", "钩子", "下一章"];

/** 讨论信号词。 */
const DISCUSSION_HINTS = ["分析", "讨论", "建议", "参考", "评价", "解释", "对比", "构思", "设定", "大纲", "剧情", "规划", "思路", "问题", "看法", "意见", "是否", "应该", "可以吗", "说说", "讲讲"];

/** 疑问标记：存在且无强写作词时按讨论处理。 */
const QUESTION_MARKERS = ["怎么", "如何", "为什么", "吗", "呢", "？", "?"];

/**
 * 阶段路由（确定性、可单测）。只影响 GenerationPlan/SkillRun 证据语义，
 * 不改变是否调用模型（模型调用语义沿用现有 mode contract）。
 */
export function routePhase(request: string): PhaseRoute {
  const text = request.trim();
  if (!text) return { phase: "generation", reason: "空意图按生成处理" };
  const hasStrong = STRONG_GENERATION_HINTS.some((h) => text.includes(h));
  if (hasStrong) return { phase: "generation", reason: "明确写作意图（续写/改写/润色等）" };
  const disHits = DISCUSSION_HINTS.filter((h) => text.includes(h)).length;
  const genHits = GENERATION_HINTS.filter((h) => text.includes(h)).length;
  const hasQuestion = QUESTION_MARKERS.some((m) => text.includes(m));
  // 疑问句：无强写作词时一律按讨论处理（讨论词不必命中）
  if (hasQuestion) {
    return { phase: "discussion", reason: "当前请求是剧情讨论，不生成正文" };
  }
  if (disHits > genHits) {
    return { phase: "discussion", reason: "当前请求是剧情讨论，不生成正文" };
  }
  if (genHits > 0) return { phase: "generation", reason: "检测到写作意图" };
  return { phase: "generation", reason: "未检测到讨论信号，按生成处理" };
}
