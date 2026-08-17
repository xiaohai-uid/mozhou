// 小说项目管理服务层（05 工单）：novels / chapters / character_entries / worldview_entries。
// 所有查询先做归属校验（novel.userId === user.id），防越权。
import { and, asc, count, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chapters,
  characterEntries,
  novelWorkflows,
  novels,
  worldviewEntries,
} from "@/lib/schema";

export type Novel = typeof novels.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type NovelWorkflow = typeof novelWorkflows.$inferSelect;
export type CharacterEntry = typeof characterEntries.$inferSelect;
export type WorldviewEntry = typeof worldviewEntries.$inferSelect;

export interface NovelSummary {
  id: number;
  name: string;
  description: string | null;
  meta: string; // "连载中 · 4 章"
  ragEnabled: boolean;
}

export interface NovelDetail {
  novel: NovelSummary;
  chapters: Chapter[];
  characters: CharacterEntry[];
  worldviews: WorldviewEntry[];
}

export interface CanonicalNovelExport {
  schemaVersion: "mozhou.novel.export.v1";
  kind: "novel";
  novel: {
    id: number;
    name: string;
    description: string | null;
    ragEnabled: boolean;
  };
  chapters: Array<{
    id: number;
    ch: string;
    title: string;
    content: string;
    status: Chapter["status"];
    sortOrder: number;
    revision: number;
  }>;
  characters: Array<{ id: number; name: string; note: string | null }>;
  worldviews: Array<{ id: number; name: string; note: string | null }>;
}

export interface QuickStartResult {
  novel: Novel;
  chapter: Chapter;
  workflow: NovelWorkflow;
  created: boolean;
}

async function loadFirstWriteResult(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  novel: Novel,
  created: boolean,
): Promise<QuickStartResult> {
  const [workflow] = await tx
    .select()
    .from(novelWorkflows)
    .where(eq(novelWorkflows.novelId, novel.id));
  if (!workflow) throw new Error("首写工作流记录缺失");
  const [chapter] = await tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, workflow.firstChapterId), eq(chapters.novelId, novel.id)));
  if (!chapter) throw new Error("首写章节记录缺失");
  return { novel, chapter, workflow, created };
}

/**
 * 快速开始的原子首写入口：作品、第一章、首写工作流必须一起存在。
 * requestKey 由客户端在一次用户意图开始时生成，重试时复用；归属范围由 userId 决定。
 */
export async function quickStartNovel(
  userId: number,
  name: string,
  requestKey: string,
  description?: string,
): Promise<QuickStartResult> {
  return db.transaction(async (tx) => {
    const insertedNovels = await tx
      .insert(novels)
      .values({
        userId,
        name,
        description: description ?? null,
        bootstrapRequestKey: requestKey,
      })
      .onConflictDoNothing({ target: [novels.userId, novels.bootstrapRequestKey] })
      .returning();
    if (insertedNovels.length === 0) {
      const [existing] = await tx
        .select()
        .from(novels)
        .where(and(eq(novels.userId, userId), eq(novels.bootstrapRequestKey, requestKey)));
      if (!existing) throw new Error("幂等作品读取失败");
      return loadFirstWriteResult(tx, existing, false);
    }
    const novel = insertedNovels[0];

    const [chapter] = await tx
      .insert(chapters)
      .values({
        novelId: novel.id,
        ch: "001",
        title: "第一章",
        sortOrder: 1,
      })
      .returning();
    if (!chapter) throw new Error("首写章节创建失败");

    const [workflow] = await tx
      .insert(novelWorkflows)
      .values({ novelId: novel.id, firstChapterId: chapter.id, state: "ready" })
      .returning();
    if (!workflow) throw new Error("首写工作流创建失败");

    return { novel, chapter, workflow, created: true };
  });
}

/** 导入用户自有正文：作品、首章、首写工作流与正文同一事务创建。 */
export async function importNovelWithFirstChapter(
  userId: number,
  name: string,
  content: string,
  requestKey: string,
): Promise<QuickStartResult> {
  return db.transaction(async (tx) => {
    const insertedNovels = await tx
      .insert(novels)
      .values({ userId, name, bootstrapRequestKey: requestKey })
      .onConflictDoNothing({ target: [novels.userId, novels.bootstrapRequestKey] })
      .returning();
    if (insertedNovels.length === 0) {
      const [existing] = await tx
        .select()
        .from(novels)
        .where(and(eq(novels.userId, userId), eq(novels.bootstrapRequestKey, requestKey)));
      if (!existing) throw new Error("幂等导入作品读取失败");
      return loadFirstWriteResult(tx, existing, false);
    }
    const novel = insertedNovels[0];
    if (!novel) throw new Error("导入作品创建失败");
    const [chapter] = await tx
      .insert(chapters)
      .values({ novelId: novel.id, ch: "001", title: "第一章", content, sortOrder: 1, revision: 1 })
      .returning();
    if (!chapter) throw new Error("导入首章创建失败");
    const [workflow] = await tx
      .insert(novelWorkflows)
      .values({ novelId: novel.id, firstChapterId: chapter.id, state: "active" })
      .returning();
    if (!workflow) throw new Error("导入工作流创建失败");
    return { novel, chapter, workflow, created: true };
  });
}

