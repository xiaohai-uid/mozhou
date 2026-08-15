// 对话会话服务：会话 CRUD + runChat（管线流式 + 持久化）
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  messages,
  novels,
  sessions,
  skills as skillsTable,
  styles as stylesTable,
} from "@/lib/schema";
import { initialState, runNodeStream } from "@/lib/pipeline/engine";
import type { PipelineState } from "@/lib/pipeline/reducer";
import { makeChatProvider } from "./stream-provider";
import { createLlmTransportFromEnv } from "./llm-transport";
import { buildWritingContext, type WritingContextSection } from "./writing-context";
import type { ChatMessage } from "./payload";
import type { RagEntry } from "@/lib/novels/rag";
import {
  buildGenerationManifest,
  persistGenerationManifest,
} from "@/lib/runtime/generation-manifest";
import { runPostWriteValidators, runRuntimePipeline } from "@/lib/runtime/service";
import { loadBuiltinSkillDefinitions } from "@/lib/runtime/skill-registry";
import type { SkillRun } from "@/lib/runtime/types";
import {
  buildBriefingResponse,
  fetchRecentSnapshots,
} from "@/lib/market/service";
import { compressHistory, isUsableKeptHistory, shouldCompress } from "./compress";
import { recordUsage } from "@/lib/account/service";
import type { ChatModel } from "./models";

export { DEFAULT_MODEL, MODELS, isChatModel } from "./models";
export type { ChatModel } from "./models";

export const DEFAULT_TITLE = "新会话";

/** 会话不存在或不属于该用户 */
export class SessionNotFoundError extends Error {
  constructor() {
    super("会话不存在");
    this.name = "SessionNotFoundError";
  }
}

export interface SessionRow {
  id: number;
  title: string;
  createdAt: Date;
  novelId: number | null;
}

export async function createSession(
  userId: number,
  title: string = DEFAULT_TITLE,
  novelId?: number | null,
): Promise<SessionRow> {
  if (novelId != null && !(await isNovelOwned(userId, novelId))) {
    throw new SessionNotFoundError();
  }
  const [row] = await db
    .insert(sessions)
    .values({ userId, title, novelId: novelId ?? null })
    .returning({
      id: sessions.id,
      title: sessions.title,
      createdAt: sessions.createdAt,
      novelId: sessions.novelId,
    });
  return row!;
}

export async function listSessions(userId: number): Promise<SessionRow[]> {
  return db
    .select({
      id: sessions.id,
      title: sessions.title,
      createdAt: sessions.createdAt,
      novelId: sessions.novelId,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));
}

/** 服务端确认的会话上下文；客户端每轮 novelId 不参与裁决。 */
export async function getOwnedSessionContext(
  sessionId: number,
  userId: number,
): Promise<{ id: number; novelId: number | null } | null> {
  const [session] = await db
    .select({ id: sessions.id, novelId: sessions.novelId })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return session ?? null;
}

/** 作品绑定只接受当前用户拥有的作品。 */
export async function isNovelOwned(userId: number, novelId: number): Promise<boolean> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
  return Boolean(novel);
}

/** 校验会话归属；归属存在返回消息列表（可能为空），否则返回 null */
export async function listMessages(
  sessionId: number,
  userId: number,
): Promise<ChatMessage[] | null> {
  if (!(await getOwnedSessionContext(sessionId, userId))) return null;
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt, messages.id);
  return rows.map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));
}

type StoredChatMessage = ChatMessage & { id: number };

/** 独立对话内部使用带 identity 的消息列表，把本轮消息与历史分开。 */
async function listMessagesWithIds(
  sessionId: number,
  userId: number,
): Promise<StoredChatMessage[] | null> {
  if (!(await getOwnedSessionContext(sessionId, userId))) return null;
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt, messages.id);
  return rows.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));
}

