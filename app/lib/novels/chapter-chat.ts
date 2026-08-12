// 章节对话引擎（工单 17，V1.1 Journey ⑦）：章节 AI 对话——消息持久化 + 技能驱动生成。
// 注入链（system，按序）：正文参考（末尾 3000 字）→ RAG 设定（novelId，复用 06 工单）→ 风格（styleId，复用 15）→ 技能（内置场景技能 + 我的技能）。
// 生成内核复用 runNodeStream（管线 seam 不新增）；mock provider 回显 system 使注入可断言。
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chapterMessages,
  chapters,
  skills as skillsTable,
  styles as stylesTable,
} from "@/lib/schema";
import { getChapter } from "./service";
import { retrieveContext } from "./rag";
import { initialState, runNodeStream } from "@/lib/pipeline/engine";
import { makeChatProvider } from "@/lib/chat/stream-provider";
import { buildWritingContext, type WritingContextSection } from "@/lib/chat/writing-context";
import { createLlmTransportFromEnv } from "@/lib/chat/llm-transport";
import { recordUsage } from "@/lib/account/service";
import type { ChatModel } from "@/lib/chat/models";
import type { ChatMessage } from "@/lib/chat/payload";
import {
  compressHistory,
  isUsableKeptHistory,
  shouldCompress,
} from "@/lib/chat/compress";

/** 内置场景技能（工单 19 正式化；此处为注入链基础）：名称 → systemPrompt */
export const SCENE_SKILLS: Record<string, string> = {
  章节续写: "通读前文与作品设定；保持叙事视角与句式节奏；结尾留钩子。只输出正文。",
  章节起笔: "根据作品设定与风格指南起笔；建立场景与人物；结尾留钩子。只输出正文。",
};

/** 章节不存在或不属于该用户（写路径防 IDOR，路由层转 404） */
export class ChapterNotFoundError extends Error {
  constructor() {
    super("章节不存在");
    this.name = "ChapterNotFoundError";
  }
}

/** 生成失败（非停止）：路由层转 error 事件 */
export class ChapterChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterChatError";
  }
}

/** 正文参考注入长度上限（契约 21 第 6 节） */
const BODY_REF_LIMIT = 3000;

export interface ChapterMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  skills: string[];
  snapshot: string;
  status: "done" | "stopped" | "error";
  inserted: boolean;
  createdAt: string;
}

function toRow(m: typeof chapterMessages.$inferSelect): ChapterMessageRow {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    skills: m.skills,
    snapshot: m.snapshot,
    status: m.status as "done" | "stopped" | "error",
    inserted: m.inserted,
    createdAt: m.createdAt.toISOString(),
  };
}

/** 章节对话历史（新→旧；契约 21：全量返回，分页留后续） */
export async function listChapterMessages(
  userId: number,
  novelId: number,
  chapterId: number,
): Promise<ChapterMessageRow[] | null> {
  const chapter = await getChapter(userId, novelId, chapterId);
  if (!chapter) return null;
  const rows = await db
    .select()
    .from(chapterMessages)
    .where(eq(chapterMessages.chapterId, chapterId))
    .orderBy(desc(chapterMessages.createdAt), desc(chapterMessages.id));
  return rows.map(toRow);
}

export interface ChapterChatInput {
  userId: number;
  novelId: number;
  chapterId: number;
  content: string;
  model: ChatModel;
  styleId?: number | null;
  skills?: string[];
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
  injected: string[];
}

/**
 * 一轮章节对话：归属校验 → 存 user 消息 → 组装注入链 → 管线流式生成 → AI 消息落库。
 * 停止：onDelta 抛错（enqueue 失败）且 signal.aborted → AI 消息 status=stopped（保留已生成部分）。
 */