/** 为历史上已创建但没有章节的作品补齐首写入口；同一作品重复调用只返回同一首章。 */
export async function startWriting(
  userId: number,
  novelId: number,
): Promise<QuickStartResult | null> {
  return db.transaction(async (tx) => {
    const [novel] = await tx
      .select()
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
    if (!novel) return null;

    const [existingWorkflow] = await tx
      .select()
      .from(novelWorkflows)
      .where(eq(novelWorkflows.novelId, novelId));
    if (existingWorkflow) return loadFirstWriteResult(tx, novel, false);

    const [existingChapter] = await tx
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(chapters.sortOrder)
      .limit(1);
    if (existingChapter) {
      const insertedWorkflows = await tx
        .insert(novelWorkflows)
        .values({ novelId, firstChapterId: existingChapter.id, state: "active" })
        .onConflictDoNothing({ target: [novelWorkflows.novelId] })
        .returning();
      if (insertedWorkflows.length > 0) {
        return loadFirstWriteResult(tx, novel, false);
      }
      return loadFirstWriteResult(tx, novel, false);
    }

    const insertedChapters = await tx
      .insert(chapters)
      .values({ novelId, ch: "001", title: "第一章", sortOrder: 1 })
      .onConflictDoNothing({ target: [chapters.novelId, chapters.ch] })
      .returning();
    const chapter = insertedChapters[0] ?? (await tx
      .select()
      .from(chapters)
      .where(and(eq(chapters.novelId, novelId), eq(chapters.ch, "001"))))[0];
    if (!chapter) throw new Error("首写章节创建失败");

    await tx
      .insert(novelWorkflows)
      .values({ novelId, firstChapterId: chapter.id, state: "ready" })
      .onConflictDoNothing({ target: [novelWorkflows.novelId] });
    return loadFirstWriteResult(tx, novel, false);
  });
}

/** 列表（meta = 章节数拼接；含 RAG 开关） */
export async function listNovels(userId: number): Promise<NovelSummary[]> {
  const rows = await db
    .select({
      id: novels.id,
      name: novels.name,
      description: novels.description,
      ragEnabled: novels.ragEnabled,
      chapterCount: count(chapters.id),
    })
    .from(novels)
    .leftJoin(chapters, eq(chapters.novelId, novels.id))
    .where(eq(novels.userId, userId))
    .groupBy(novels.id)
    .orderBy(desc(novels.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    meta: `连载中 · ${r.chapterCount} 章`,
    ragEnabled: r.ragEnabled,
  }));
}

/** 详情（含三栏），归属校验 */
export async function getNovel(
  userId: number,
  novelId: number,
): Promise<NovelDetail | null> {
  const [novel] = await db
    .select()
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
  if (!novel) return null;

  const [chapterRows, characterRows, worldviewRows, [{ chapterCount }]] =
    await Promise.all([
      db
        .select()
        .from(chapters)
        .where(eq(chapters.novelId, novelId))
        .orderBy(chapters.sortOrder),
      db
        .select()
        .from(characterEntries)
        .where(eq(characterEntries.novelId, novelId))
        .orderBy(desc(characterEntries.createdAt)),
      db
        .select()
        .from(worldviewEntries)
        .where(eq(worldviewEntries.novelId, novelId))
        .orderBy(desc(worldviewEntries.createdAt)),
      db
        .select({ chapterCount: count() })
        .from(chapters)
        .where(eq(chapters.novelId, novelId)),
    ]);

  return {
    novel: {
      id: novel.id,
      name: novel.name,
      description: novel.description,
      meta: `连载中 · ${chapterCount} 章`,
      ragEnabled: novel.ragEnabled,
    },
    chapters: chapterRows,
    characters: characterRows,
    worldviews: worldviewRows,
  };
}

/** 服务端唯一的作品导出真源；不复用客户端详情 state，保证 revision/content 来自同一读取。 */
export async function getCanonicalNovelExport(
  userId: number,
  novelId: number,
): Promise<CanonicalNovelExport | null> {
  const [novel] = await db
    .select({
      id: novels.id,
      name: novels.name,
      description: novels.description,
      ragEnabled: novels.ragEnabled,
    })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
  if (!novel) return null;

  const [chapterRows, characterRows, worldviewRows] = await Promise.all([
    db
      .select({
        id: chapters.id,
        ch: chapters.ch,
        title: chapters.title,
        content: chapters.content,
        status: chapters.status,
        sortOrder: chapters.sortOrder,
        revision: chapters.revision,
      })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(asc(chapters.sortOrder), asc(chapters.id)),
    db
      .select({ id: characterEntries.id, name: characterEntries.name, note: characterEntries.note })
      .from(characterEntries)
      .where(eq(characterEntries.novelId, novelId))
      .orderBy(asc(characterEntries.id)),
    db
      .select({ id: worldviewEntries.id, name: worldviewEntries.name, note: worldviewEntries.note })
      .from(worldviewEntries)
      .where(eq(worldviewEntries.novelId, novelId))
      .orderBy(asc(worldviewEntries.id)),
  ]);

  return {
    schemaVersion: "mozhou.novel.export.v1",
    kind: "novel",
    novel,
    chapters: chapterRows,
    characters: characterRows,
    worldviews: worldviewRows,
  };
}

