// POST /api/v1/deconstruct/analyze — 小说拆解：正文 → oh-story 阶段化分析产物。
// 使用现有 one-api 文本模型，不伪造阶段结果；运行记录支持恢复、幂等和失败重试。
import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {

  appendEvent,

  beginAttempt,

  claimJob,

  enqueueJob,

  finishJob,

  listSteps,

  settleAttempt,

} from "@/lib/tasks/service";
import { recordAttemptUsage } from "@/lib/tasks/usage-ledger";

import { getCurrentUser } from "@/lib/auth/current-user";
import { enforceAiLimit } from "@/lib/http/rate-limit";
import { createUnifiedCompletionProvider, type UnifiedCompletionProvider } from "@/lib/ai/provider";
import { ProviderBoundaryError } from "@/lib/ai/provider-boundary";
import { recordUsage } from "@/lib/account/service";
import { db } from "@/lib/db";
import {
  deconstructionRuns,
  novels,
  type DeconstructionMode,
  type DeconstructionResult,
} from "@/lib/schema";
import {
  runStructuredDeconstruction,
  attemptsOf,
  type ProviderCallResult,
  type ProviderTransport,
} from "@/lib/story/deconstruction-pipeline";

export type DeconstructResult = DeconstructionResult;

const MAX_TEXT = 30000;
const MIN_TEXT = 200;
// Cloud Run terminates the web request at 300s. Keep an explicit reserve for
// database settlement and the JSON response, so the route owns its timeout
// result instead of being cut off by the platform.
const CLOUD_RUN_REQUEST_TIMEOUT_MS = 300_000;
const DECONSTRUCTION_FINALIZATION_RESERVE_MS = 30_000;
export const DECONSTRUCTION_TOTAL_DEADLINE_MS =
  CLOUD_RUN_REQUEST_TIMEOUT_MS - DECONSTRUCTION_FINALIZATION_RESERVE_MS;

export function deconstructionRequestDeadline(now = Date.now()): number {
  return now + DECONSTRUCTION_TOTAL_DEADLINE_MS;
}
// Evidence-based hard bounds: the approved provider probes complete a valid
// short artifact in under 100s, so the old 90s primary budget was too tight.
// These remain finite and are still capped by the run deadline.
const PROVIDER_TIMEOUT_MS = 125_000;
const REPAIR_TIMEOUT_MS = 110_000;
const PRIMARY_ATTEMPTS = 3;
const REPAIR_ATTEMPTS = 2;

function publicFailureCode(errorClass: string): string {
  const codes: Record<string, string> = {
    provider_timeout: "PROVIDER_TIMEOUT",
    provider_rate_limit: "PROVIDER_RATE_LIMIT",
    provider_client_error: "PROVIDER_CLIENT_ERROR",
    provider_unavailable: "PROVIDER_UNAVAILABLE",
    provider_network: "PROVIDER_NETWORK_ERROR",
    provider_protocol: "PROVIDER_PROTOCOL_ERROR",
    invalid_json: "INVALID_JSON",
    artifact_schema_invalid: "ARTIFACT_SCHEMA_INVALID",
    artifact_quality_failed: "ARTIFACT_QUALITY_INVALID",
    repair_failed: "STRUCTURE_REPAIR_FAILED",
    stale_running: "RUN_TIMEOUT",
    configuration_error: "INTERNAL_ERROR",
    internal: "INTERNAL_ERROR",
  };
  return codes[errorClass] ?? "INTERNAL_ERROR";
}

