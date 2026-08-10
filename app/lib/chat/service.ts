// 对话会话服务：会话 CRUD + runChat（管线流式 + 持久化）
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, sessions, skills as skillsTable, styles as stylesTable } from "@/lib/schema";
import { initialState, runNodeStream } from "@/lib/pipeline/engine";
import type { PipelineState } from "@/lib/pipeline/reducer";
import { makeChatProvider, buildSystemPrompt, type ChatMessage } from "./stream-provider";
import { retrieveContext, type RagEntry } from "@/lib/novels/rag";
import { compressHistory, shouldCompress } from "./compress";
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

/** 校验会话归属；归属存在返回消息列表（可能为空），否则返回 null */
export async function listMessages(
  sessionId: number,
  userId: number,
): Promise<ChatMessage[] | null> {
  const [owner] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (!owner) return null;
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);
  return rows.map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));
}

/** 归属校验（写路径防 IDOR）：会话不存在或不属于该用户时抛错 */
async function assertOwned(sessionId: number, userId: number): Promise<void> {
  const [owner] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (!owner) throw new SessionNotFoundError();
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
}

/**
 * 执行一轮对话：校验归属 → 存用户消息 → 管线流式调用（记账）→ 成功后存助手消息。
 * 会话标题取首条用户消息前 20 字。
 */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  await assertOwned(input.sessionId, input.userId); // 写路径防 IDOR

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

  const history = await listMessages(input.sessionId, input.userId);
  // 上下文压缩（12 工单）：历史超阈值 → 早期消息摘要化，摘要注入 system
  let compressed = false;
  let summary = "";
  if (history && shouldCompress(history)) {
    const r = await compressHistory(history);
    summary = r.summary;
    compressed = summary.length > 0;
  }
  // RAG 注入（06 工单）：按当前输入 + 绑定作品检索相关设定条目，注入 system 提示
  const injected = await retrieveContext(input.userId, input.content, {
    novelId: input.novelId ?? null,
  });
  // 风格（R4 决策 + 工单 15）：styleId 引用 → 查风格库注入完整四维指南（写路径归属校验）
  const extra: string[] = [];
  if (summary) extra.push(summary);
  if (input.styleId) {
    const styleRows = await db
      .select({ name: stylesTable.name, guide: stylesTable.guide })
      .from(stylesTable)
      .where(and(eq(stylesTable.id, input.styleId), eq(stylesTable.userId, input.userId)));
    for (const row of styleRows) {
      extra.push(
        `[风格] ${row.name}：叙事视角——${row.guide.narrative}；句式节奏——${row.guide.sentence}；意象偏好——${row.guide.imagery}；情绪节奏——${row.guide.rhythm}`,
      );
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
      extra.push(`[技能] ${row.name}：${row.systemPrompt}`);
    }
  }
  const provider = makeChatProvider(
    input.model,
    history ?? [],
    buildSystemPrompt([
      ...injected.map((e) => `[${e.kind === "character" ? "人物" : "设定"}] ${e.name}${e.note ? `：${e.note}` : ""}`),
      ...extra,
    ]),
  );
  const state = await runNodeStream(
    initialState(),
    { nodeType: "写作对话", provider },
    input.onDelta,
  );

  const reply = state.task?.outputs.at(-1) ?? "";
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
    return { state, reply, messageId: assistantMsg?.id, injected, compressed };
  }
  return { state, reply, injected, compressed };
}
