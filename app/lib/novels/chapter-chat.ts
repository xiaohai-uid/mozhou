// 章节对话引擎（工单 17，V1.1 Journey ⑦）：章节 AI 对话——消息持久化 + 技能驱动生成。
// 注入链（system，按序）：正文参考（末尾 3000 字）→ RAG 设定（novelId，复用 06 工单）→ 风格（styleId，复用 15）→ 技能（内置场景技能 + 我的技能）。
// 生成内核复用 runNodeStream（管线 seam 不新增）；mock provider 回显 system 使注入可断言。
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  chapterMessages,
  chapters,
} from "@/lib/schema";
import { initialState, runNodeStream } from "@/lib/pipeline/engine";
import { makeChatProvider } from "@/lib/chat/stream-provider";
import { createLlmTransportFromEnv } from "@/lib/chat/llm-transport";
import { buildWritingContext, type WritingContextSection } from "@/lib/chat/writing-context";
import { recordUsage } from "@/lib/account/service";
import type { ChatModel } from "@/lib/chat/models";
import type { ChatMessage } from "@/lib/chat/payload";
import {
  compressHistory,
  isUsableKeptHistory,
  shouldCompress,
} from "@/lib/chat/compress";
import {
  applyChapterCandidate,
  ChapterNotFoundError,
  ContentChangedError,
  discardChapterCandidate,
  GenerationKeyConflictError,
  normalizeCandidateStatus,
  normalizePersistedChapterMessageStatus,
  persistChapterCandidateSettlement,
  prepareChapterCandidate,
  type CandidateStatus,
  type InsertResult,
  type InsertTarget,
} from "./chapter-candidate";
import {
  buildGenerationManifest,
  fullPayloadSections,
  persistGenerationManifest,
} from "@/lib/runtime/generation-manifest";
import { runPostWriteValidators, runRuntimePipeline } from "@/lib/runtime/service";
import { loadBuiltinSkillDefinitions } from "@/lib/runtime/skill-registry";
import { loadCustomSkillDefinitions } from "@/lib/runtime/custom-skills";
import { listQualityGateSummaries, listSkillRunsByGeneration } from "@/lib/runtime/skill-run";
import { skillRuns as skillRunsTable } from "@/lib/schema";
import type { SkillRun } from "@/lib/runtime/types";
import { buildChapterReplayHistory } from "./chapter-replay";
import { resolveOwnedChapter } from "./ownership";

/** 内置场景技能（工单 19 正式化；此处为注入链基础）：名称 → systemPrompt */
export const SCENE_SKILLS: Record<string, string> = {
  章节续写: "通读前文与作品设定；保持叙事视角与句式节奏；结尾留钩子。只输出正文。",
  章节起笔: "根据作品设定与风格指南起笔；建立场景与人物；结尾留钩子。只输出正文。",
};

export { ChapterNotFoundError, ContentChangedError, GenerationKeyConflictError } from "./chapter-candidate";
export type { InsertTarget } from "./chapter-candidate";

/** 生成失败（非停止）：路由层转 error 事件 */
export class ChapterChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterChatError";
  }
}

/** 正文参考注入长度上限（契约 21 第 6 节） */
const BODY_REF_LIMIT = 3000;

export type ChapterMessageStatus = CandidateStatus;

export interface ChapterMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  skills: string[];
  snapshot: string;
  status: ChapterMessageStatus;
  inserted: boolean;
  generationKey: string | null;
  requestHash: string | null;
  baseRevision: number | null;
  errorMessage: string | null;
  updatedAt: string;
  createdAt: string;
  /** 质量门检查摘要（assistant 候选；候选确认路径展示用，工单 03 收尾） */
  qualityGate?: string | null;
}

function toRow(m: typeof chapterMessages.$inferSelect): ChapterMessageRow {
  const status = normalizePersistedChapterMessageStatus({
    role: m.role as "user" | "assistant",
    status: m.status as ChapterMessageStatus,
    inserted: m.inserted,
  });
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    skills: m.skills,
    snapshot: m.snapshot,
    status,
    inserted: m.inserted,
    generationKey: m.generationKey,
    requestHash: m.requestHash,
    baseRevision: m.baseRevision,
    errorMessage: m.errorMessage,
    updatedAt: m.updatedAt.toISOString(),
    createdAt: m.createdAt.toISOString(),
    qualityGate: (m as { qualityGate?: string | null }).qualityGate ?? null,
  };
}

