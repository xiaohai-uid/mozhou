import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import {
  chapters,
  novelTrackings,
  novels,
  storyReviews,
  storyTrackingRecords,
  storyWorkflowRuns,
  type StoryTrackingState,
} from "@/lib/schema";
import { runWritingChecks, type WritingCheckResult, writingCheckWordCount } from "./checks";

function emptyTracking(): StoryTrackingState {
  return {
    statusCard: { currentChapterId: null, currentChapter: null, settledChapters: 0, lastSettledAt: null },
    characterStates: [],
    promises: [],
    timeline: [],
    readerKnowledge: [],
    chapterRecords: [],
  };
}

function inputHash(text: string, revision: number): string {
  return createHash("sha256").update(`${revision}:${text}`).digest("hex");
}

export class StoryTrackingNotFoundError extends Error {
  constructor() {
    super("作品或章节不存在");
    this.name = "StoryTrackingNotFoundError";
  }
}

export class StoryTrackingConflictError extends Error {
  constructor() {
    super("作品追踪状态已变化，请重新读取后再结算");
    this.name = "StoryTrackingConflictError";
  }
}

export interface StoryChapterFacts {
  result?: string;
  characterStates?: Array<{ name: string; state: string }>;
  promises?: Array<{ id?: string; text: string; status: "open" | "resolved" }>;
  timeline?: Array<{ text: string; kind?: "fact" | "reveal" | "private" }>;
  readerKnowledge?: Array<{ text: string }>;
}

/** 将 UI/自动化提交的事实限制在可审计的小型结构内，避免把正文复制进追踪真源。 */
export function normalizeStoryChapterFacts(value: unknown): StoryChapterFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const text = (candidate: unknown, max: number) =>
    typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, max) : undefined;
  const result = text(input.result, 1000);
  const characterStates = Array.isArray(input.characterStates)
    ? input.characterStates.slice(0, 50).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const name = text(row.name, 120);
        const state = text(row.state, 500);
        return name && state ? [{ name, state }] : [];
      })
    : undefined;
  const promises: StoryChapterFacts["promises"] = Array.isArray(input.promises)
    ? input.promises.slice(0, 50).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const promiseText = text(row.text, 500);
        const status = row.status === "resolved" ? "resolved" : row.status === "open" ? "open" : undefined;
        if (!promiseText || !status) return [];
        const id = text(row.id, 100);
        return [{ ...(id ? { id } : {}), text: promiseText, status }];
      })
    : undefined;
  const timeline: StoryChapterFacts["timeline"] = Array.isArray(input.timeline)
    ? input.timeline.slice(0, 50).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const timelineText = text(row.text, 500);
        if (!timelineText) return [];
        const kind = row.kind === "reveal" || row.kind === "private" ? row.kind : "fact";
        return [{ text: timelineText, kind }];
      })
    : undefined;
  const readerKnowledge: StoryChapterFacts["readerKnowledge"] = Array.isArray(input.readerKnowledge)
    ? input.readerKnowledge.slice(0, 50).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const knowledgeText = text((item as Record<string, unknown>).text, 500);
        return knowledgeText ? [{ text: knowledgeText }] : [];
      })
    : undefined;
  return { ...(result ? { result } : {}), ...(characterStates ? { characterStates } : {}), ...(promises ? { promises } : {}), ...(timeline ? { timeline } : {}), ...(readerKnowledge ? { readerKnowledge } : {}) };
}

function mergeChapterFacts(
  previous: StoryTrackingState,
  chapter: { id: number; ch: string },
  facts: StoryChapterFacts,
): StoryTrackingState {
  const characters = new Map(previous.characterStates.map((entry) => [entry.name, entry]));
  for (const entry of facts.characterStates ?? []) {
    characters.set(entry.name, { name: entry.name, state: entry.state, chapterId: chapter.id });
  }
  const promises = [...previous.promises];
  for (const entry of facts.promises ?? []) {
    const key = entry.id ?? entry.text;
    const index = promises.findIndex((item) => (item.id ?? item.text) === key);
    const next: StoryTrackingState["promises"][number] = { id: entry.id, text: entry.text, status: entry.status, chapterId: chapter.id };
    if (index >= 0) promises[index] = next;
    else promises.push(next);
  }
  const timeline = [...previous.timeline];
  const timelineFacts = [...(facts.timeline ?? []), ...(facts.result ? [{ text: facts.result, kind: "fact" as const }] : [])];
  for (const entry of timelineFacts) {
    if (!timeline.some((item) => item.chapterId === chapter.id && item.text === entry.text)) {
      timeline.push({ text: entry.text, chapterId: chapter.id, chapter: chapter.ch, kind: entry.kind });
    }
  }
  const readerKnowledge = [...previous.readerKnowledge];
  for (const entry of facts.readerKnowledge ?? []) {
    if (!readerKnowledge.some((item) => item.chapterId === chapter.id && item.text === entry.text)) {
      readerKnowledge.push({ text: entry.text, chapterId: chapter.id });
    }
  }
  return {
    ...previous,
    characterStates: [...characters.values()].sort((a, b) => a.name.localeCompare(b.name)),
    promises,
    timeline,
    readerKnowledge,
  };
}

