/**
 * SkillRun：状态机 + 落库（契约 §6）。
 * runId（uuid）与 SSE done.skillRuns / 证据端点保持一致。
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { skillRuns as skillRunsTable } from "@/lib/schema";
import type {
  ArtifactRef,
  SkillDefinition,
  SkillEvidence,
  SkillExecutorOutput,
  SkillRun,
  SkillRunStatus,
} from "./types";

export function newRunId(): string {
  return randomUUID();
}

export interface RunInputs {
  runId: string;
  generationId: string;
  definition: SkillDefinition;
}

export function makeSkippedRun(input: RunInputs & { reason: string }): SkillRun {
  return {
    runId: input.runId,
    generationId: input.generationId,
    skillKey: input.definition.key,
    status: "skipped",
    inputRefs: [],
    outputRefs: [],
    promptSection: null,
    evidence: "not_applied",
    reason: input.reason,
    executedAt: new Date().toISOString(),
  };
}

export function makeFailedRun(input: RunInputs & { reason: string }): SkillRun {
  return {
    runId: input.runId,
    generationId: input.generationId,
    skillKey: input.definition.key,
    status: "failed",
    inputRefs: [],
    outputRefs: [],
    promptSection: null,
    evidence: "not_applied",
    reason: input.reason,
    executedAt: new Date().toISOString(),
  };
}

export function makeExecutedRun(
  input: RunInputs & { output: SkillExecutorOutput },
): SkillRun {
  const artifactRef: ArtifactRef = {
    artifactId: input.runId, // 运行期产物以 runId 为引用锚
    kind: input.output.artifact.kind,
    version: "run",
    scope: "novel",
    scopeId: null,
    provenance: {
      source: `executor:${input.definition.executor}`,
      capturedAt: new Date().toISOString(),
    },
    tokenBudget: input.definition.tokenBudget,
    culled: false,
  };
  return {
    runId: input.runId,
    generationId: input.generationId,
    skillKey: input.definition.key,
    status: input.output.status,
    inputRefs: [],
    outputRefs: [artifactRef],
    promptSection: null,
    evidence: "not_applied", // 由 assembler 裁决后回填
    reason: input.output.reason ?? null,
    executedAt: new Date().toISOString(),
  };
}

/** 用 assembler 裁决结果回填 evidence / promptSection / outputRefs.culled。 */
export function settleRunEvidence(
  run: SkillRun,
  applied: boolean,
  promptSection: { kind: string; tokens: number } | null,
  reason: string | null,
  culled = false,
): SkillRun {
  return {
    ...run,
    evidence: (applied ? "applied" : "not_applied") as SkillEvidence,
    promptSection,
    reason: reason ?? run.reason,
    outputRefs: run.outputRefs.map((ref) => ({ ...ref, culled: applied ? culled : ref.culled })),
  };
}

export async function persistSkillRuns(runs: SkillRun[]): Promise<void> {
  if (runs.length === 0) return;
  await db
    .insert(skillRunsTable)
    .values(
      runs.map((run) => ({
        runId: run.runId,
        generationId: run.generationId,
        skillKey: run.skillKey,
        status: run.status,
        inputRefs: run.inputRefs,
        outputRefs: run.outputRefs,
        promptSection: run.promptSection,
        evidence: run.evidence,
        reason: run.reason,
        tokens: run.promptSection?.tokens ?? 0,
      })),
    )
    .onConflictDoNothing();
}

function rowToRun(row: typeof skillRunsTable.$inferSelect): SkillRun {
  return {
    runId: row.runId,
    generationId: row.generationId,
    skillKey: row.skillKey,
    status: row.status as SkillRunStatus,
    inputRefs: row.inputRefs,
    outputRefs: row.outputRefs,
    promptSection: row.promptSection,
    evidence: row.evidence as SkillEvidence,
    reason: row.reason,
    executedAt: row.executedAt.toISOString(),
  };
}

/** 复用候选（同 generationKey 重试）时读取既有证据。 */
export async function listSkillRunsByGeneration(generationId: string): Promise<SkillRun[]> {
  const rows = await db
    .select()
    .from(skillRunsTable)
    .where(eq(skillRunsTable.generationId, generationId))
    .orderBy(skillRunsTable.id);
  return rows.map(rowToRun);
}
