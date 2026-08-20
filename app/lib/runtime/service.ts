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
import { getExecutor, isExecutorConnected, missingExecutorReason, SKILL_PRECONDITIONS } from "./skill-registry";
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
  /** 风格引用（narrative_style 输入；缺省 = 未选择风格）。 */
  styleId?: number | null;
  /** 显式选择的用户自定义技能（已声明契约；工单 08 收尾）。 */
  customSkills?: SkillDefinition[];
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
      case "style":
        if (input.styleId == null) return "未选择风格";
        break;
      case "candidate":
        return null; // post_write 输入门由 runPostWriteValidators 处理
      default:
        // market_brief / benchmark_pack：工单 05/06 判门
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
    definitions: [...input.definitions, ...(input.customSkills ?? [])],
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
  const definitions = [...input.definitions, ...(input.customSkills ?? [])];

  for (const definition of definitions) {
    const runId = newRunId();
    const gateReason = checkInputGate(definition, input);
    if (gateReason) {
      runs.push(makeSkippedRun({ runId, generationId, definition, reason: gateReason }));
      continue;
    }
    if (definition.trigger === "post_write") {
      // post_write 技能（质量门）由 runPostWriteValidators 在生成后统一执行；
      // pre-write 阶段不产生其运行行，避免重复证据。
      continue;
    }
    // 讨论请求：只保留 story_grounding 提供讨论所需上下文；计划/题材/风格技能不产出生成物料
    if (definition.trigger === "pre_write" && definition.key !== "story_grounding" && !isPostWriteAllowed(input)) {
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
          reason: missingExecutorReason(),
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
      styleId: input.styleId ?? null,
    };
    const precondition = SKILL_PRECONDITIONS[definition.key];
    if (precondition) {
      const skipReason = await precondition(ctx);
      if (skipReason) {
        runs.push(makeSkippedRun({ runId, generationId, definition, reason: skipReason }));
        continue;
      }
    }
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

  const assembled = assembleSkillSections(outputs, plan.contextBudget.perSection);
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

export interface PostWriteInput {
  userId: number;
  novelId: number | null;
  chapterId: number | null;
  request: string;
  /** 生成候选正文；null/空 = 独立对话（无候选生命周期） */
  candidate: string | null;
  generationId: string;
  definitions: SkillDefinition[];
}

/**
 * post_write 阶段（工单 03）：质量门在候选生成后、确认前运行。
 * 校验器产物不进模型载荷：evidence=applied 表示报告已产出并挂载候选证据；promptSection 保持 null。
 */
export async function runPostWriteValidators(input: PostWriteInput): Promise<SkillRun[]> {
  const runs: SkillRun[] = [];
  const phase = routePhase(input.request).phase;
  for (const definition of input.definitions.filter((d) => d.trigger === "post_write")) {
    const runId = newRunId();
    if (phase === "discussion") {
      runs.push(
        makeSkippedRun({ runId, generationId: input.generationId, definition, reason: "当前请求是剧情讨论，不生成正文" }),
      );
      continue;
    }
    if (!input.candidate || !input.candidate.trim()) {
      runs.push(
        makeSkippedRun({ runId, generationId: input.generationId, definition, reason: "无候选正文（独立对话不执行质量门）" }),
      );
      continue;
    }
    const executor = getExecutor(definition.executor);
    if (!executor) {
      runs.push(
        makeSkippedRun({ runId, generationId: input.generationId, definition, reason: missingExecutorReason() }),
      );
      continue;
    }
    const ctx: SkillExecutorContext = {
      userId: input.userId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      chapterContent: null,
      request: input.request,
      definition,
      candidate: input.candidate,
    };
    try {
      const output = await executor.run(ctx);
      const run = makeExecutedRun({ runId, generationId: input.generationId, definition, output });
      runs.push(settleRunEvidence(run, true, null, null));
    } catch (err) {
      runs.push(
        makeFailedRun({ runId, generationId: input.generationId, definition, reason: (err as Error).message }),
      );
    }
  }
  await persistSkillRuns(runs);
  return runs;
}

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