/** 编辑项目（书名/简介/RAG 开关），归属校验 */
export async function updateNovel(
  userId: number,
  novelId: number,
  patch: { name?: string; description?: string; ragEnabled?: boolean },
): Promise<Novel | null> {
  const [row] = await db
    .update(novels)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .returning();
  return row ?? null;
}

/** 删除项目（级联删章节/条目），归属校验 */
export async function deleteNovel(userId: number, novelId: number): Promise<boolean> {
  const rows = await db
    .delete(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .returning({ id: novels.id });
  return rows.length > 0;
}

// ---- 章节 ----

/** 新建章节：ch 自动取当前最大 +1，sortOrder 同步 */
export async function createChapter(
  userId: number,
  novelId: number,
  title: string,
): Promise<Chapter | null> {
  const novel = await getNovel(userId, novelId);
  if (!novel) return null;
  const [{ next }] = await db
    .select({ next: max(chapters.sortOrder) })
    .from(chapters)
    .where(eq(chapters.novelId, novelId));
  const nextOrder = (next ?? 0) + 1;
  const [row] = await db
    .insert(chapters)
    .values({
      novelId,
      ch: String(nextOrder).padStart(3, "0"),
      title,
      sortOrder: nextOrder,
    })
    .returning();
  return row;
}

/** 编辑章节标题/状态/正文，归属校验（经 novel 归属） */
export async function updateChapter(
  userId: number,
  novelId: number,
  chapterId: number,
  patch: { title?: string; status?: "draft" | "final"; content?: string },
): Promise<Chapter | null> {
  const novel = await getNovel(userId, novelId);
  if (!novel) return null;
  const [row] = await db
    .update(chapters)
    .set({
      ...patch,
      ...(patch.content !== undefined
        ? {
            revision: sql`${chapters.revision} + CASE WHEN ${chapters.content} IS DISTINCT FROM ${patch.content} THEN 1 ELSE 0 END`,
          }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId)))
    .returning();
  return row ?? null;
}

/** 单章详情（含正文 content），归属校验（16 工单，章节编辑器加载） */
export async function getChapter(
  userId: number,
  novelId: number,
  chapterId: number,
): Promise<Chapter | null> {
  const novel = await getNovel(userId, novelId);
  if (!novel) return null;
  const [row] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId)));
  return row ?? null;
}

export type DeleteChapterResult = "deleted" | "not_found" | "protected";

/**
 * 删除章节，归属校验。
 * 首写工作流持有第一章的正式引用；该章节不能被删除，否则已创建作品
 * 一定可进入写作这一不变量会被 UI 或旧客户端破坏。
 */
export async function deleteChapter(
  userId: number,
  novelId: number,
  chapterId: number,
): Promise<DeleteChapterResult> {
  return db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)));
    if (!novel) return "not_found";

    const [workflow] = await tx
      .select({ firstChapterId: novelWorkflows.firstChapterId })
      .from(novelWorkflows)
      .where(eq(novelWorkflows.novelId, novelId));
    if (workflow?.firstChapterId === chapterId) return "protected";

    const rows = await tx
      .delete(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId)))
      .returning({ id: chapters.id });
    return rows.length > 0 ? "deleted" : "not_found";
  });
}

// ---- 人物库 / 世界观条目 ----

export type EntryKind = "character" | "worldview";

/** 新建条目（type 区分人物/世界观），归属校验 */
export async function createEntry(
  userId: number,
  novelId: number,
  kind: EntryKind,
  name: string,
  note?: string,
): Promise<CharacterEntry | WorldviewEntry | null> {
  const novel = await getNovel(userId, novelId);
  if (!novel) return null;
  const table = kind === "character" ? characterEntries : worldviewEntries;
  const [row] = await db
    .insert(table)
    .values({ novelId, name, note: note ?? null })
    .returning();
  return row;
}

/** 删除条目，归属校验 */
export async function deleteEntry(
  userId: number,
  novelId: number,
  kind: EntryKind,
  entryId: number,
): Promise<boolean> {
  const novel = await getNovel(userId, novelId);
  if (!novel) return false;
  const table = kind === "character" ? characterEntries : worldviewEntries;
  const rows = await db
    .delete(table)
    .where(and(eq(table.id, entryId), eq(table.novelId, novelId)))
    .returning({ id: table.id });
  return rows.length > 0;
}