/** 章节对话历史（新→旧；契约 21：全量返回，分页留后续） */
export async function listChapterMessages(
  userId: number,
  novelId: number,
  chapterId: number,
): Promise<ChapterMessageRow[] | null> {
  const chapter = await resolveOwnedChapter({ userId, novelId, chapterId });
  if (!chapter) return null;
  const rows = await db
    .select()
    .from(chapterMessages)
    .where(eq(chapterMessages.chapterId, chapterId))
    .orderBy(desc(chapterMessages.createdAt), desc(chapterMessages.id));
  const messages = rows.map(toRow);
  // 质量门摘要：候选确认路径展示检查结果（只挂 assistant 且有 generationKey 的候选）
  const generationKeys = messages
    .filter((m) => m.role === "assistant" && m.generationKey != null)
    .map((m) => m.generationKey!);
  if (generationKeys.length > 0) {
    const summaries = await listQualityGateSummaries(generationKeys);
    for (const m of messages) {
      if (m.generationKey != null) m.qualityGate = summaries.get(m.generationKey) ?? null;
    }
  }
  return messages;
}

export interface ChapterChatInput {
  userId: number;
  novelId: number;
  chapterId: number;
  content: string;
  model: ChatModel;
  styleId?: number | null;
  skills?: string[];
  /** 客户端生成请求键；重试同一请求时复用，重试失败结果必须生成新键。 */
  generationKey?: string;
  /** J9：AI 请求以选区为输入的绑定快照（改写/润色等；注入 [所选片段]，不持久化） */
  selection?: { start: number; end: number; text: string };
  onDelta: (text: string) => void;
  /** 客户端断开（停止语义）：流中 abort → 消息标记 stopped */
  signal?: AbortSignal;
}

export interface ChapterChatResult {
  messageId: number;
  reply: string;
  /** 是否因客户端断开而停止 */
  stopped: boolean;
  status: ChapterMessageStatus;
  injected: string[];
  /** V1.3 工单 01：本次生成的技能运行时证据（done.skillRuns） */
  skillRuns: SkillRun[];
  /** V1.3 工单 01：生成计划锚点（= generationKey；证据端点路径） */
  generationId: string;
}

/**
 * 一轮章节对话：归属校验 → 存 user 消息 → 组装注入链 → 管线流式生成 → AI 消息落库。
 * 停止：onDelta 抛错（enqueue 失败）且 signal.aborted → AI 消息 status=stopped（保留已生成部分）。
 */