export async function runChapterChat(input: ChapterChatInput): Promise<ChapterChatResult> {
  const chapter = await getChapter(input.userId, input.novelId, input.chapterId);
  if (!chapter) throw new ChapterNotFoundError();

  const [userMsg] = await db
    .insert(chapterMessages)
    .values({
      chapterId: input.chapterId,
      userId: input.userId,
      role: "user",
      content: input.content,
    })
    .returning({ id: chapterMessages.id });
  if (!userMsg) throw new Error("消息入库失败");

  const storedMessages = await db
    .select({ id: chapterMessages.id, role: chapterMessages.role, content: chapterMessages.content })
    .from(chapterMessages)
    .where(eq(chapterMessages.chapterId, input.chapterId))
    .orderBy(chapterMessages.createdAt, chapterMessages.id);
  const currentMessage = storedMessages.find((message) => message.id === userMsg.id);
  if (!currentMessage) throw new Error("当前消息读取失败");
  const history: ChatMessage[] = storedMessages
    .filter((message) => message.id !== currentMessage.id)
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));
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
  const bodyRef = chapter.content.slice(-BODY_REF_LIMIT);
  if (bodyRef.trim()) {
    const content = `[正文参考] 当前章节前文（末尾 ${bodyRef.length} 字）：\n${bodyRef}`;
    contextSections.push({ kind: "chapter_reference", content });
  }
  if (input.selection) {
    const content = `[所选片段] 用户选中的 ${input.selection.text.length} 字（若本条请求是针对该片段处理，请严格以其内容为对象）：\n${input.selection.text}`;
    contextSections.push({ kind: "selection", content });
  }
  const injectedRag = await retrieveContext(input.userId, input.content, {
    novelId: input.novelId,
  });
  const ragLines = injectedRag.map(
    (entry) => `[${entry.kind === "character" ? "人物" : "设定"}] ${entry.name}${entry.note ? `：${entry.note}` : ""}`,
  );
  contextSections.push(...ragLines.map((content) => ({ kind: "owner_context" as const, content })));
  if (input.styleId) {
    const [styleRow] = await db
      .select({ name: stylesTable.name, guide: stylesTable.guide })
      .from(stylesTable)
      .where(and(eq(stylesTable.id, input.styleId), eq(stylesTable.userId, input.userId)));
    if (styleRow) {
      stylePresent = true;
      const content = `[风格] ${styleRow.name}：叙事视角——${styleRow.guide.narrative}；句式节奏——${styleRow.guide.sentence}；意象偏好——${styleRow.guide.imagery}；情绪节奏——${styleRow.guide.rhythm}`;
        contextSections.push({ kind: "style", content });
    }
  }
  const skills = input.skills ?? [];
  const userSkillNames = skills.filter((s) => !SCENE_SKILLS[s]);
  if (userSkillNames.length > 0) {
    const skillRows = await db
      .select({ name: skillsTable.name, systemPrompt: skillsTable.systemPrompt })
      .from(skillsTable)
      .where(
        and(
          eq(skillsTable.userId, input.userId),
          inArray(skillsTable.name, userSkillNames),
        ),
    );
    for (const row of skillRows) {
      skillCount += 1;
      const content = `[技能] ${row.name}：${row.systemPrompt}`;
        contextSections.push({ kind: "skill", content });
    }
  }
  for (const name of skills) {
    if (SCENE_SKILLS[name]) {
      skillCount += 1;
      const content = `[技能] ${name}：${SCENE_SKILLS[name]}`;
        contextSections.push({ kind: "skill", content });
    }
  }

  if (summary) {
    contextSections.push({ kind: "compression_summary", content: summary });
  }

  const snapshot = chapter.content; // 生成时正文快照（插入冲突检测基准，工单 18 消费）
  const provider = makeChatProvider(buildWritingContext({
    model: input.model,
    mode: "chapter",
    sections: contextSections,
    history: providerHistory,
    currentUser: { role: "user", content: currentMessage.content },
    observation: {
      route: "chapter-chat",
      mode: "chapter",
      historyCountBefore: history.length,
      compressionApplied: compressed,
      ragEntryCount: injectedRag.length,
      stylePresent,
      skillCount,
      novelScopePresent: true,
      chapterScopePresent: true,
      ownerScopeResolved: true,
    },
  }), transport);
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

  // AI 消息落库（skills 快照 + 正文快照 + 状态）
  const [aiMsg] = await db
    .insert(chapterMessages)
    .values({
      chapterId: input.chapterId,
      userId: input.userId,
      role: "assistant",
      content: reply,
      skills,
      snapshot,
      status: stopped ? "stopped" : state.task?.status === "ok" ? "done" : "error",
    })
    .returning({ id: chapterMessages.id });

  if (state.task?.status === "ok") {
    await recordUsage(input.userId, "章节对话", state.ledger.prompt, state.ledger.completion).catch(() => {});
  }
  // 非停止且失败 → 抛错（路由层转 error 事件）
  if (!stopped && state.task?.status !== "ok") {
    throw new ChapterChatError(state.task?.lastError ?? "生成失败");
  }

  return {
    messageId: aiMsg?.id ?? 0,
    reply,
    stopped,
    injected: [
      ...ragLines,
      ...contextSections
        .filter((section) => section.kind !== "owner_context")
        .map((section) => section.content),
    ],
  };
}

