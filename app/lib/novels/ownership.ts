import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/schema";

export interface ChapterOwnershipScope {
  userId: number;
  novelId: number;
  chapterId: number;
}

type OwnershipExecutor = Pick<typeof db, "select">;

/** Used both before SSE starts and within candidate transactions. */
export async function resolveChapterOwnership(
  executor: OwnershipExecutor,
  scope: ChapterOwnershipScope,
) {
  const [row] = await executor
    .select({ chapter: chapters })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(
      and(
        eq(chapters.id, scope.chapterId),
        eq(chapters.novelId, scope.novelId),
        eq(novels.userId, scope.userId),
      ),
    );
  return row?.chapter ?? null;
}

export async function resolveOwnedChapter(scope: ChapterOwnershipScope) {
  return resolveChapterOwnership(db, scope);
}
