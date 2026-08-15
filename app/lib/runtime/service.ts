/**
 * 技能运行时管线编排（工单 01，tracer bullet）：
 * 阶段路由 → 计划构建（落库）→ 输入门 → 执行器执行 → ContextAssembler 组装 → SkillRun 落库。
 * 本票只注册 story_grounding 执行器；其余内置技能如实 skipped（执行器未接入）。
 */
import { eq } from "drizzle-orm";
import type { WritingContextSection } from "@/lib/chat/writing-context";
import { db } from "@/lib/db";
import { generationPlans } from "@/lib/schema";
import type { SkillDefinition, SkillExecutorContext, SkillRun } from "./types";
import { buildGenerationPlan, persistGenerationPlan } from "./generation-plan";
import { getExecutor, isExecutorConnected, missingExecutorReason } from "./skill-registry";
import { assembleSkillSections } from "./context-assembler";
import { loadGenerationManifest } from "./generation-manifest";
import { listSkillRunsByGeneration } from "./skill-run";
import {
  makeExecutedRun,
  makeFailedRun,
  makeSkippedRun,
  newRunId,
  persistSkillRuns,
  settleRunEvidence,
} from "./skill-run";
import { routePhase } from "./units";

export interface RuntimePipelineInput {
  userId: number;
  novelId: number | null;
  chapterId: number | null;
  /** 章节正文（章节模式；story_grounding 取最近正文摘要用）。 */
  chapterContent: string | null;
  request: string;
  mode: "independent" | "chapter";
  scopeType: "session" | "chapter";
  scopeId: number | null;
  /** 章节模式传 generationKey（重试幂等锚）；独立模式缺省自动生成。 */
  generationId?: string;
  definitions: SkillDefinition[];
}

export interface RuntimePipelineResult {
  generationId: string;
  plan: ReturnType<typeof buildGenerationPlan>;
  runs: SkillRun[];
  sections: WritingContextSection[];
  /** story_grounding 注入的 RAG 条目（done.injected 兼容，格式与旧直拼一致）。 */
  ragEntries: Array<{ kind: "character" | "worldview"; name: string; note: string | null }>;
  ragEntryCount: number;
}

/** 输入门：必填输入源不可用 → 该技能整轮 skipped（可读原因）。 */
function checkInputGate(
  definition: SkillDefinition,
  input: RuntimePipelineInput,
): string | null {
  for (const source of definition.input.sources) {
    if (!source.required) continue;
    switch (source.kind) {
      case "novel_tracking":
      case "rag":
        if (input.novelId == null) return "未绑定作品";
        break;
      case "chapter":
        if (input.chapterId == null) return "未进入章节上下文";
        break;
      case "candidate":
        return null; // post_write 输入门由阶段路由处理（本票未接入执行器）
      default:
        // style / market_brief / benchmark_pack：本期未接入执行器，不在此判门
        break;
    }
  }
  return null;
}

/** 讨论请求：post_write 技能不进入（无候选可校验）。 */
function isPostWriteAllowed(input: RuntimePipelineInput): boolean {
  return routePhase(input.request).phase === "generation";
}

export async function runRuntimePipeline(
  input: RuntimePipelineInput,
): Promise<RuntimePipelineResult> {
  const { randomUUID } = await import("node:crypto");
  const generationId = input.generationId?.trim() || randomUUID();
  const plan = buildGenerationPlan({
    generationId,
    request: input.request,
    mode: input.mode,
    definitions: input.definitions,
  });
  await persistGenerationPlan({
    plan,
    userId: input.userId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
  });

  const runs: SkillRun[] = [];
  const outputs: Array<{
    definition: SkillDefinition;
    output: Awaited<ReturnType<NonNullable<ReturnType<typeof getExecutor>>["run"]>>;
    runId: string;
  }> = [];
  let ragEntries: RuntimePipelineResult["ragEntries"] = [];

  for (const definition of input.definitions) {
    const runId = newRunId();
    const gateReason = checkInputGate(definition, input);
    if (gateReason) {
      runs.push(makeSkippedRun({ runId, generationId, definition, reason: gateReason }));
      continue;
    }
    if (definition.trigger === "post_write" && !isPostWriteAllowed(input)) {
      runs.push(
        makeSkippedRun({
          runId,
          generationId,
          definition,
          reason: "当前请求是剧情讨论，不生成正文",
        }),
      );
      continue;
    }
    const executor = getExecutor(definition.executor);
    if (!executor) {
      runs.push(
        makeSkippedRun({
          runId,
          generationId,
          definition,
          reason: missingExecutorReason(definition.key),
        }),
      );
      continue;
    }
    const ctx: SkillExecutorContext = {
      userId: input.userId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      chapterContent: input.chapterContent,
      request: input.request,
      definition,
    };
    try {
      const output = await executor.run(ctx);
      if (output.artifact.kind === "context_pack") {
        const data = output.artifact.data as { entries?: RuntimePipelineResult["ragEntries"] } | null;
        ragEntries = data?.entries ?? [];
      }
      runs.push(makeExecutedRun({ runId, generationId, definition, output }));
      outputs.push({ definition, output, runId });
    } catch (err) {
      runs.push(makeFailedRun({ runId, generationId, definition, reason: (err as Error).message }));
    }
  }

  const assembled = assembleSkillSections(outputs);
  const assembledByRun = new Map(
    assembled.sections.map((section) => [section.runId, section]),
  );
  const finalRuns = runs.map((run) => {
    if (run.status !== "completed" && run.status !== "degraded") return run;
    const match = assembledByRun.get(run.runId);
    if (!match) {
      return settleRunEvidence(run, false, null, run.status === "degraded" ? run.reason : "产物未进入载荷");
    }
    return settleRunEvidence(
      run,
      true,
      { kind: match.section.kind, tokens: match.tokens },
      null,
      match.culled,
    );
  });
  await persistSkillRuns(finalRuns);

  return {
    generationId,
    plan,
    runs: finalRuns,
    sections: assembled.sections.map((section) => section.section),
    ragEntries,
    ragEntryCount: ragEntries.length,
  };
}

export { isExecutorConnected };

/** 证据端点/重试场景：读取一次生成的全部运行时证据（plan + runs + manifest）。 */
export async function loadGenerationEvidence(generationId: string) {
  const [planRow, runs, manifest] = await Promise.all([
    db
      .select()
      .from(generationPlans)
      .where(eq(generationPlans.generationId, generationId))
      .limit(1),
    listSkillRunsByGeneration(generationId),
    loadGenerationManifest(generationId),
  ]);
  return {
    plan: planRow[0]?.plan ?? null,
    runs,
    manifest,
  };
}