export async function runChapterChat(input: ChapterChatInput): Promise<ChapterChatResult> {
  const generationKey = input.generationKey?.trim() || randomUUID();
  if (generationKey.length > 120) throw new ChapterChatError("生成请求键过长");
  const requestHash = createHash("sha256").update(input.content).digest("hex");
  const prepared = await prepareChapterCandidate({
    userId: input.userId,
    novelId: input.novelId,
    chapterId: input.chapterId,
    content: input.content,
    skills: input.skills ?? [],
    generationKey,
    requestHash,
  });

  const candidate = prepared.candidate;
  if (prepared.reused) {
    const normalizedStatus = normalizeCandidateStatus({
      inserted: candidate.inserted,
      status: candidate.status as ChapterMessageStatus,
    });
    return {
      messageId: candidate.id,
      reply: candidate.content,
      stopped: normalizedStatus === "stopped",
      status: normalizedStatus,
      injected: [],
      // 复用候选：读回同一 generationId 的既有证据
      skillRuns: await listSkillRunsByGeneration(generationKey),
      generationId: generationKey,
    };
  }

  const currentMessage = prepared.storedMessages.find(
    (message) => message.id === prepared.userMessageId,
  );
  if (!currentMessage) throw new Error("当前消息读取失败");

  const history = buildChapterReplayHistory(
    prepared.storedMessages.map((message) => ({
      id: message.id,
      role: message.role as "user" | "assistant",
      content: message.content,
      status: normalizePersistedChapterMessageStatus({
        role: message.role as "user" | "assistant",
        status: message.status as ChapterMessageStatus,
        inserted: message.inserted,
      }),
    })),
    currentMessage.id,
    candidate.id,
  );
  const transport = createLlmTransportFromEnv();

  let compressed = false;
  let summary = "";
  let providerHistory = history;
  if (shouldCompress(history)) {
    try {
      const result = await compressHistory(history, transport, input.model);
      const candidateSummary = typeof result.summary === "string" ? result.summary.trim() : "";
      if (candidateSummary && isUsableKeptHistory(history, result.kept)) {
        summary = candidateSummary;
        providerHistory = result.kept;
        compressed = true;
      }
    } catch {
      // 摘要器异常时 fail-open：保留完整章节历史继续请求。
    }
  }

  // 注入链组装（按序）：正文参考 → 所选片段(J9) → RAG → 风格 → 技能
  const contextSections: WritingContextSection[] = [];
  let stylePresent = false;
  let skillCount = 0;
  let hasBodyReference = false;
  let hasValidatedSelection = false;
  const bodyRef = prepared.currentChapter.content.slice(-BODY_REF_LIMIT);
  if (bodyRef.trim()) {
    hasBodyReference = true;
    const content = `[正文参考] 当前章节前文（末尾 ${bodyRef.length} 字）：\n${bodyRef}`;
    contextSections.push({ kind: "chapter_reference", content });
  }
  if (input.selection) {
    hasValidatedSelection = true;
    const content = `[所选片段] 用户选中的 ${input.selection.text.length} 字（若本条请求是针对该片段处理，请严格以其内容为对象）：\n${input.selection.text}`;
    contextSections.push({ kind: "selection", content });
  }
  // V1.3 工单 01：RAG 直拼迁移到技能运行时（story_grounding 执行器，经 ContextAssembler 组装）。
  const builtinDefinitions = await loadBuiltinSkillDefinitions();
  // 工单 08 收尾：自定义技能（已声明契约）经运行时执行并留下证据；未声明契约不注入正式写作
  const userSkillNames = (input.skills ?? []).filter((s) => !SCENE_SKILLS[s]);
  const customSkillDefinitions = await loadCustomSkillDefinitions(input.userId, userSkillNames);
  const pipeline = await runRuntimePipeline({
    userId: input.userId,
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterContent: prepared.currentChapter.content,
    request: input.content,
    mode: "chapter",
    scopeType: "chapter",
    scopeId: input.chapterId,
    generationId: generationKey,
    styleId: input.styleId,
    definitions: builtinDefinitions.filter((d) => d.enabled),
    customSkills: customSkillDefinitions,
  });
  contextSections.push(...pipeline.sections);
  const ragLines = pipeline.ragEntries.map(
    (entry) => `[${entry.kind === "character" ? "人物" : "设定"}] ${entry.name}${entry.note ? `：${entry.note}` : ""}`,
  );
  // 工单 04：style 注入已迁移到 narrative_style 执行器（经 ContextAssembler）；stylePresent 由证据派生
  stylePresent = pipeline.runs.some(
    (r) => r.skillKey === "narrative_style" && r.evidence === "applied",
  );
  const skills = input.skills ?? [];
  for (const name of skills) {
    if (SCENE_SKILLS[name]) {
      skillCount += 1;
      const content = `[技能] ${name}：${SCENE_SKILLS[name]}`;
      contextSections.push({ kind: "skill", content });
    }
  }
  skillCount += customSkillDefinitions.length;

  if (summary) {
    contextSections.push({ kind: "compression_summary", content: summary });
  }

  const snapshot = prepared.currentChapter.content; // 生成时正文快照（插入冲突检测基准）
  const preparedRequest = buildWritingContext({
    model: input.model,
    mode: "chapter",
    sections: contextSections,
    history: providerHistory,
    currentUser: { role: "user", content: currentMessage.content },
    observation: {
      requestId: pipeline.generationId,
      route: "chapter-chat",
      mode: "chapter",
      historyCountBefore: history.length,
      compressionApplied: compressed,
      ragEntryCount: pipeline.ragEntryCount,
      stylePresent,
      skillCount,
      novelScopePresent: true,
      chapterScopePresent: true,
      ownerScopeResolved: true,
    },
  });
  // V1.3 工单 01：GenerationManifest 捕获（白名单脱敏；失败不阻断主请求）。
  await persistGenerationManifest(
    buildGenerationManifest({
      generationId: pipeline.generationId,
      requestId: pipeline.generationId,
      model: input.model,
      sections: fullPayloadSections("chapter", contextSections),
      messageRoles: preparedRequest.messages.map((message) => message.role),
      runs: pipeline.runs,
      currentUserPresent: preparedRequest.messages.at(-1)?.role === "user",
    }),
  ).catch(() => {});
  const provider = makeChatProvider(preparedRequest, transport);
  let reply = "";
  let stopped = false;

  const state = await runNodeStream(
    initialState(),
    { nodeType: "章节对话", provider },
    (text) => {
      reply += text;
      try {
        input.onDelta(text);
      } catch (err) {
        // enqueue 失败（客户端断开）→ 传播为停止
        if (input.signal?.aborted) stopped = true;
        throw err;
      }
    },
  );

  const settled = await persistChapterCandidateSettlement({
    candidateId: candidate.id,
    reply,
    providerSucceeded: state.task?.status === "ok",
    stopped,
    errorMessage: state.task?.lastError,
  }).catch((error) => {
    throw new ChapterChatError((error as Error).message);
  });

  if (state.task?.status === "ok") {
    await recordUsage(input.userId, "章节对话", state.ledger.prompt, state.ledger.completion).catch(() => {});
  }
  // V1.3 工单 03：post_write 质量门——候选生成后、确认前运行（两组检查分开记录）
  const postWriteRuns: SkillRun[] = state.task?.status === "ok"
    ? await runPostWriteValidators({
        userId: input.userId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        request: input.content,
        candidate: reply || null,
        generationId: pipeline.generationId,
        definitions: builtinDefinitions.filter((d) => d.enabled),
      })
    : [];
  // 非停止且失败 → 抛错（路由层转 error 事件）
  if (!stopped && state.task?.status !== "ok") {
    throw new ChapterChatError(state.task?.lastError ?? "生成失败");
  }

  return {
    messageId: settled.messageId,
    reply,
    stopped,
    status: settled.status,
    injected: [
      ...ragLines,
      ...contextSections
        .filter((section) => section.kind !== "owner_context")
        .map((section) => section.content),
    ],
    skillRuns: [...pipeline.runs, ...postWriteRuns],
    generationId: pipeline.generationId,
  };
}

