import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapterMessages, chapters, generationAttempts } from "@/lib/schema";
import { resolveChapterOwnership } from "./ownership";
import type { ChapterChatErrorCode } from "./chapter-chat-errors";

export type CandidateStatus =
  | "done"
  | "generating"
  | "completed_candidate"
  | "stopped"
  | "error"
  | "applied"
  | "discarded";

export type CandidateApplyMode = "original" | "edited";

export interface CandidateRecord {
  status: CandidateStatus;
  inserted: boolean;
}

export interface PersistedChapterMessageStatus {
  role: "user" | "assistant";
  status: CandidateStatus;
  inserted: boolean;
}

export function normalizeCandidateStatus(candidate: CandidateRecord): CandidateStatus {
  if (candidate.inserted || candidate.status === "applied") return "applied";
  return candidate.status === "done" ? "completed_candidate" : candidate.status;
}

/** Keeps user history values intact while normalizing assistant candidate persistence. */
export function normalizePersistedChapterMessageStatus(
  message: PersistedChapterMessageStatus,
): CandidateStatus {
  return message.role === "assistant"
    ? normalizeCandidateStatus(message)
    : message.status;
}

export function settleChapterCandidate(input: {
  providerSucceeded: boolean;
  stopped: boolean;
  errorMessage?: string | null;
  errorCode?: ChapterChatErrorCode | null;
}): { status: CandidateStatus; errorMessage: string | null; errorCode?: ChapterChatErrorCode | null } {
  if (input.stopped) return { status: "stopped", errorMessage: null };
  if (input.providerSucceeded) return { status: "completed_candidate", errorMessage: null };
  return {
    status: "error",
    errorMessage: input.errorMessage?.trim() || "生成失败",
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

export type CandidateApplyFailure = "not_found" | "status" | "revision" | "content";

export function canApplyChapterCandidate(input: {
  candidateUserId: number;
  requesterUserId: number;
  status: CandidateStatus;
  baseRevision: number | null;
  chapterRevision: number;
  content: string;
}): { ok: true } | { ok: false; reason: CandidateApplyFailure } {
  if (input.candidateUserId !== input.requesterUserId) return { ok: false, reason: "not_found" };
  const normalizedStatus = normalizeCandidateStatus({ status: input.status, inserted: false });
  if (normalizedStatus !== "completed_candidate") {
    return { ok: false, reason: "status" };
  }
  if (input.baseRevision === null || input.baseRevision !== input.chapterRevision) {
    return { ok: false, reason: "revision" };
  }
  if (!input.content.trim()) return { ok: false, reason: "content" };
  return { ok: true };
}

export function resolveChapterCandidateContent(input: {
  mode: CandidateApplyMode;
  originalContent: string;
  editedContent?: string;
}): { ok: true; content: string } | { ok: false; reason: "content" } {
  const content = input.mode === "original" ? input.originalContent : input.editedContent;
  if (typeof content !== "string" || !content.trim()) return { ok: false, reason: "content" };
  return { ok: true, content: content.trim() };
}

export class ChapterNotFoundError extends Error {
  constructor() {
    super("章节不存在");
    this.name = "ChapterNotFoundError";
  }
}

export class GenerationKeyConflictError extends Error {
  constructor() {
    super("生成请求键已经用于另一条请求，请重新生成");
    this.name = "GenerationKeyConflictError";
  }
}

export class ContentChangedError extends Error {
  constructor() {
    super("正文已变化，这条回复基于旧正文");
    this.name = "ContentChangedError";
  }
}

export class CandidateAlreadyAppliedError extends Error {
  constructor() {
    super("该候选已经应用过");
    this.name = "CandidateAlreadyAppliedError";
  }
}

export interface PrepareChapterCandidateInput {
  userId: number;
  novelId: number;
  chapterId: number;
  content: string;
  skills: string[];
  generationKey: string;
  requestHash: string;
  /** P0-C Retry：复用这条原始 assistant generationKey 对应的 user message，不再插入重复 user 行。 */
  retryOfGenerationKey?: string;
}

export async function prepareChapterCandidate(input: PrepareChapterCandidateInput) {
  return db.transaction(async (tx) => {
    const currentChapter = await resolveChapterOwnership(tx, input);
    if (!currentChapter) throw new ChapterNotFoundError();

    await tx
      .update(chapterMessages)
      .set({ status: "error", errorMessage: "生成任务超时，请重试", updatedAt: sql`now()` })
      .where(
        and(
          eq(chapterMessages.chapterId, input.chapterId),
          eq(chapterMessages.role, "assistant"),
          eq(chapterMessages.status, "generating"),
          sql`${chapterMessages.updatedAt} < now() - interval '10 minutes'`,
        ),
      );

    const [existingCandidate] = await tx
      .select()
      .from(chapterMessages)
      .where(
        and(
          eq(chapterMessages.chapterId, input.chapterId),
          eq(chapterMessages.userId, input.userId),
          eq(chapterMessages.generationKey, input.generationKey),
          eq(chapterMessages.role, "assistant"),
        ),
      );
    if (existingCandidate) {
      if (existingCandidate.requestHash && existingCandidate.requestHash !== input.requestHash) {
        throw new GenerationKeyConflictError();
      }
      return { currentChapter, candidate: existingCandidate, reused: true as const };
    }

    // P0-C Retry：复用原始用户消息，只为新的 generationKey 创建新 assistant 候选。
    if (input.retryOfGenerationKey) {
      const [originalCandidate] = await tx
        .select({ id: chapterMessages.id })
        .from(chapterMessages)
        .where(
          and(
            eq(chapterMessages.chapterId, input.chapterId),
            eq(chapterMessages.userId, input.userId),
            eq(chapterMessages.generationKey, input.retryOfGenerationKey),
            eq(chapterMessages.role, "assistant"),
          ),
        )
        .limit(1);
      if (!originalCandidate) {
        throw new Error("原始生成不存在，无法重试");
      }
      const [originalUser] = await tx
        .select({ id: chapterMessages.id })
        .from(chapterMessages)
        .where(
          and(
            eq(chapterMessages.chapterId, input.chapterId),
            eq(chapterMessages.userId, input.userId),
            eq(chapterMessages.role, "user"),
            lt(chapterMessages.id, originalCandidate.id),
          ),
        )
        .orderBy(desc(chapterMessages.id))
        .limit(1);
      if (!originalUser) {
        throw new Error("找不到原始用户消息，无法重试");
      }

      const [candidate] = await tx
        .insert(chapterMessages)
        .values({
          chapterId: input.chapterId,
          userId: input.userId,
          role: "assistant",
          content: "",
          skills: input.skills,
          snapshot: currentChapter.content,
          baseRevision: currentChapter.revision,
          generationKey: input.generationKey,
          requestHash: input.requestHash,
          status: "generating",
        })
        .onConflictDoNothing({ target: [chapterMessages.chapterId, chapterMessages.generationKey] })
        .returning();
      if (candidate) {
        const storedMessages = await tx
          .select({
            id: chapterMessages.id,
            role: chapterMessages.role,
            content: chapterMessages.content,
            status: chapterMessages.status,
            inserted: chapterMessages.inserted,
          })
          .from(chapterMessages)
          .where(eq(chapterMessages.chapterId, input.chapterId))
          .orderBy(chapterMessages.createdAt, chapterMessages.id);
        return {
          currentChapter,
          candidate,
          userMessageId: originalUser.id,
          storedMessages,
          reused: false as const,
        };
      }

      const [racedCandidate] = await tx
        .select()
        .from(chapterMessages)
        .where(
          and(
            eq(chapterMessages.chapterId, input.chapterId),
            eq(chapterMessages.userId, input.userId),
            eq(chapterMessages.generationKey, input.generationKey),
            eq(chapterMessages.role, "assistant"),
          ),
        );
      if (!racedCandidate) throw new Error("生成候选创建失败");
      if (racedCandidate.requestHash && racedCandidate.requestHash !== input.requestHash) {
        throw new GenerationKeyConflictError();
      }
      const racedMessages = await tx
        .select({
          id: chapterMessages.id,
          role: chapterMessages.role,
          content: chapterMessages.content,
          status: chapterMessages.status,
          inserted: chapterMessages.inserted,
        })
        .from(chapterMessages)
        .where(eq(chapterMessages.chapterId, input.chapterId))
        .orderBy(chapterMessages.createdAt, chapterMessages.id);
      return {
        currentChapter,
        candidate: racedCandidate,
        userMessageId: originalUser.id,
        storedMessages: racedMessages,
        reused: true as const,
      };
    }

    const [userMessage] = await tx
      .insert(chapterMessages)
      .values({
        chapterId: input.chapterId,
        userId: input.userId,
        role: "user",
        content: input.content,
        status: "done",
      })
      .returning({ id: chapterMessages.id });
    if (!userMessage) throw new Error("消息入库失败");

    const [candidate] = await tx
      .insert(chapterMessages)
      .values({
        chapterId: input.chapterId,
        userId: input.userId,
        role: "assistant",
        content: "",
        skills: input.skills,
        snapshot: currentChapter.content,
        baseRevision: currentChapter.revision,
        generationKey: input.generationKey,
        requestHash: input.requestHash,
        status: "generating",
      })
      .onConflictDoNothing({ target: [chapterMessages.chapterId, chapterMessages.generationKey] })
      .returning();
    if (candidate) {
      const storedMessages = await tx
        .select({
          id: chapterMessages.id,
          role: chapterMessages.role,
          content: chapterMessages.content,
          status: chapterMessages.status,
          inserted: chapterMessages.inserted,
        })
        .from(chapterMessages)
        .where(eq(chapterMessages.chapterId, input.chapterId))
        .orderBy(chapterMessages.createdAt, chapterMessages.id);
      return { currentChapter, candidate, userMessageId: userMessage.id, storedMessages, reused: false as const };
    }

    await tx.delete(chapterMessages).where(eq(chapterMessages.id, userMessage.id));
    const [racedCandidate] = await tx
      .select()
      .from(chapterMessages)
      .where(
        and(
          eq(chapterMessages.chapterId, input.chapterId),
          eq(chapterMessages.userId, input.userId),
          eq(chapterMessages.generationKey, input.generationKey),
          eq(chapterMessages.role, "assistant"),
        ),
      );
    if (!racedCandidate) throw new Error("生成候选创建失败");
    if (racedCandidate.requestHash && racedCandidate.requestHash !== input.requestHash) {
      throw new GenerationKeyConflictError();
    }
    return { currentChapter, candidate: racedCandidate, reused: true as const };
  });
}

export async function persistChapterCandidateSettlement(input: {
  candidateId: number;
  reply: string;
  providerSucceeded: boolean;
  stopped: boolean;
  attemptId?: number | null;
  errorMessage?: string | null;
  errorCode?: ChapterChatErrorCode | null;
}) {
  const [existing] = await db
    .select({
      id: chapterMessages.id,
      status: chapterMessages.status,
      errorMessage: chapterMessages.errorMessage,
      errorCode: chapterMessages.errorCode,
      attemptId: chapterMessages.attemptId,
    })
    .from(chapterMessages)
    .where(eq(chapterMessages.id, input.candidateId))
    .limit(1);
  if (!existing) throw new Error("生成候选不存在，请刷新后重试");
  if (existing.status !== "generating") {
    return {
      messageId: existing.id,
      status: normalizeCandidateStatus({ status: existing.status as CandidateStatus, inserted: false }),
      errorMessage: existing.errorMessage,
      errorCode: existing.errorCode,
      ignored: true as const,
    };
  }
  if (input.attemptId != null && existing.attemptId != null && input.attemptId !== existing.attemptId) {
    return {
      messageId: existing.id,
      status: "generating" as const,
      errorMessage: existing.errorMessage,
      errorCode: existing.errorCode,
      ignored: true as const,
    };
  }
  if (input.attemptId != null) {
    const [attempt] = await db
      .select({ status: generationAttempts.status })
      .from(generationAttempts)
      .where(eq(generationAttempts.id, input.attemptId))
      .limit(1);
    if (!attempt || attempt.status !== "running") {
      return {
        messageId: existing.id,
        status: "generating" as const,
        errorMessage: existing.errorMessage,
        ignored: true as const,
      };
    }
  }
  const settlement = settleChapterCandidate({
    ...input,
    // The explicit stop endpoint may settle the row before the upstream
    // provider observes its abort. Never let the late provider completion
    // turn that user decision back into a completed candidate.
    stopped: input.stopped,
  });
  const [candidate] = await db
    .update(chapterMessages)
    .set({
      content: input.reply,
      status: settlement.status,
      errorMessage: settlement.errorMessage,
      errorCode: settlement.errorCode ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(chapterMessages.id, input.candidateId), eq(chapterMessages.status, "generating")))
    .returning({ id: chapterMessages.id });
  if (!candidate) {
    const [currentCandidate] = await db
      .select({ id: chapterMessages.id, status: chapterMessages.status, errorMessage: chapterMessages.errorMessage, errorCode: chapterMessages.errorCode })
      .from(chapterMessages)
      .where(eq(chapterMessages.id, input.candidateId))
      .limit(1);
    if (!currentCandidate) throw new Error("生成候选状态已改变，请刷新后重试");
    return {
      messageId: currentCandidate.id,
      status: normalizeCandidateStatus({ status: currentCandidate.status as CandidateStatus, inserted: false }),
      errorMessage: currentCandidate.errorMessage,
      errorCode: currentCandidate.errorCode,
      ignored: true as const,
    };
  }
  return { messageId: candidate.id, ...settlement, ignored: false as const };
}

/**
 * Cross-instance stop signal for Cloud Run. The browser's disconnected HTTP
 * request is not a reliable cancellation channel, so the stop endpoint marks
 * the candidate and the active generation polls this row while upstream work
 * is running.
 */
export function watchChapterCandidateStop(
  candidateId: number,
  onStop: () => void,
  intervalMs = 500,
): () => void {
  let active = true;
  let checking = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (!active) return;
    active = false;
    if (timer) clearInterval(timer);
  };

  const check = async () => {
    if (!active || checking) return;
    checking = true;
    try {
      const [row] = await db
        .select({ status: chapterMessages.status })
        .from(chapterMessages)
        .where(eq(chapterMessages.id, candidateId))
        .limit(1);
      if (row?.status !== "generating") {
        stop();
        if (row?.status === "stopped") onStop();
      }
    } catch {
      // A transient database read failure must not cancel a live generation.
    } finally {
      checking = false;
    }
  };

  timer = setInterval(() => void check(), intervalMs);
  void check();
  return stop;
}

export async function requestStopChapterCandidate(input: {
  userId: number;
  novelId: number;
  chapterId: number;
  generationKey: string;
}): Promise<boolean> {
  const chapter = await resolveChapterOwnership(db, input);
  if (!chapter) return false;
  // The SSE route flushes its start event before candidate preparation finishes.
  // A stop request can therefore arrive while the row does not exist yet. Keep
  // the stop endpoint deterministic by waiting briefly for that row, instead
  // of losing the user's stop decision to this normal startup race.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await db
      .update(chapterMessages)
      .set({ status: "stopped", errorMessage: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(chapterMessages.chapterId, input.chapterId),
          eq(chapterMessages.userId, input.userId),
          eq(chapterMessages.role, "assistant"),
          eq(chapterMessages.generationKey, input.generationKey),
          eq(chapterMessages.status, "generating"),
        ),
      )
      .returning({ id: chapterMessages.id });
    if (rows.length > 0) return true;

    const [candidate] = await db
      .select({ status: chapterMessages.status })
      .from(chapterMessages)
      .where(
        and(
          eq(chapterMessages.chapterId, input.chapterId),
          eq(chapterMessages.userId, input.userId),
          eq(chapterMessages.role, "assistant"),
          eq(chapterMessages.generationKey, input.generationKey),
        ),
      )
      .limit(1);
    if (candidate && candidate.status !== "generating") return candidate.status === "stopped";
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function isChapterCandidateStopped(candidateId: number): Promise<boolean> {
  const [row] = await db
    .select({ status: chapterMessages.status })
    .from(chapterMessages)
    .where(eq(chapterMessages.id, candidateId))
    .limit(1);
  return row?.status === "stopped";
}

export interface InsertTarget {
  mode: "insert" | "replace";
  position?: number;
  range?: { start: number; end: number };
  expectedContent?: string;
}

export interface InsertResult {
  chapter: { content: string; updatedAt: string };
  messageId: number;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export async function applyChapterCandidate(input: {
  userId: number;
  novelId: number;
  chapterId: number;
  messageId: number;
  mode: CandidateApplyMode;
  editedContent?: string;
  force: boolean;
  target?: InsertTarget;
}): Promise<InsertResult> {
  return db.transaction(async (tx) => {
    const chapter = await resolveChapterOwnership(tx, input);
    if (!chapter) throw new ChapterNotFoundError();

    const [candidate] = await tx
      .select()
      .from(chapterMessages)
      .where(and(eq(chapterMessages.id, input.messageId), eq(chapterMessages.chapterId, input.chapterId)));
    if (!candidate) throw new Error("消息不存在");
    if (candidate.userId !== input.userId) throw new ChapterNotFoundError();
    if (candidate.role !== "assistant") throw new Error("只能插入 AI 回复");
    const resolvedContent = resolveChapterCandidateContent({
      mode: input.mode,
      originalContent: candidate.content,
      editedContent: input.editedContent,
    });
    if (!resolvedContent.ok) throw new Error("插入内容不能为空");
    const insertText = resolvedContent.content;
    if (
      normalizeCandidateStatus({
        inserted: candidate.inserted,
        status: candidate.status as CandidateStatus,
      }) === "applied"
    ) {
      throw new CandidateAlreadyAppliedError();
    }

    const applicability = canApplyChapterCandidate({
      candidateUserId: candidate.userId,
      requesterUserId: input.userId,
      status: candidate.status as CandidateStatus,
      baseRevision: candidate.baseRevision,
      chapterRevision: chapter.revision,
      content: candidate.content,
    });
    if (!applicability.ok) {
      if (applicability.reason === "not_found") throw new ChapterNotFoundError();
      if (applicability.reason === "revision") throw new ContentChangedError();
      if (applicability.reason === "content") throw new Error("候选内容为空，不能插入");
      throw new Error("该回复尚未成为可确认候选");
    }

    const mode = input.target?.mode ?? "insert";
    if (mode !== "insert" && mode !== "replace") throw new Error("无效的插入模式");
    const length = chapter.content.length;
    let next: string;
    if (mode === "replace") {
      const range = input.target?.range;
      if (!range || !isInt(range.start) || !isInt(range.end) || range.start < 0 || range.end < range.start || range.end > length) {
        throw new Error("替换区间无效");
      }
      next = chapter.content.slice(0, range.start) + insertText + chapter.content.slice(range.end);
    } else if (input.target?.position !== undefined) {
      const position = input.target.position;
      if (!isInt(position) || position < 0 || position > length) throw new Error("插入位置无效");
      next = chapter.content.slice(0, position) + insertText + chapter.content.slice(position);
    } else {
      next = chapter.content.trim() ? chapter.content + "\n\n" + insertText : insertText;
    }
    if (!input.force && input.target?.expectedContent !== undefined && input.target.expectedContent !== chapter.content) {
      throw new ContentChangedError();
    }

    const [updatedChapter] = await tx
      .update(chapters)
      .set({ content: next, revision: sql`${chapters.revision} + 1`, updatedAt: sql`now()` })
      .where(and(eq(chapters.id, input.chapterId), eq(chapters.revision, chapter.revision)))
      .returning({ content: chapters.content, updatedAt: chapters.updatedAt });
    if (!updatedChapter) throw new ContentChangedError();

    const [updatedCandidate] = await tx
      .update(chapterMessages)
      .set({ inserted: true, status: "applied" })
      .where(
        and(
          eq(chapterMessages.id, input.messageId),
          eq(chapterMessages.status, candidate.status),
          eq(chapterMessages.inserted, false),
        ),
      )
      .returning({ id: chapterMessages.id });
    if (!updatedCandidate) throw new CandidateAlreadyAppliedError();

    return {
      chapter: { content: updatedChapter.content, updatedAt: updatedChapter.updatedAt.toISOString() },
      messageId: input.messageId,
    };
  });
}

export async function discardChapterCandidate(input: {
  userId: number;
  novelId: number;
  chapterId: number;
  messageId: number;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const chapter = await resolveChapterOwnership(tx, input);
    if (!chapter) return false;
    const rows = await tx
      .update(chapterMessages)
      .set({ status: "discarded" })
      .where(
        and(
          eq(chapterMessages.id, input.messageId),
          eq(chapterMessages.chapterId, input.chapterId),
          eq(chapterMessages.userId, input.userId),
          eq(chapterMessages.role, "assistant"),
          inArray(chapterMessages.status, ["completed_candidate", "stopped", "error"]),
        ),
      )
      .returning({ id: chapterMessages.id });
    return rows.length > 0;
  });
}
