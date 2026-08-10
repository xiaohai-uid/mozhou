// 小说项目管理服务层（05 工单）：novels / chapters / character_entries / worldview_entries。
// 所有查询先做归属校验（novel.userId === user.id），防越权。
import { and, count, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chapters,
  characterEntries,
  novels,
  worldviewEntries,
} from "@/lib/schema";

export type Novel = typeof novels.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type CharacterEntry = typeof characterEntries.$inferSelect;
export type WorldviewEntry = typeof worldviewEntries.$inferSelect;

export interface NovelSummary {
  id: number;
  name: string;
  meta: string; // "连载中 · 4 章"
  ragEnabled: boolean;
}

export interface NovelDetail {
  novel: NovelSummary;
  chapters: Chapter[];
  characters: CharacterEntry[];
  worldviews: WorldviewEntry[];
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
    meta: `连载中 · ${r.chapterCount} 章`,
    ragEnabled: r.ragEnabled,
  }));
}

/** 创建项目 */
export async function createNovel(
  userId: number,
  name: string,
  description?: string,
): Promise<Novel> {
  const [row] = await db
    .insert(novels)
    .values({ userId, name, description: description ?? null })
    .returning();
  return row;
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
      meta: `连载中 · ${chapterCount} 章`,
      ragEnabled: novel.ragEnabled,
    },
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
    .set({ ...patch, updatedAt: sql`now()` })
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

/** 删除章节，归属校验 */
export async function deleteChapter(
  userId: number,
  novelId: number,
  chapterId: number,
): Promise<boolean> {
  const novel = await getNovel(userId, novelId);
  if (!novel) return false;
  const rows = await db
    .delete(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId)))
    .returning({ id: chapters.id });
  return rows.length > 0;
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
