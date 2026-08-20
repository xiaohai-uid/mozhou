/**
 * 执行器注册表 + 内置技能定义加载。
 * 一个技能只有注册了真实执行器，才可能产生 completed 证据；否则如实 skipped。
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { skillDefinitions as skillDefinitionsTable } from "@/lib/schema";
import type { SkillDefinition, SkillExecutor } from "./types";
import { storyGroundingExecutor } from "./executors/story-grounding";
import { chapterPlanningExecutor } from "./executors/chapter-planning";
import { qualityGateExecutor } from "./executors/quality-gate";
import { narrativeStyleExecutor } from "./executors/narrative-style";
import { audienceGenreExecutor } from "./executors/audience-genre";
import { customPromptExecutor } from "./custom-skills";
import { hasBoundBriefing } from "@/lib/market/briefing-artifacts";
import type { SkillExecutorContext } from "./types";

/** 已接入的执行器。 */
const EXECUTORS: Record<string, SkillExecutor> = {
  story_grounding: storyGroundingExecutor,
  chapter_planning: chapterPlanningExecutor,
  quality_gate: qualityGateExecutor,
  narrative_style: narrativeStyleExecutor,
  audience_genre: audienceGenreExecutor,
  custom_prompt: customPromptExecutor,
};

/**
 * 执行前置条件（async 输入门）：返回 skip 原因或 null。
 * 冻结的输入门（checkInputGate）管同步字段；本表管需要查询的绑定关系。
 */
export const SKILL_PRECONDITIONS: Record<string, (ctx: SkillExecutorContext) => Promise<string | null>> = {
  audience_genre: async (ctx) => {
    if (ctx.novelId == null) return "未绑定作品";
    return (await hasBoundBriefing(ctx.novelId)) ? null : "未绑定市场简报";
  },
};

export function getExecutor(key: string): SkillExecutor | undefined {
  return EXECUTORS[key];
}

export function missingExecutorReason(): string {
  return "执行器未注册";
}

export function isExecutorConnected(key: string): boolean {
  return Boolean(EXECUTORS[key]);
}

function rowToDefinition(row: typeof skillDefinitionsTable.$inferSelect): SkillDefinition {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    role: row.role as SkillDefinition["role"],
    kind: row.kind as SkillDefinition["kind"],
    trigger: row.trigger as SkillDefinition["trigger"],
    enabled: row.enabled,
    priority: row.priority,
    tokenBudget: row.tokenBudget,
    executor: row.executor,
    builtin: row.builtin,
    input: row.inputContract,
    output: row.outputContract,
    promptText: row.promptText,
  };
}

/** 加载全部内置（builtin=true）技能定义，按 priority 升序。 */
export async function loadBuiltinSkillDefinitions(): Promise<SkillDefinition[]> {
  const rows = await db
    .select()
    .from(skillDefinitionsTable)
    .where(eq(skillDefinitionsTable.builtin, true))
    .orderBy(skillDefinitionsTable.priority);
  return rows.map(rowToDefinition);
}
