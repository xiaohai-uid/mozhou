/**
 * GenerationPlan：模型调用之前冻结的计划（契约 §4）。
 * generationId 幂等：同一候选重试沿用同一 id → 同计划不重复落库。
 */
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { generationPlans } from "@/lib/schema";
import type { GenerationPlan, SkillDefinition } from "./types";
import { routePhase } from "./units";

export function newGenerationId(): string {
  return randomUUID();
}

export function hashIntent(request: string): string {
  return createHash("sha256").update(request).digest("hex");
}

export function buildGenerationPlan(input: {
  generationId: string;
  request: string;
  mode: "independent" | "chapter";
  definitions: SkillDefinition[];
}): GenerationPlan {
  const route = routePhase(input.request);
  const plannedSkills = input.definitions.map((d) => ({
    skillKey: d.key,
    trigger: d.trigger,
    status: "planned" as const,
  }));
  return {
    generationId: input.generationId,
    intent: {
      summary: input.request.trim().slice(0, 40),
      hash: hashIntent(input.request),
    },
    route: { mode: input.mode, phase: route.phase },
    plannedSkills,
    // 工单 01：无持久化产物；MarketBrief/BenchmarkPack 在 05/06 进入 artifactRefs。
    artifactRefs: [],
    contextBudget: {
      total: input.definitions.reduce((sum, d) => sum + d.tokenBudget, 0),
      perSection: Object.fromEntries(input.definitions.map((d) => [d.key, d.tokenBudget])),
    },
    createdAt: new Date().toISOString(),
  };
}

export async function persistGenerationPlan(input: {
  plan: GenerationPlan;
  userId: number;
  scopeType: "session" | "chapter";
  scopeId: number | null;
}): Promise<void> {
  await db
    .insert(generationPlans)
    .values({
      generationId: input.plan.generationId,
      userId: input.userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      mode: input.plan.route.mode,
      intentHash: input.plan.intent.hash,
      plan: input.plan,
      status: "planned",
    })
    .onConflictDoNothing({ target: generationPlans.generationId });
}
