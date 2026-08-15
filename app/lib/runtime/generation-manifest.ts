/**
 * GenerationManifest：到达模型的精确载荷脱敏清单（契约 §5）。
 * 复用 payload.ts 白名单纪律：只记区段 kind + tokens、消息角色、实际应用的 SkillRun。
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { generationManifests, skillRuns as skillRunsTable } from "@/lib/schema";
import type { ChatMessage } from "@/lib/chat/payload";
import type { WritingContextSection } from "@/lib/chat/writing-context";
import type { GenerationManifest, SkillEvidence, SkillRun, SkillRunStatus } from "./types";
import { estimateTokens } from "./units";

export function buildGenerationManifest(input: {
  generationId: string;
  requestId: string;
  model: string;
  sections: WritingContextSection[];
  messageRoles: ChatMessage["role"][];
  runs: SkillRun[];
  currentUserPresent: boolean;
}): GenerationManifest {
  return {
    generationId: input.generationId,
    requestId: input.requestId,
    model: input.model,
    sections: input.sections
      .filter((section) => section.content.trim())
      .map((section) => ({ kind: section.kind, tokens: estimateTokens(section.content) })),
    messageRoles: input.messageRoles,
    skillRuns: input.runs
      .filter((run) => run.evidence === "applied")
      .map((run) => ({ runId: run.runId, skillKey: run.skillKey, evidence: run.evidence })),
    currentUserPresent: input.currentUserPresent,
    createdAt: new Date().toISOString(),
  };
}

export async function persistGenerationManifest(manifest: GenerationManifest): Promise<void> {
  await db
    .insert(generationManifests)
    .values({
      generationId: manifest.generationId,
      requestId: manifest.requestId,
      model: manifest.model,
      sections: manifest.sections,
      messageRoles: manifest.messageRoles,
      skillRunIds: manifest.skillRuns.map((run) => run.runId),
    })
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

/** 证据端点用：plan + runs + manifest 全量脱敏视图（manifest.skillRuns 以 runs 为准补齐）。 */
export async function loadGenerationManifest(generationId: string): Promise<GenerationManifest | null> {
  const [row] = await db
    .select()
    .from(generationManifests)
    .where(eq(generationManifests.generationId, generationId));
  if (!row) return null;
  const runIds = row.skillRunIds;
  const runRows = runIds.length > 0
    ? await db
        .select()
        .from(skillRunsTable)
        .where(inArray(skillRunsTable.runId, runIds))
    : [];
  const runById = new Map(runRows.map((r) => [r.runId, rowToRun(r)]));
  return {
    generationId: row.generationId,
    requestId: row.requestId,
    model: row.model,
    sections: row.sections,
    messageRoles: row.messageRoles,
    skillRuns: runIds.map((runId) => {
      const run = runById.get(runId);
      return {
        runId,
        skillKey: run?.skillKey ?? "",
        evidence: (run?.evidence ?? "not_applied") as SkillEvidence,
      };
    }),
    currentUserPresent: row.messageRoles.length > 0 && row.messageRoles[row.messageRoles.length - 1] === "user",
    createdAt: row.createdAt.toISOString(),
  };
}
