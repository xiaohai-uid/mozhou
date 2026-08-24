// T3 趋势 route 的纯查询逻辑（可单测）：给定某榜最近两组快照，折叠出趋势响应。
// DB 读取（fetchTrendGroups）与响应折叠（buildTrendResponse）分离：后者为纯函数。
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rankingSnapshots } from "@/lib/schema";
import {
  computeTrends,
  type SnapshotRow,
  type TrendRow,
} from "./trends";

export interface TrendGroup {
  capturedAt: string; // ISO
  rows: SnapshotRow[];
}

export interface TrendBoardRef {
  id: string;
  displayName: string;
}

export type TrendBuildResult =
  | { kind: "no-snapshot"; error: string; code: string }
  | { kind: "ok"; body: TrendOkBody };

export interface TrendOkBody {
  board: TrendBoardRef;
  baseline: string | null;
  current: string;
  /** 完整趋势为 TrendRow[]；单次快照降级时为纯 SnapshotRow[]（无 delta 字段）。 */
  rows: Array<SnapshotRow | TrendRow>;
  risers: TrendRow[];
  newEntries: TrendRow[];
  gone: SnapshotRow[];
  degraded: boolean;
}

/**
 * 折叠趋势响应：每组为一次 distinct capturedAt 的该榜快照。
 * 无快照 → no-snapshot（route 返回 404）；仅一次 → 降级语义（baseline null，risers/newEntries/gone 空）；
 * 两次及以上 → computeTrends 全量 delta。
 */
export function buildTrendResponse(
  groups: TrendGroup[],
  board: TrendBoardRef,
): TrendBuildResult {
  const sorted = groups
    .map((g) => g)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (sorted.length === 0) {
    return { kind: "no-snapshot", error: "暂无快照", code: "NO_SNAPSHOT" };
  }
  if (sorted.length === 1) {
    const current = sorted[0]!;
    return {
      kind: "ok",
      body: {
        board,
        baseline: null,
        current: current.capturedAt,
        rows: current.rows,
        risers: [],
        newEntries: [],
        gone: [],
        degraded: true,
      },
    };
  }
  const current = sorted[0]!;
  const prev = sorted[1]!;
  const t = computeTrends(prev.rows, current.rows, prev.capturedAt, current.capturedAt);
  return {
    kind: "ok",
    body: {
      board,
      baseline: t.baseline,
      current: t.current,
      rows: t.rows,
      risers: t.risers,
      newEntries: t.newEntries,
      gone: t.gone,
      degraded: false,
    },
  };
}

/** 读取某榜最近两次 distinct 快照（按 capturedAt 降序）。 */
export async function fetchTrendGroups(boardId: string): Promise<TrendGroup[]> {
  const distinct = await db
    .selectDistinct({ capturedAt: rankingSnapshots.capturedAt })
    .from(rankingSnapshots)
    .where(eq(rankingSnapshots.boardId, boardId))
    .orderBy(desc(rankingSnapshots.capturedAt))
    .limit(2);
  const groups: TrendGroup[] = [];
  for (const d of distinct) {
    const rows = await db
      .select({
        bookId: rankingSnapshots.bookId,
        name: rankingSnapshots.name,
        rank: rankingSnapshots.rank,
      })
      .from(rankingSnapshots)
      .where(
        and(
          eq(rankingSnapshots.boardId, boardId),
          eq(rankingSnapshots.capturedAt, d.capturedAt),
        ),
      )
      .orderBy(rankingSnapshots.rank);
    groups.push({ capturedAt: d.capturedAt.toISOString(), rows });
  }
  return groups;
}
