// POST /api/v1/deconstruct/analyze — 小说拆解：正文 → oh-story 阶段化分析产物。
// 使用现有 one-api 文本模型，不伪造阶段结果；运行记录支持恢复、幂等和失败重试。
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { recordUsage } from "@/lib/account/service";
import { db } from "@/lib/db";
import {
  deconstructionRuns,
  novels,
  type DeconstructionMode,
  type DeconstructionArtifact,
  type DeconstructionResult,
} from "@/lib/schema";
import { validateDeconstructionArtifacts } from "@/lib/story/deconstruction-artifacts";

export type DeconstructResult = DeconstructionResult;

const MAX_TEXT = 30000;
const MIN_TEXT = 200;
const PROVIDER_TIMEOUT_MS = 90_000;
const PROVIDER_ATTEMPTS = 3;

/** 测试用固定结果（DECONSTRUCT_PROVIDER=mock） */
const MOCK_RESULT: DeconstructResult = {
  structure: ["开场：灰罐火苗偏斜", "中段：阿雀醒来对话", "收束：铁灰飞鸟掠过"],
  plot: ["伏笔：火苗朝零界偏斜", "人物：陆沉舟夜间外出", "推进：灯芯与药引"],
  rhythm: ["短句密（对话段）", "缓（景物描写）", "悬（结尾鸟飞向零界）"],
  mode: "short",
  stages: [
    { stage: 0, name: "概要与章节边界", status: "completed", artifact: { id: "stage-0", kind: "overview", schemaVersion: 1, premise: "灰烬镇的火种指向未知边界", chapterCount: 1, chapterIndex: [{ chapter: "001", title: "灰烬有籽", wordCount: 120 }] } },
    { stage: 2, name: "逐章摘要", status: "completed", artifact: { id: "stage-2", kind: "chapter-summaries", schemaVersion: 1, chapters: [{ chapter: "001", title: "灰烬有籽", summary: "火种异常引出人物与悬念", keyEvents: ["火苗偏斜", "陆沉舟外出"], characters: ["陆沉舟", "阿雀"], techniques: ["延迟揭示"], formula: "异常→调查→新钩子", endHook: "铁灰飞鸟飞向零界" }] } },
    { stage: 3, name: "剧情聚合", status: "completed", artifact: { id: "stage-3", kind: "plot-rhythm-emotion", schemaVersion: 1, mainline: "追查火种与零界的关系", subplots: [], units: ["异常出现", "人物行动", "悬念升级"], foreshadowing: [], emotionCurve: [], coverage: 1 } },
    { stage: 4, name: "设定与关系", status: "completed", artifact: { id: "stage-4", kind: "characters-settings-relations", schemaVersion: 1, characters: [{ name: "陆沉舟", role: "protagonist", aliases: [], motivation: "查清火种异常", arc: "待发展", evidenceChapters: ["001"] }], worldview: ["灰烬镇", "零界"], factions: [], relationships: [] } },
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
        goldenChapters: [{ chapter: "001", title: "灰烬有籽", reason: "异常物件在开篇建立悬念" }],
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

const STAGE_NAMES: Record<number, string> = {
  0: "概要与章节边界",
  1: "黄金三章",
  2: "逐章摘要",
  3: "剧情聚合",
  4: "设定与关系",
  5: "汇总报告",
  6: "文风",
};

const MODE_STAGES: Record<DeconstructionMode, number[]> = {
  long: [0, 1, 2, 3, 4, 5, 6],
  short: [0, 2, 3, 4, 5, 6],
};

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const serverDelay = Number.isFinite(seconds) ? seconds * 1000 : 0;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(8_000, Math.max(serverDelay, 500 * 2 ** attempt) + jitter);
}

async function requestDeconstructionModel(input: {
  mode: DeconstructionMode;
  title: string;
  text: string;
  runId?: number;
  repairOutput?: string;
}) {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;
  const attempts = input.repairOutput ? 2 : PROVIDER_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (input.runId) {
      await db.update(deconstructionRuns).set({
        attemptCount: attempt + 1,
        lastAttemptAt: new Date(),
      }).where(eq(deconstructionRuns.id, input.runId));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${process.env.ONEAPI_BASE_URL ?? "http://localhost:3001"}/v1/chat/completions`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.ONEAPI_TOKEN ?? ""}`,
          },
        body: JSON.stringify({
            model: process.env.DECONSTRUCT_MODEL ?? "deepseek-v4-flash",
            stream: false,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: `${PROMPT}\n本次请求 mode：${input.mode}\n本次请求必须完成阶段：${MODE_STAGES[input.mode].join(", ")}${input.repairOutput ? `\n这是一次结构修复请求。上一次输出未通过契约校验。请只输出修复后的完整 JSON，不要解释，不要删减任何必填字段。上一次输出如下：\n${input.repairOutput.slice(0, 50000)}` : ""}` },
              { role: "user", content: input.repairOutput ? `请根据原始作品《${input.title}》的分析结果完成结构修复。` : `作品/章节《${input.title}》\n\n${input.text.slice(0, MAX_TEXT)}` },
            ],
          }),
        },
      );
      lastResponse = response;
      if (response.ok) return response;
      if (![408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) return response;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(null, attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError) throw lastError;
  if (lastResponse) return lastResponse;
  throw new Error("拆解服务没有返回响应");
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
9. chapters、chapterIndex、goldenChapters、subplots、units、foreshadowing、characters、factions、relationships、readerNeeds、writingTechniques、replicableModules、risks、techniques 必须是 JSON 数组；mainline、emotionCurve、coverage、worldview、emotionEngine 可按内容使用字符串、数字、数组或对象。摘要要具体、可被下游写作/审查消费；不要返回空的占位对象。
10. 每个 artifact 必须保留稳定的字符串 id、字符串 kind 和数字 schemaVersion=1；不要把 stage 或 artifact.id 写成数字。
11. 返回前逐项检查所有必填字段与字段类型；宁可按原文证据写空数组，也不要省略字段或输出 null。
`;

/** 容错解析：剥离 ```json 围栏与前后杂音，校验三数组 */
function parseResult(raw: string, mode: DeconstructionMode, sourceLength: number): DeconstructResult | null {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<DeconstructResult>;
    const arr = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === "string");
    const stages = (Array.isArray(obj.stages) ? obj.stages : [])
      .map((stage) => {
        const candidate = stage as unknown as { stage?: unknown; name?: unknown; artifact?: unknown };
        return {
          stage: typeof candidate.stage === "number" && Number.isInteger(candidate.stage) ? candidate.stage : -1,
          name: typeof candidate.name === "string" ? candidate.name : "",
          artifact: candidate.artifact && typeof candidate.artifact === "object"
            ? candidate.artifact as Record<string, unknown>
            : {},
        };
      })
      .filter((stage) => stage.stage >= 0)
      .map((stage) => ({
        stage: stage.stage,
        name: stage.name || STAGE_NAMES[stage.stage] || `Stage ${stage.stage}`,
        status: "completed" as const,
        artifact: stage.artifact as DeconstructionArtifact,
      }));
    const actualStageIds = new Set(stages.map((stage) => stage.stage));
    const quality = obj.quality && typeof obj.quality === "object" ? obj.quality : null;
    const expectedStages = MODE_STAGES[mode];
    const schemaErrors = validateDeconstructionArtifacts({
      ...obj,
      mode,
      stages,
      quality: quality ? {
        sourceLength,
        chapterCount: typeof quality.chapterCount === "number" ? quality.chapterCount : NaN,
        completedStages: Array.isArray(quality.completedStages) ? quality.completedStages : expectedStages,
        warnings: Array.isArray(quality.warnings) ? quality.warnings.filter((warning): warning is string => typeof warning === "string") : [],
      } : undefined,
    }, mode);
    if (
      arr(obj.structure) &&
      arr(obj.plot) &&
      arr(obj.rhythm) &&
      expectedStages.every((stage) => actualStageIds.has(stage)) &&
      stages.every((stage) => Object.keys(stage.artifact).length > 0) &&
      schemaErrors.length === 0
    ) {
      return {
        structure: obj.structure,
        plot: obj.plot,
        rhythm: obj.rhythm,
        mode,
        stages: stages.sort((a, b) => a.stage - b.stage),
        quality: {
          sourceLength,
          chapterCount: typeof obj.quality?.chapterCount === "number" ? obj.quality.chapterCount : 0,
          completedStages: expectedStages,
          warnings: Array.isArray(obj.quality?.warnings)
            ? obj.quality.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 20)
            : [],
        },
      };
    }
  } catch {
    // fallthrough
  }
  return null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
    if (existing?.status === "completed" && existing.result) return NextResponse.json({ runId: existing.id, result: existing.result, title: existing.title, status: existing.status, resumed: true });
    if (existing && existing.sourceHash !== sourceHash) return NextResponse.json({ error: "拆解请求键已用于另一份正文" }, { status: 409 });
    if (existing?.status === "running") {
      const staleAfterMs = 15 * 60 * 1000;
      const isStale = Date.now() - existing.updatedAt.getTime() > staleAfterMs;
      if (!isStale) return NextResponse.json({ error: "该拆解仍在运行，请稍后刷新结果列表", runId: existing.id, status: existing.status }, { status: 409 });
      await db.update(deconstructionRuns).set({ status: "failed", errorMessage: "上一次拆解超过 15 分钟未完成，可安全重试", updatedAt: new Date() }).where(eq(deconstructionRuns.id, existing.id));
    }
  }

  let runId: number | undefined;
  if (requestKey) {
    const [run] = await db.insert(deconstructionRuns).values({ userId: user.id, novelId, title, sourceHash, sourceLength: text.length, requestKey, status: "running" }).onConflictDoNothing({ target: [deconstructionRuns.userId, deconstructionRuns.requestKey] }).returning({ id: deconstructionRuns.id });
    runId = run?.id;
    if (!runId) {
      const [existing] = await db.select({ id: deconstructionRuns.id, status: deconstructionRuns.status, result: deconstructionRuns.result }).from(deconstructionRuns).where(and(eq(deconstructionRuns.userId, user.id), eq(deconstructionRuns.requestKey, requestKey)));
      if (existing?.status === "completed" && existing.result) return NextResponse.json({ runId: existing.id, result: existing.result, title, status: existing.status, resumed: true });
      runId = existing?.id;
    }
  }

  const fail = async (message: string, httpStatus: number) => {
    if (runId) await db.update(deconstructionRuns).set({ status: "failed", errorMessage: message, lastErrorClass: message.includes("429") ? "rate_limited" : "provider_or_schema", updatedAt: new Date() }).where(eq(deconstructionRuns.id, runId));
    return NextResponse.json({ error: message, runId, status: "failed" }, { status: httpStatus });
  };

  // 测试模式：返回固定结果
  if (process.env.DECONSTRUCT_PROVIDER === "mock") {
    const mockResult = buildMockResult(mode, text.length);
    if (runId) await db.update(deconstructionRuns).set({ status: "completed", result: mockResult, errorMessage: null, updatedAt: new Date() }).where(eq(deconstructionRuns.id, runId));
    return NextResponse.json({ runId, result: mockResult, title, mode, status: "completed" });
  }

  try {
    const res = await requestDeconstructionModel({ mode, title, text, runId });
    if (!res.ok) {
      return fail(`拆解服务暂不可用（${res.status}）`, 502);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    let result = parseResult(raw, mode, text.length);
    let repairUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (!result) {
      const repairResponse = await requestDeconstructionModel({ mode, title, text, runId, repairOutput: raw });
      if (repairResponse.ok) {
        const repairData = (await repairResponse.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        repairUsage = repairData.usage;
        result = parseResult(repairData.choices?.[0]?.message?.content ?? "", mode, text.length);
      }
    }
    if (!result) {
      return fail("拆解结果结构不符合当前阶段契约，请重试", 502);
    }
    // 用量记账（11 工单）
    await recordUsage(
      user.id,
      "小说拆解",
      (data.usage?.prompt_tokens ?? 0) + (repairUsage?.prompt_tokens ?? 0),
      (data.usage?.completion_tokens ?? 0) + (repairUsage?.completion_tokens ?? 0),
    ).catch(() => {});
    if (runId) await db.update(deconstructionRuns).set({ status: "completed", result, errorMessage: null, updatedAt: new Date() }).where(eq(deconstructionRuns.id, runId));
    return NextResponse.json({ runId, result, title, mode, status: "completed" });
  } catch (err) {
    return fail(`拆解失败：${(err as Error).message}`, 502);
  }
}
