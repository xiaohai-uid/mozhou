/**
 * 自定义技能（工单 08 收尾）：声明契约（kind/trigger）后进入技能运行时——
 * 经 custom_prompt 执行器产出 custom_section 区段（[技能] 名：提示词），并留下 SkillRun 证据。
 * 未声明契约的技能：不注入正式写作，UI 标记未接入（ADR-0002 决策 7）。
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills } from "@/lib/schema";
import type { SkillDefinition, SkillExecutor, SkillExecutorContext, SkillExecutorOutput, SkillInputContract } from "./types";
import { estimateTokens } from "./units";

/** 按名加载当前用户已声明契约的自定义技能（未声明契约的忽略）。 */
export async function loadCustomSkillDefinitions(
  userId: number,
  names: string[],
): Promise<SkillDefinition[]> {
  if (names.length === 0) return [];
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.userId, userId), inArray(skills.name, names)));
  return rows
    .filter((row) => row.contract != null)
    .map(toCustomSkillDefinition);
}

export function toCustomSkillDefinition(row: typeof skills.$inferSelect): SkillDefinition {
  const contract = row.contract!;
  return {
    key: "custom:" + row.name,
    name: row.name,
    description: row.description,
    role: "custom",
    kind: contract.kind,
    trigger: contract.trigger,
    enabled: true,
    priority: 60,
    tokenBudget: 800,
    executor: "custom_prompt",
    builtin: false,
    // 用户声明的 sources 为自由字符串；运行时 gate 对未知 kind 走默认分支
    input: contract.input as SkillInputContract,
    output: contract.output,
    promptText: row.systemPrompt,
  };
}

export interface CustomSectionData {
  name: string;
  prompt: string;
}

/** 渲染（与旧直拼格式一致）。 */
export function renderCustomSection(data: unknown): string {
  const section = (data ?? {}) as Partial<CustomSectionData>;
  if (!section.name || !section.prompt) return "";
  return `[技能] ${section.name}：${section.prompt}`;
}

export const customPromptExecutor: SkillExecutor = {
  async run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput> {
    const prompt = ctx.definition.promptText?.trim() ?? "";
    if (!prompt) {
      throw new Error("自定义技能缺少提示词");
    }
    const data: CustomSectionData = { name: ctx.definition.name, prompt };
    return {
      status: "completed",
      artifact: { kind: "custom_section", data, tokenEstimate: estimateTokens(prompt) },
    };
  },
};