export interface RunChatInput {
  userId: number;
  sessionId: number;
  model: ChatModel;
  content: string;
  novelId?: number | null;
  /** 风格引用（工单 15）：风格库 id，服务端查表注入完整四维指南 */
  styleId?: number | null;
  skills?: string[];
  /** marketRef（场景 A，本轮只做数据源）：true 时注入市场风向简报文本。 */
  marketRef?: boolean;
  onDelta: (text: string) => void;
}

export interface RunChatResult {
  state: PipelineState;
  /** 完整回复（终态 ok 时存在） */
  reply: string;
  /** 落库后的助手消息 id（ok 时） */
  messageId?: number;
  /** RAG 注入的设定条目（06 工单；供界面展示作者可见） */
  injected: RagEntry[];
  /** 本次是否触发上下文压缩（12 工单；UI 可见） */
  compressed: boolean;
  /** V1.3 工单 01：本次生成的技能运行时证据（done.skillRuns） */
  skillRuns: SkillRun[];
  /** V1.3 工单 01：生成计划锚点（证据端点路径） */
  generationId: string;
}

/**
 * 执行一轮对话：校验归属 → 存用户消息 → 管线流式调用（记账）→ 成功后存助手消息。
 * 会话标题取首条用户消息前 20 字。
 */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  const ownedSession = await getOwnedSessionContext(input.sessionId, input.userId);
  if (!ownedSession) throw new SessionNotFoundError();

  const [userMsg] = await db
    .insert(messages)
    .values({ sessionId: input.sessionId, role: "user", content: input.content })
    .returning({ id: messages.id });
  if (!userMsg) throw new Error("消息入库失败");

  const [sessionRow] = await db
    .select({ title: sessions.title })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId));
  if (sessionRow && sessionRow.title === DEFAULT_TITLE) {
    const title = input.content.trim().slice(0, 20) || DEFAULT_TITLE;
    await db.update(sessions).set({ title }).where(eq(sessions.id, input.sessionId));
  }

  const storedMessages = await listMessagesWithIds(input.sessionId, input.userId);
  if (!storedMessages) throw new SessionNotFoundError();
  const currentMessage = storedMessages.find((message) => message.id === userMsg.id);
  if (!currentMessage) throw new Error("当前消息读取失败");
  const history = storedMessages
    .filter((message) => message.id !== currentMessage.id)
    .map(({ role, content }) => ({ role, content }));
  const transport = createLlmTransportFromEnv();

  // 上下文压缩（12 工单）：只压缩历史，本轮 user 永远独立追加到末尾。
  let compressed = false;
  let summary = "";
  let providerHistory = history;
  if (shouldCompress(history)) {
    try {
      const r = await compressHistory(history, transport, input.model);
      const candidateSummary = typeof r.summary === "string" ? r.summary.trim() : "";
      if (candidateSummary && isUsableKeptHistory(history, r.kept)) {
        summary = candidateSummary;
        providerHistory = r.kept;
        compressed = true;
      }
    } catch {
      // 摘要器异常时 fail-open：不发送摘要，保留完整历史继续请求。
    }
  }
  // V1.3 工单 01：RAG 直拼迁移到技能运行时（story_grounding 执行器，经 ContextAssembler 组装）。
  // 未绑定作品时 story_grounding 被输入门跳过（reason「未绑定作品」），不伪造产物。
  const builtinDefinitions = await loadBuiltinSkillDefinitions();
  const pipeline = await runRuntimePipeline({
    userId: input.userId,
    novelId: ownedSession.novelId,
    chapterId: null,
    chapterContent: null,
    request: input.content,
    mode: "independent",
    scopeType: "session",
    scopeId: input.sessionId,
    definitions: builtinDefinitions.filter((d) => d.enabled),
  });
  const injected: RagEntry[] = pipeline.ragEntries;
  // 风格（R4 决策 + 工单 15）：styleId 引用 → 查风格库注入完整四维指南（写路径归属校验；工单 04 迁移到 narrative_style 执行器）
  const contextSections: WritingContextSection[] = [...pipeline.sections];
  let stylePresent = false;
  let skillCount = 0;
  if (input.styleId) {
    const styleRows = await db
      .select({ name: stylesTable.name, guide: stylesTable.guide })
      .from(stylesTable)
      .where(and(eq(stylesTable.id, input.styleId), eq(stylesTable.userId, input.userId)));
    for (const row of styleRows) {
      stylePresent = true;
      contextSections.push({
        kind: "style",
        content: `[风格] ${row.name}：叙事视角——${row.guide.narrative}；句式节奏——${row.guide.sentence}；意象偏好——${row.guide.imagery}；情绪节奏——${row.guide.rhythm}`,
      });
    }
  }
  if (input.skills && input.skills.length > 0) {
    const skillRows = await db
      .select({ name: skillsTable.name, systemPrompt: skillsTable.systemPrompt })
      .from(skillsTable)
      .where(
        and(
          eq(skillsTable.userId, input.userId),
          inArray(skillsTable.name, input.skills),
        ),
    );
    for (const row of skillRows) {
      skillCount += 1;
      contextSections.push({ kind: "skill", content: `[技能] ${row.name}：${row.systemPrompt}` });
    }
  }
  // marketRef（T9 场景 A 数据源：只注入简报文本，改动最小，不动 chat 主链路）
  if (input.marketRef) {
    try {
      const marketRows = await fetchRecentSnapshots(7);
      const briefing = buildBriefingResponse(marketRows, new Date().toISOString(), new Date().toISOString());
      if (briefing.status === 200) {
        contextSections.push({ kind: "market", content: briefing.rendered });
      }
    } catch {
      // 市场数据拉取失败不阻断对话；本轮仅作可选增强。
    }
  }
  if (summary) {
    contextSections.push({ kind: "compression_summary", content: summary });
  }
  const prepared = buildWritingContext({
    model: input.model,
    mode: "independent",
    sections: contextSections,
    history: providerHistory,
    currentUser: currentMessage,
    observation: {
      requestId: pipeline.generationId,
      route: "chat",
      mode: "independent",
      historyCountBefore: history.length,
      compressionApplied: compressed,
      ragEntryCount: injected.length,
      stylePresent,
      skillCount,
      novelScopePresent: ownedSession.novelId != null,
      chapterScopePresent: false,
      ownerScopeResolved: true,
    },
  });
  // V1.3 工单 01：GenerationManifest 捕获（白名单脱敏；失败不阻断主请求）。
  await persistGenerationManifest(
    buildGenerationManifest({
      generationId: pipeline.generationId,
      requestId: pipeline.generationId,
      model: input.model,
      sections: contextSections,
      messageRoles: prepared.messages.map((message) => message.role),
      runs: pipeline.runs,
      currentUserPresent: true,
    }),
  ).catch(() => {});
  const provider = makeChatProvider(prepared, transport);
  const state = await runNodeStream(
    initialState(),
    { nodeType: "写作对话", provider },
    input.onDelta,
  );

  const reply = state.task?.outputs.at(-1) ?? "";
  // V1.3 工单 03：post_write 质量门（独立对话无候选 → skipped「无候选正文」，如实证据）
  const postWriteRuns = await runPostWriteValidators({
    userId: input.userId,
    novelId: ownedSession.novelId,
    chapterId: null,
    request: input.content,
    candidate: reply || null,
    generationId: pipeline.generationId,
    definitions: builtinDefinitions.filter((d) => d.enabled),
  });
  const skillRuns = [...pipeline.runs, ...postWriteRuns];
  // 用量记账（11 工单）：chat 每轮落 usage_events
  await recordUsage(
    input.userId,
    "写作对话",
    state.ledger.prompt,
    state.ledger.completion,
  ).catch(() => {
    // 记账失败不阻断对话
  });
  if (state.task?.status === "ok" && reply) {
    const [assistantMsg] = await db
      .insert(messages)
      .values({ sessionId: input.sessionId, role: "assistant", content: reply })
      .returning({ id: messages.id });
    return { state, reply, messageId: assistantMsg?.id, injected, compressed, skillRuns, generationId: pipeline.generationId };
  }
  return { state, reply, injected, compressed, skillRuns, generationId: pipeline.generationId };
}
