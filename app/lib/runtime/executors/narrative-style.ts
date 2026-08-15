/**
 * narrative_style 执行器（叙事声音 / 文风与自然表达，工单 04）。
 * 输入：style（必填，styleId 归属校验后读取 styles 表）。
 * 输出：style_note 产物（四维风格指南的写作约束；格式与旧直拼兼容：[风格] 名：叙事视角——…）。
 * 替换 runChat/runChapterChat 的 style 直拼（不保兼容原则）。
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { styles } from "@/lib/schema";
import type { StyleGuide } from "@/lib/schema";
import type { SkillExecutor, SkillExecutorContext, SkillExecutorOutput } from "../types";
import { estimateTokens } from "../units";

export interface StyleNoteData {
  name: string;
  guide: StyleGuide;
}

/** 渲染（与旧直拼格式一致，避免消费端行为漂移）。 */
export function renderStyleNote(data: unknown): string {
  const note = (data ?? {}) as Partial<StyleNoteData>;
  if (!note.name || !note.guide) return "";
  const g = note.guide;
  return `[风格] ${note.name}：叙事视角——${g.narrative}；句式节奏——${g.sentence}；意象偏好——${g.imagery}；情绪节奏——${g.rhythm}`;
}

export const narrativeStyleExecutor: SkillExecutor = {
  async run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput> {
    if (ctx.styleId == null) {
      throw new Error("未选择风格");
    }
    const [row] = await db
      .select({ name: styles.name, guide: styles.guide })
      .from(styles)
      .where(and(eq(styles.id, ctx.styleId), eq(styles.userId, ctx.userId)));
    if (!row) {
      throw new Error("风格不存在或无权使用");
    }
    const data: StyleNoteData = { name: row.name, guide: row.guide };
    const rendered = renderStyleNote(data);
    return {
      status: "completed",
      artifact: { kind: "style_note", data, tokenEstimate: estimateTokens(rendered) },
    };
  },
};
