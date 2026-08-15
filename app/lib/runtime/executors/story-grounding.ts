/**
 * story_grounding 执行器（故事状态 / 作品上下文与连续性，工单 01）。
 * 输入：novel_tracking（必填）+ rag（可选）+ chapter（可选）。
 * 输出：context_pack 产物（结构化；由 ContextAssembler 渲染为 owner_context 区段）。
 */
import type { StoryTrackingState } from "@/lib/schema";
import { retrieveContext, type RagEntry } from "@/lib/novels/rag";
import { getStoryTracking } from "@/lib/story/tracking";
import type { SkillExecutor, SkillExecutorContext, SkillExecutorOutput } from "../types";
import { estimateTokens } from "../units";

export interface ContextPackData {
  entries: RagEntry[];
  tracking: StoryTrackingState | null;
}

/** 产物渲染（与旧 RAG 直拼格式兼容：[人物]/[设定]；新增 [追踪] 行只在有追踪数据时出现）。 */
export function renderContextPack(data: unknown): string {
  const pack = (data ?? {}) as Partial<ContextPackData>;
  const lines: string[] = [];
  for (const entry of pack.entries ?? []) {
    lines.push(`[${entry.kind === "character" ? "人物" : "设定"}] ${entry.name}${entry.note ? `：${entry.note}` : ""}`);
  }
  const tracking = pack.tracking;
  if (tracking) {
    for (const c of tracking.characterStates ?? []) {
      lines.push(`[追踪] 角色状态：${c.name}——${c.state}`);
    }
    for (const p of tracking.promises ?? []) {
      lines.push(`[追踪] 伏笔：${p.text}（${p.status === "open" ? "未回收" : "已回收"}）`);
    }
    for (const t of tracking.timeline ?? []) {
      lines.push(`[追踪] 时间线：${t.text}`);
    }
    for (const k of tracking.readerKnowledge ?? []) {
      lines.push(`[追踪] 读者已知：${k.text}`);
    }
  }
  return lines.join("\n");
}

export const storyGroundingExecutor: SkillExecutor = {
  async run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput> {
    const { userId, novelId, request } = ctx;
    // 输入门在管线层已校验（novel_tracking required）；此处防御性兜底。
    if (novelId == null) {
      throw new Error("未绑定作品，无法提供故事状态");
    }
    const [entries, snapshot] = await Promise.all([
      retrieveContext(userId, request, { novelId }),
      getStoryTracking(userId, novelId),
    ]);
    const tracking = snapshot?.tracking?.state ?? null;
    const data: ContextPackData = { entries, tracking };
    const rendered = renderContextPack(data);
    if (!rendered.trim()) {
      return {
        status: "degraded",
        reason: "无可用设定与追踪数据",
        artifact: { kind: "context_pack", data, tokenEstimate: 0 },
      };
    }
    return {
      status: "completed",
      artifact: { kind: "context_pack", data, tokenEstimate: estimateTokens(rendered) },
    };
  },
};
