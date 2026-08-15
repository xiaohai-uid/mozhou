/**
 * 执行器注册表 + 内置技能定义加载。
 * 一个技能只有注册了真实执行器，才可能产生 completed 证据；否则如实 skipped。
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { skillDefinitions as skillDefinitionsTable } from "@/lib/schema";
import type { SkillDefinition, SkillExecutor } from "./types";
import { storyGroundingExecutor } from "./executors/story-grounding";

/** 已接入的执行器（工单 01：story_grounding）。 */
const EXECUTORS: Record<string, SkillExecutor> = {
  story_grounding: storyGroundingExecutor,
};

/** 未实现执行器的归属工单（证据 reason 可读）。 */
const EXECUTOR_TICKET: Record<string, string> = {
  chapter_planning: "02",
  quality_gate: "03",
  narrative_style: "04",
  audience_genre: "05",
};

export function getExecutor(key: string): SkillExecutor | undefined {
  return EXECUTORS[key];
}

export function missingExecutorReason(key: string): string {
  const ticket = EXECUTOR_TICKET[key];
  return ticket ? `执行器未接入（工单 ${ticket} 实现）` : "执行器未接入";
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