/** 测试用固定结果（DECONSTRUCT_PROVIDER=mock） */
const MOCK_RESULT: DeconstructResult = {
  structure: ["开场：雨巷夜归", "中段：窗边对话", "收束：未寄出的信"],
  plot: ["伏笔：雨巷旧门牌", "人物：主角深夜归来", "推进：灯下翻旧稿"],
  rhythm: ["短句密（对话段）", "缓（景物描写）", "悬（结尾信未寄出）"],
  mode: "short",
  stages: [
    { stage: 0, name: "概要与章节边界", status: "completed", artifact: { id: "stage-0", kind: "overview", schemaVersion: 1, premise: "雨巷旧宅里一封未寄出的信", chapterCount: 1, chapterIndex: [{ chapter: "001", title: "示例章节", wordCount: 120 }] } },
    { stage: 2, name: "逐章摘要", status: "completed", artifact: { id: "stage-2", kind: "chapter-summaries", schemaVersion: 1, chapters: [{ chapter: "001", title: "示例章节", summary: "旧信引出人物与悬念", keyEvents: ["雨夜归来", "发现旧信"], characters: ["主角"], techniques: ["延迟揭示"], formula: "异常→调查→新钩子", endHook: "信尾署名残缺" }] } },
    { stage: 3, name: "剧情聚合", status: "completed", artifact: { id: "stage-3", kind: "plot-rhythm-emotion", schemaVersion: 1, mainline: "追查旧信的来处", subplots: [], units: ["异常出现", "人物行动", "悬念升级"], foreshadowing: [], emotionCurve: [], coverage: 1 } },
    { stage: 4, name: "设定与关系", status: "completed", artifact: { id: "stage-4", kind: "characters-settings-relations", schemaVersion: 1, characters: [{ name: "主角", role: "protagonist", aliases: [], motivation: "查明旧信来历", arc: "待发展", evidenceChapters: ["001"] }], worldview: ["雨巷旧宅"], factions: [], relationships: [] } },
    { stage: 5, name: "汇总报告", status: "completed", artifact: { id: "stage-5", kind: "aggregate-report", schemaVersion: 1, readerNeeds: ["认知惊喜", "悬念追读"], emotionEngine: "异常→调查→悬念", writingTechniques: ["延迟揭示"], replicableModules: ["以异常物件打开主线"], risks: [] } },
    { stage: 6, name: "文风", status: "completed", artifact: { id: "stage-6", kind: "style-profile", schemaVersion: 1, sentence: "短句与中句交替", rhythm: "景物放缓、结尾收紧", dialogue: "信息留白", emotion: "平静→不安", techniques: [] } },
  ],
  quality: { sourceLength: 0, chapterCount: 1, completedStages: [0, 2, 3, 4, 5, 6], warnings: [] },
};

function buildMockResult(mode: DeconstructionMode, sourceLength: number): DeconstructResult {
  const baseStages = [...MOCK_RESULT.stages];
  if (mode === "long") {
    baseStages.splice(1, 0, {
      stage: 1,
      name: "黄金三章",
      status: "completed",
      artifact: {
        id: "stage-1",
        kind: "golden-three",
        schemaVersion: 1,
        goldenChapters: [{ chapter: "001", title: "示例章节", reason: "异常物件在开篇建立悬念" }],
      },
    });
  }
  const completedStages = MODE_STAGES[mode];
  return {
    ...MOCK_RESULT,
    mode,
    stages: baseStages,
    quality: { ...MOCK_RESULT.quality, sourceLength, completedStages },
  };
}

const MODE_STAGES: Record<DeconstructionMode, number[]> = {
  long: [0, 1, 2, 3, 4, 5, 6],
  short: [0, 2, 3, 4, 5, 6],
};

function retryDelayMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(8_000, 500 * 2 ** attempt + jitter);
}

export function classifyProviderError(error: unknown): Exclude<ProviderTransport, "success"> {
  const status = error instanceof ProviderBoundaryError ? error.status : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("aborted") || message.includes("timeout") || message.includes("超时")) return "timeout";
  if (status === 429) return "rate_limit";
  if (status !== undefined && status >= 500) return "provider_5xx";
  if (status !== undefined && status >= 400) return "provider_4xx";
  return "network";
}

