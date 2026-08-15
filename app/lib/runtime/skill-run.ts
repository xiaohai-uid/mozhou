/**
 * SkillRun：状态机 + 落库（契约 §6）。
 * runId（uuid）与 SSE done.skillRuns / 证据端点保持一致。
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { runtimeArtifacts, skillRuns as skillRunsTable } from "@/lib/schema";
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
    artifactId: input.output.artifact.artifactId ?? input.runId, // 持久化产物用 artifactId；运行期产物以 runId 为锚
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
    inputRefs: input.output.inputRefs ?? [],
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

/** 质量门摘要（generationId → check_report.summary）；候选确认路径展示检查结果用（工单 03 收尾）。 */
export async function listQualityGateSummaries(
  generationKeys: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (generationKeys.length === 0) return map;
  const rows = await db
    .select()
    .from(skillRunsTable)
    .where(
      and(
        eq(skillRunsTable.skillKey, "quality_gate"),
        inArray(skillRunsTable.generationId, generationKeys),
      ),
    );
  const artifactIds = [...new Set(rows.flatMap((r) => r.outputRefs.map((ref) => ref.artifactId)))];
  const artifacts = artifactIds.length > 0
    ? await db
        .select()
        .from(runtimeArtifacts)
        .where(inArray(runtimeArtifacts.artifactId, artifactIds))
    : [];
  const summaryById = new Map(
    artifacts.map((a) => [a.artifactId, (a.data as { summary?: string } | null)?.summary ?? ""]),
  );
  for (const row of rows) {
    const summary = row.outputRefs[0] ? summaryById.get(row.outputRefs[0]!.artifactId) : undefined;
    if (summary) map.set(row.generationId, summary);
  }
  return map;
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