/** 插入冲突（正文已变化，快照比对失败且非 force）：路由层转 409 */
export class ContentChangedError extends Error {
  constructor() {
    super("正文已变化，这条回复基于旧正文");
    this.name = "ContentChangedError";
  }
}

export interface InsertResult {
  chapter: { content: string; updatedAt: string };
  messageId: number;
}

/** J9 插入目标（契约：position/range 均为 UTF-16 code unit，与 textarea selectionStart/End 一致） */
export interface InsertTarget {
  mode: "insert" | "replace";
  position?: number;
  range?: { start: number; end: number };
  /** 点击插入时客户端已落盘的正文（第一层乐观并发：与当前正文不一致 → 409） */
  expectedContent?: string;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/**
 * 插入 AI 消息到正文（工单 18 + J9 精确插入）。
 * 冲突语义（J9 收紧，替代"生成时整章快照变化=必然冲突"）：
 * - 第一层：expectedContent !== 当前正文 且非 force → ContentChangedError（409）——保护点击插入后的真实竞争；
 * - 第二层（selection source conflict）由客户端本地判定（bound 场景），服务端不重复；
 * - force 只跳过用户已确认的内容冲突，**不绕过** range/position/归属校验（越界一律 400，不 silent clamp）。
 * 插入语义：position 提供 → 纯 splice（无自动分隔符）；省略 → 旧版末尾追加（+\n\n，向后兼容）。
 */
export async function insertChapterMessage(
  userId: number,
  novelId: number,
  chapterId: number,
  messageId: number,
  content: string,
  force: boolean,
  target?: InsertTarget,
): Promise<InsertResult> {
  const chapter = await getChapter(userId, novelId, chapterId);
  if (!chapter) throw new ChapterNotFoundError();

  const [msg] = await db
    .select()
    .from(chapterMessages)
    .where(and(eq(chapterMessages.id, messageId), eq(chapterMessages.chapterId, chapterId)));
  if (!msg) throw new Error("消息不存在");
  if (msg.role !== "assistant") throw new Error("只能插入 AI 回复");
  if (msg.inserted) throw new Error("该回复已插入过正文");
  const insertText = content.trim();
  if (!insertText) throw new Error("插入内容不能为空");

  // J9 target 校验（先于内容冲突；force 同样执行，不允许 silent clamp）
  const mode = target?.mode ?? "insert";
  if (mode !== "insert" && mode !== "replace") throw new Error("无效的插入模式");
  const len = chapter.content.length;
  let next: string;
  if (mode === "replace") {
    const r = target?.range;
    if (!r || !isInt(r.start) || !isInt(r.end) || r.start < 0 || r.end < r.start || r.end > len) {
      throw new Error("替换区间无效");
    }
    next = chapter.content.slice(0, r.start) + insertText + chapter.content.slice(r.end);
  } else if (target?.position !== undefined) {
    const p = target.position;
    if (!isInt(p) || p < 0 || p > len) throw new Error("插入位置无效");
    next = chapter.content.slice(0, p) + insertText + chapter.content.slice(p);
  } else {
    // 旧版路径：正文末尾追加（+\n\n 段落分隔）
    next = chapter.content.trim() ? chapter.content + "\n\n" + insertText : insertText;
  }

  // J9 第一层：点击插入时客户端正文 vs 服务端当前正文（force 跳过 = 用户已确认）
  if (!force && target?.expectedContent !== undefined && target.expectedContent !== chapter.content) {
    throw new ContentChangedError();
  }

  await db
    .update(chapters)
    .set({ content: next, updatedAt: sql`now()` })
    .where(eq(chapters.id, chapterId));
  await db
    .update(chapterMessages)
    .set({ inserted: true })
    .where(eq(chapterMessages.id, messageId));

  return {
    chapter: { content: next, updatedAt: new Date().toISOString() },
    messageId,
  };
}