async function requestDeconstructionModel(input: {
  mode: DeconstructionMode;
  title: string;
  text: string;
  runId?: number;
  baseAttemptCount?: number;
  repairOutput?: string;
  deadline: number;
  provider: UnifiedCompletionProvider;
}): Promise<ProviderCallResult> {
  const attempts = input.repairOutput ? REPAIR_ATTEMPTS : PRIMARY_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) return { kind: "timeout", attempts: attempt };
    if (input.runId) {
      await db.update(deconstructionRuns).set({
        attemptCount: (input.baseAttemptCount ?? 0) + attempt + 1,
        lastAttemptAt: new Date(),
      }).where(eq(deconstructionRuns.id, input.runId));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(input.repairOutput ? REPAIR_TIMEOUT_MS : PROVIDER_TIMEOUT_MS, remaining));
    try {
      const data = await input.provider.complete({
        model: input.provider.boundary.model,
        signal: ctrl.signal,
        extraBody: {
          response_format: { type: "json_object" },
          max_tokens: 6000,
          temperature: 0.1,
          thinking: { type: "disabled" },
        },
        system: `${PROMPT}\n本次请求 mode：${input.mode}\n本次请求必须完成阶段：${MODE_STAGES[input.mode].join(", ")}${input.repairOutput ? `\n这是一次结构修复请求。上一次输出未通过契约校验。请只输出修复后的完整 JSON，不要解释，不要删减任何必填字段。上一次输出如下：\n${input.repairOutput.slice(0, 50000)}` : ""}`,
        messages: [{
          role: "user",
          content: input.repairOutput
            ? `请根据原始作品《${input.title}》的分析结果完成结构修复。`
            : `作品/章节《${input.title}》\n\n${input.text.slice(0, MAX_TEXT)}`,
        }],
      });
      return {
        kind: "success",
        raw: data.text,
        usage: data.usage ? {
          prompt_tokens: data.usage.promptTokens,
          completion_tokens: data.usage.completionTokens,
        } : undefined,
        attempts: attempt + 1,
      };
    } catch (error) {
      const transport = classifyProviderError(error);
      if (!["timeout", "rate_limit", "provider_5xx"].includes(transport) || attempt === attempts - 1) {
        return {
          kind: transport,
          status: error instanceof ProviderBoundaryError ? error.status : undefined,
          attempts: attempt + 1,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs(attempt), Math.max(0, input.deadline - Date.now()))));
    } finally {
      clearTimeout(timer);
    }
  }
  return { kind: "network", attempts };
}