export interface StoryTrackingSnapshot {
  tracking: typeof novelTrackings.$inferSelect;
  records: Array<typeof storyTrackingRecords.$inferSelect>;
  reviews: Array<typeof storyReviews.$inferSelect>;
  runs: Array<typeof storyWorkflowRuns.$inferSelect>;
}

export async function getStoryTracking(userId: number, novelId: number): Promise<StoryTrackingSnapshot | null> {
  const [novel] = await db.select({ id: novels.id }).from(novels).where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
  if (!novel) return null;
  let [tracking] = await db.select().from(novelTrackings).where(eq(novelTrackings.novelId, novelId));
  if (!tracking) {
    await db.insert(novelTrackings).values({ novelId, state: emptyTracking() }).onConflictDoNothing({ target: novelTrackings.novelId });
    [tracking] = await db.select().from(novelTrackings).where(eq(novelTrackings.novelId, novelId));
  }
  const [records, reviews, runs] = await Promise.all([
    db.select().from(storyTrackingRecords).where(eq(storyTrackingRecords.novelId, novelId)).orderBy(desc(storyTrackingRecords.settledAt)),
    db.select().from(storyReviews).where(eq(storyReviews.novelId, novelId)).orderBy(desc(storyReviews.createdAt)),
    db.select().from(storyWorkflowRuns).where(eq(storyWorkflowRuns.novelId, novelId)).orderBy(desc(storyWorkflowRuns.createdAt)),
  ]);
  return { tracking, records, reviews, runs };
}

export interface SettleChapterInput {
  userId: number;
  novelId: number;
  chapterId: number;
  idempotencyKey: string;
  mustCover?: string[];
  expectedStateRevision?: number;
  facts?: StoryChapterFacts;
}

/**
 * storyrepo 的 Web 原生结算适配器：读取正文 → 机检 → 审查历史 → 原子更新追踪状态。
 * 正文不会由追踪层改写；同一作品+幂等键重复调用只返回第一次结果。
 */
export interface StoryWorkflowResult {
  runId: number;
  status: "completed" | "rejected";
  checks?: WritingCheckResult[];
}