export async function insertChapterMessage(
  userId: number,
  novelId: number,
  chapterId: number,
  messageId: number,
  content: string,
  force: boolean,
  target?: InsertTarget,
): Promise<InsertResult> {
  return applyChapterCandidate({
    userId,
    novelId,
    chapterId,
    messageId,
    suppliedContent: content,
    force,
    target,
  });
}

/**
 * 质量门覆盖动作入证据（工单 03 收尾）：用户确认插入存在未通过检查项的候选时，
 * 在 quality_gate 的 SkillRun.reason 追加覆盖记录（不静默放行）。
 */
export async function recordQualityGateOverride(
  chapterId: number,
  messageId: number,
): Promise<{ summary: string | null; overridden: boolean }> {
  const [msg] = await db
    .select({ generationKey: chapterMessages.generationKey })
    .from(chapterMessages)
    .where(and(eq(chapterMessages.id, messageId), eq(chapterMessages.chapterId, chapterId)));
  if (!msg?.generationKey) return { summary: null, overridden: false };
  const summaries = await listQualityGateSummaries([msg.generationKey]);
  const summary = summaries.get(msg.generationKey) ?? null;
  if (!summary || !summary.includes("未通过")) return { summary, overridden: false };
  const [run] = await db
    .select({ id: skillRunsTable.id, reason: skillRunsTable.reason })
    .from(skillRunsTable)
    .where(
      and(
        eq(skillRunsTable.generationId, msg.generationKey),
        eq(skillRunsTable.skillKey, "quality_gate"),
      ),
    )
    .limit(1);
  if (run) {
    const note = "用户确认插入时存在未通过检查项（覆盖动作已记录）";
    await db
      .update(skillRunsTable)
      .set({ reason: [run.reason, note].filter(Boolean).join("｜") })
      .where(eq(skillRunsTable.id, run.id));
  }
  return { summary, overridden: true };
}

/** 用户忽略候选后将其标记为已丢弃，刷新/重登后不再出现可插入动作。 */
export async function discardChapterMessage(
  userId: number,
  novelId: number,
  chapterId: number,
  messageId: number,
): Promise<boolean> {
  return discardChapterCandidate({ userId, novelId, chapterId, messageId });
}