const PROMPT = `你是资深网络小说编辑。你要执行 oh-story 的结构化拆文管道。
只分析用户提供的合法虚构文本，不复制原文，不输出大段原文，不把原文没有明确给出的硬事实当成事实。
必须只输出严格 JSON，不要 markdown 代码块、不要解释。输出格式：
{
  "mode":"long|short",
  "stages":[
    {"stage":0,"name":"概要与章节边界","status":"completed","artifact":{"id":"stage-0","kind":"overview","schemaVersion":1}},
    {"stage":1,"name":"黄金三章","status":"completed","artifact":{"id":"stage-1","kind":"golden-three","schemaVersion":1}},
    {"stage":2,"name":"逐章摘要","status":"completed","artifact":{"id":"stage-2","kind":"chapter-summaries","schemaVersion":1}},
    {"stage":3,"name":"剧情聚合","status":"completed","artifact":{"id":"stage-3","kind":"plot-rhythm-emotion","schemaVersion":1}},
    {"stage":4,"name":"设定与关系","status":"completed","artifact":{"id":"stage-4","kind":"characters-settings-relations","schemaVersion":1}},
    {"stage":5,"name":"汇总报告","status":"completed","artifact":{"id":"stage-5","kind":"aggregate-report","schemaVersion":1}},
    {"stage":6,"name":"文风","status":"completed","artifact":{"id":"stage-6","kind":"style-profile","schemaVersion":1}}
  ],
  "structure":["结构摘要"],"plot":["剧情摘要"],"rhythm":["节奏摘要"],
  "quality":{"chapterCount":1,"warnings":[]}
}

规则：
1. mode 必须与请求的 mode 一致；只返回请求 mode 所需的阶段。long 必须有 0-6 全部阶段，short 必须有 0、2、3、4、5、6。
2. Stage 0 artifact 必须含 premise、chapterCount、chapterIndex（每章含 chapter/title/wordCount）。
3. Stage 1 artifact 必须含 goldenChapters；如果文本不足三章，按实际章数并在 warnings 写明，不得虚构章节。
4. Stage 2 artifact 必须含 chapters；每章含 chapter/title/summary/keyEvents/characters/techniques/formula/endHook。
5. Stage 3 artifact 必须含 mainline/subplots/units/foreshadowing/emotionCurve/coverage。
6. Stage 4 artifact 必须含 characters/worldview/factions/relationships；硬事实没有证据时写“原文未明确”。
7. Stage 5 artifact 必须含 readerNeeds/emotionEngine/writingTechniques/replicableModules/risks。
8. Stage 6 artifact 必须含 sentence/rhythm/dialogue/emotion/techniques；不要输出超过 6 段原文摘录。
9. chapters、chapterIndex、goldenChapters、subplots、units、foreshadowing、characters、factions、relationships、readerNeeds、writingTechniques、replicableModules、risks、techniques、emotionCurve、worldview 必须是 JSON 数组（worldview 也可为 JSON 对象）；mainline 必须是字符串或数组，coverage 必须是数字、字符串或数组，emotionEngine 必须是字符串或数组。摘要要具体、可被下游写作/审查消费；不要返回空的占位对象。
10. 每个 stage 对象必须同时保留数字整数 stage 字段（short 只能是 0、2、3、4、5、6；long 只能是 0、1、2、3、4、5、6）、字符串 name、status="completed" 和 artifact；不要省略 stage 字段，也不要把 stage 写成字符串。
11. 每个 artifact 必须保留稳定的字符串 id、字符串 kind 和数字 schemaVersion=1；不要把 artifact.id 写成数字。
12. 返回前逐项检查所有必填字段与字段类型；宁可按原文证据写空数组，也不要省略字段或输出 null。
`;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 工单 C：AI 昂贵端点按用户限流（阈值 RATE_LIMIT_AI_PER_MIN，默认 30/分钟）
  const limited = enforceAiLimit(user.id, "deconstruct");
  if (limited) return limited;
  const requestDeadline = deconstructionRequestDeadline();

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    title?: unknown;
    requestKey?: unknown;
    novelId?: unknown;
    mode?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < MIN_TEXT) {
    return NextResponse.json(
      { error: `文本太短，建议整章上传（至少 ${MIN_TEXT} 字）` },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json(
      { error: `文本过长，最多支持 ${MAX_TEXT} 字` },
      { status: 413 },
    );
  }
  const title = typeof body?.title === "string" ? body.title.trim() : "未命名章节";
  const mode: DeconstructionMode = body?.mode === "long" || body?.mode === "short"
    ? body.mode
    : text.length > 20000 ? "long" : "short";
  const requestKey = typeof body?.requestKey === "string" ? body.requestKey.trim() : "";
  if (requestKey.length > 120) return NextResponse.json({ error: "拆解请求键过长" }, { status: 400 });
  const sourceHash = createHash("sha256").update(text).digest("hex");
  const novelId = typeof body?.novelId === "number" && Number.isInteger(body.novelId) ? body.novelId : null;
  if (novelId) {
    const [ownedNovel] = await db.select({ id: novels.id }).from(novels).where(and(eq(novels.id, novelId), eq(novels.userId, user.id)));
    if (!ownedNovel) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  if (requestKey) {
    const [existing] = await db.select().from(deconstructionRuns).where(and(eq(deconstructionRuns.userId, user.id), eq(deconstructionRuns.requestKey, requestKey)));
    if (existing && existing.sourceHash !== sourceHash) return NextResponse.json({ error: "拆解请求键已用于另一份正文" }, { status: 409 });
    if (existing?.status === "completed" && existing.result) return NextResponse.json({ runId: existing.id, result: existing.result, title: existing.title, status: existing.status, resumed: true });
    if (existing?.status === "failed") return NextResponse.json({ runId: existing.id, status: "failed", error: existing.errorMessage ?? "该运行已失败，请使用新的请求键重新执行", errorClass: existing.lastErrorClass }, { status: 409 });
    if (existing?.status === "running") {
      const staleAfterMs = 15 * 60 * 1000;
      const isStale = Date.now() - existing.updatedAt.getTime() > staleAfterMs;
      if (!isStale) return NextResponse.json({ error: "该拆解仍在运行，请稍后刷新结果列表", runId: existing.id, status: existing.status }, { status: 409 });
      await db.update(deconstructionRuns).set({
        status: "failed",
        errorMessage: "上一次拆解超过 15 分钟未完成，可安全重试",
        lastErrorClass: "RUN_TIMEOUT",
        updatedAt: new Date(),
      }).where(eq(deconstructionRuns.id, existing.id));
      return NextResponse.json({ runId: existing.id, status: "failed", error: "上一次拆解已超时，请使用新的请求键重新执行", errorClass: "RUN_TIMEOUT" }, { status: 409 });
    }
  }

  let runId: number | undefined;
  // 任务运行时（ADR-0007 / 票 07）：作用域提升到 handler 层
  let taskJobId: string | null = null;

  let taskAttemptId: number | null = null;

  let taskActive = false;

  if (requestKey) {
    const [run] = await db.insert(deconstructionRuns).values({ userId: user.id, novelId, title, sourceHash, sourceLength: text.length, requestKey, status: "running" }).onConflictDoNothing({ target: [deconstructionRuns.userId, deconstructionRuns.requestKey] }).returning({ id: deconstructionRuns.id });
    runId = run?.id;
    if (!runId) {
      const [existing] = await db.select({ id: deconstructionRuns.id, sourceHash: deconstructionRuns.sourceHash, status: deconstructionRuns.status, result: deconstructionRuns.result, errorMessage: deconstructionRuns.errorMessage, lastErrorClass: deconstructionRuns.lastErrorClass }).from(deconstructionRuns).where(and(eq(deconstructionRuns.userId, user.id), eq(deconstructionRuns.requestKey, requestKey)));
      if (existing?.sourceHash && existing.sourceHash !== sourceHash) return NextResponse.json({ error: "拆解请求键已用于另一份正文" }, { status: 409 });
      if (existing?.status === "completed" && existing.result) return NextResponse.json({ runId: existing.id, result: existing.result, title, status: existing.status, resumed: true });
      if (existing?.status === "failed") return NextResponse.json({ runId: existing.id, status: "failed", error: existing.errorMessage ?? "该运行已失败，请使用新的请求键重新执行", errorClass: existing.lastErrorClass }, { status: 409 });
      runId = existing?.id;
    }
  }

  if (runId) {
    await db.update(deconstructionRuns).set({
      status: "running",
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(deconstructionRuns.id, runId));
  // 任务运行时登记（ADR-0007 / 票 07）：job_id = requestKey（幂等），fail-open

  taskJobId = requestKey || `decon-${runId}`;



  try {

    const { job: taskJob } = await enqueueJob({

      jobId: taskJobId,

      userId: user.id,

      novelId,

      operation: "deconstruction",

      idempotencyKey: taskJobId,

      inputHash: sourceHash,

      steps: [{ stepKey: "analyze" }],

    });

    const claimed = await claimJob(taskJob.jobId, `req:${user.id}`, 300);

    if (claimed) {

      const [taskStep] = await listSteps(taskJob.jobId);

      if (taskStep) {

        const attempt = await beginAttempt({ stepId: taskStep.id, trigger: "initial" });

        taskAttemptId = attempt.id;

        taskActive = true;

        await appendEvent({ jobId: taskJobId, eventType: "phase", payload: { kind: "running" }, clientKey: "running" });

      }

    }

  } catch {

    // fail-open：任务登记失败不阻断拆解（deconstructionRuns 仍是业务真源）

  }

  }

  const fail = async (input: {
    message: string;
    httpStatus: number;
    errorClass: string;
    workflow?: "failed_recoverable" | "failed_terminal";
    structured?: string | null;
    transport?: string;
    providerAttempts?: number;
    repairAttempts?: number;
    validationErrors?: string[];
  }) => {
    if (runId) await db.update(deconstructionRuns).set({
      status: "failed",
      errorMessage: input.message,
      lastErrorClass: publicFailureCode(input.errorClass),
      updatedAt: new Date(),
    }).where(eq(deconstructionRuns.id, runId));
    return NextResponse.json({
      error: input.message,
      errorClass: publicFailureCode(input.errorClass),
      workflow: input.workflow ?? "failed_recoverable",
      structured: input.structured,
      transport: input.transport,
      providerAttempts: input.providerAttempts,
      repairAttempts: input.repairAttempts,
      validationErrors: input.validationErrors,
      runId,
      status: "failed",
    }, { status: input.httpStatus });
  };

  const model = process.env.DECONSTRUCT_MODEL ?? "glm-4.5-flash";
  const provider = createUnifiedCompletionProvider({ route: "deconstruct", model });
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const recordLedger = (status: "succeeded" | "failed" | "cancelled", promptTokens?: number, completionTokens?: number) =>
    recordAttemptUsage({
      userId: user.id,
      requestId,
      taskId: taskJobId,
      generationId: taskJobId ?? requestId,
      attemptId: taskAttemptId,
      sourceClass: provider.boundary.sourceClass,
      provider: provider.boundary.provider,
      model: provider.boundary.model,
      credentialOwner: provider.boundary.credentialOwner,
      billingOwner: provider.boundary.billingOwner,
      route: "deconstruct",
      status,
      promptTokens,
      completionTokens,
    }).catch(() => {});

  // 测试模式：返回固定结果；boundary 已在此处完成生产防火墙校验。
  if (provider.boundary.sourceClass === "TEST_MOCK") {
    const mockResult = buildMockResult(mode, text.length);
    if (runId) await db.update(deconstructionRuns).set({ status: "completed", result: mockResult, errorMessage: null, updatedAt: new Date() }).where(eq(deconstructionRuns.id, runId));
  if (taskActive) {

    await (async () => {

      try {

        if (taskAttemptId != null) {
          await settleAttempt({ attemptId: taskAttemptId, status: "succeeded", errorClass: null });
        }
        await recordLedger("succeeded");

        await finishJob(taskJobId!, `req:${user.id}`, "succeeded", null);

        await appendEvent({ jobId: taskJobId!, eventType: "done", payload: { status: "succeeded", mode }, clientKey: "done" });

      } catch { /* fail-open */ }

    })();

  }

    return NextResponse.json({ runId, result: mockResult, title, mode, status: "completed" });
  }

  try {
    let initialRaw = "";
    let attemptOffset = 0;
    const [runMetadata] = runId
      ? await db.select({ attemptCount: deconstructionRuns.attemptCount }).from(deconstructionRuns).where(eq(deconstructionRuns.id, runId))
      : [];
    const pipeline = await runStructuredDeconstruction({
      mode,
      sourceLength: text.length,
      request: async ({ repair }) => {
        const response = await requestDeconstructionModel({
          mode,
          title,
          text,
          runId,
          baseAttemptCount: runMetadata?.attemptCount ?? 0,
          repairOutput: repair ? initialRaw : undefined,
          deadline: requestDeadline,
          provider,
        });
        attemptOffset += attemptsOf(response);
        if (runId) {
          await db.update(deconstructionRuns).set({
            attemptCount: (runMetadata?.attemptCount ?? 0) + attemptOffset,
            lastAttemptAt: new Date(),
          }).where(eq(deconstructionRuns.id, runId));
        }
        if (!repair && response.kind === "success") initialRaw = response.raw;
        return response;
      },
    });
    if (pipeline.workflow !== "completed" || !pipeline.result) {
      const httpStatus = pipeline.errorClass === "provider_timeout" ? 504 : pipeline.errorClass === "provider_rate_limit" ? 429 : 502;
      const message = pipeline.errorClass === "provider_timeout"
        ? "拆解服务超时，可重新执行"
        : pipeline.errorClass === "provider_rate_limit"
          ? "拆解服务限流，请稍后重新执行"
          : pipeline.errorClass === "artifact_quality_failed"
            ? "拆解结果未通过质量检查，可重新执行"
            : pipeline.structured === "repair_failed"
              ? "拆解结果修复失败，可重新执行"
              : "拆解服务未返回可用结果，可重新执行";
      await recordLedger(
        "failed",
        pipeline.usage.prompt_tokens,
        pipeline.usage.completion_tokens,
      );
      return fail({
        message,
        httpStatus,
        errorClass: pipeline.errorClass ?? "provider_protocol",
        workflow: pipeline.workflow === "completed" ? "failed_recoverable" : pipeline.workflow,
        structured: pipeline.structured,
        transport: pipeline.transport,
        providerAttempts: pipeline.providerAttempts,
        repairAttempts: pipeline.repairAttempts,
        validationErrors: pipeline.validationErrors,
      });
    }
    // 用量记账（11 工单）
    await recordUsage(
      user.id,
      "小说拆解",
      pipeline.usage.prompt_tokens,
      pipeline.usage.completion_tokens,
    ).catch(() => {});
    await recordLedger(
      "succeeded",
      pipeline.usage.prompt_tokens,
      pipeline.usage.completion_tokens,
    );
    if (runId) await db.update(deconstructionRuns).set({ status: "completed", result: pipeline.result, errorMessage: null, lastErrorClass: null, updatedAt: new Date() }).where(eq(deconstructionRuns.id, runId));
  if (taskActive) {

    await (async () => {

      try {

        if (taskAttemptId != null) {

          await settleAttempt({ attemptId: taskAttemptId, status: "succeeded", errorClass: null });

        }

        await finishJob(taskJobId!, `req:${user.id}`, "succeeded", null);

        await appendEvent({ jobId: taskJobId!, eventType: "done", payload: { status: "succeeded", mode }, clientKey: "done" });

      } catch { /* fail-open */ }

    })();

  }

    return NextResponse.json({ runId, result: pipeline.result, title, mode, status: "completed", workflow: pipeline.workflow, structured: pipeline.structured, transport: pipeline.transport, providerAttempts: pipeline.providerAttempts, repairAttempts: pipeline.repairAttempts });
  } catch {
    if (taskActive) {

      await (async () => {

        try {

          if (taskAttemptId != null) await settleAttempt({ attemptId: taskAttemptId, status: "failed", errorClass: "provider_network" });

          await finishJob(taskJobId!, `req:${user.id}`, "failed", "provider_network");

          await appendEvent({ jobId: taskJobId!, eventType: "error", payload: { status: "failed" }, clientKey: "done" });

        } catch { /* fail-open */ }

      })();

    }

    await recordLedger("failed");

    return fail({ message: "拆解服务内部失败，可重新执行", httpStatus: 502, errorClass: "internal" });
  }
}