export async function settleChapter(input: SettleChapterInput): Promise<StoryWorkflowResult> {
  if (!input.idempotencyKey.trim()) throw new Error("缺少 workflow 幂等键");
  return db.transaction(async (tx) => {
    const [chapter] = await tx
      .select({ chapter: chapters, novelUserId: novels.userId })
      .from(chapters)
      .innerJoin(novels, eq(novels.id, chapters.novelId))
      .where(and(eq(chapters.id, input.chapterId), eq(chapters.novelId, input.novelId), eq(novels.userId, input.userId)));
    if (!chapter) throw new StoryTrackingNotFoundError();

    const hash = inputHash(chapter.chapter.content, chapter.chapter.revision);
    const [existingRun] = await tx.select().from(storyWorkflowRuns).where(and(eq(storyWorkflowRuns.novelId, input.novelId), eq(storyWorkflowRuns.idempotencyKey, input.idempotencyKey)));
    if (existingRun && existingRun.inputHash !== hash) throw new Error("workflow 幂等键已用于另一正文版本");
    if (existingRun?.status === "completed") return { runId: existingRun.id, status: "completed" };
    if (existingRun?.status === "running") throw new Error("该章节结算正在运行，请稍后刷新");

    const checks = runWritingChecks(chapter.chapter.content, { mustCover: input.mustCover ?? [] });
    const now = new Date();
    const summaryFacts = {
      chapterId: chapter.chapter.id,
      chapter: chapter.chapter.ch,
      title: chapter.chapter.title,
      revision: chapter.chapter.revision,
      wordCount: writingCheckWordCount(chapter.chapter.content),
      checksPassed: checks.filter((check) => check.ok).length,
      checksTotal: checks.length,
    };
    const [run] = existingRun
      ? await tx.update(storyWorkflowRuns).set({ status: "running", errorMessage: null, updatedAt: sql`now()` }).where(eq(storyWorkflowRuns.id, existingRun.id)).returning()
      : await tx.insert(storyWorkflowRuns).values({ novelId: input.novelId, chapterId: input.chapterId, operation: "settle", idempotencyKey: input.idempotencyKey, inputHash: hash, status: "running" }).onConflictDoNothing({ target: [storyWorkflowRuns.novelId, storyWorkflowRuns.idempotencyKey] }).returning();
    if (!run) throw new Error("workflow 运行记录创建失败");

    if (!checks.every((check) => check.ok)) {
      await tx.update(storyWorkflowRuns).set({ status: "rejected", output: summaryFacts, errorMessage: "机检未全部通过", updatedAt: now }).where(eq(storyWorkflowRuns.id, run.id));
      await tx.insert(storyReviews).values({ novelId: input.novelId, chapterId: input.chapterId, chapterRevision: chapter.chapter.revision, checks, source: "storyrepo" });
      return { runId: run.id, status: "rejected" as const, checks };
    }

    const [record] = await tx.insert(storyTrackingRecords).values({
      novelId: input.novelId,
      chapterId: input.chapterId,
      chapterRevision: chapter.chapter.revision,
      wordCount: summaryFacts.wordCount,
      checks,
      facts: { ...summaryFacts, chapterFacts: input.facts ?? {} },
      settledAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [storyTrackingRecords.novelId, storyTrackingRecords.chapterId],
      set: { chapterRevision: chapter.chapter.revision, wordCount: summaryFacts.wordCount, checks, facts: { ...summaryFacts, chapterFacts: input.facts ?? {} }, settledAt: now, updatedAt: now },
    }).returning();
    if (!record) throw new Error("章节追踪记录写入失败");

    await tx.insert(storyReviews).values({ novelId: input.novelId, chapterId: input.chapterId, chapterRevision: chapter.chapter.revision, checks, source: "storyrepo" });
    await tx.insert(novelTrackings).values({ novelId: input.novelId, state: emptyTracking() }).onConflictDoNothing({ target: novelTrackings.novelId });
    const [current] = await tx.select().from(novelTrackings).where(eq(novelTrackings.novelId, input.novelId));
    const previous = current?.state ?? emptyTracking();
    const expectedStateRevision = input.expectedStateRevision ?? current?.stateRevision ?? 0;
    if (!current || current.stateRevision !== expectedStateRevision) throw new StoryTrackingConflictError();
    const nextState = mergeChapterFacts(previous, { id: chapter.chapter.id, ch: chapter.chapter.ch }, input.facts ?? {});
    const state: StoryTrackingState = {
      ...nextState,
      statusCard: { currentChapterId: chapter.chapter.id, currentChapter: chapter.chapter.ch, settledChapters: previous.chapterRecords.filter((item) => item.chapterId !== chapter.chapter.id).length + 1, lastSettledAt: now.toISOString() },
      chapterRecords: [...previous.chapterRecords.filter((item) => item.chapterId !== chapter.chapter.id), { chapterId: chapter.chapter.id, chapter: chapter.chapter.ch, title: chapter.chapter.title, revision: chapter.chapter.revision, wordCount: summaryFacts.wordCount, checksPassed: summaryFacts.checksPassed, checksTotal: summaryFacts.checksTotal, settledAt: now.toISOString() }].sort((a, b) => a.chapter.localeCompare(b.chapter)),
    };
    const updatedTracking = await tx.update(novelTrackings)
      .set({ stateRevision: sql`${novelTrackings.stateRevision} + 1`, state, currentChapterId: chapter.chapter.id, updatedAt: now })
      .where(and(eq(novelTrackings.id, current.id), eq(novelTrackings.stateRevision, expectedStateRevision)))
      .returning({ id: novelTrackings.id });
    if (updatedTracking.length === 0) throw new StoryTrackingConflictError();
    await tx.update(storyWorkflowRuns).set({ status: "completed", output: summaryFacts, updatedAt: now }).where(eq(storyWorkflowRuns.id, run.id));

    return { runId: run.id, status: "completed" as const };
  });
}

export function trackingChecks(snapshot: StoryTrackingSnapshot): WritingCheckResult[] {
  return snapshot.records[0]?.checks ?? [];
}
