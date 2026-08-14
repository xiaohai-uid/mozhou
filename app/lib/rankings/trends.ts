// 趋势 delta 计算（T3）：对比两次榜单快照，产出涨跌/新进/跌出/上升最快。
// 纯函数，无数据库依赖；输入为两组快照行（同 board）。

export interface SnapshotRow {
  bookId: string;
  name: string;
  rank: number;
}

export type TrendDelta = "up" | "down" | "flat" | "new" | "gone";

export interface TrendRow extends SnapshotRow {
  prevRank: number | null; // null = 新进
  delta: TrendDelta;
  deltaValue: number; // up/down 的名次差（正数），其余 0
}

export interface TrendResult {
  baseline: string; // 上次快照 capturedAt（ISO）
  current: string; // 本次快照 capturedAt（ISO）
  rows: TrendRow[];
  risers: TrendRow[]; // 上升最快（按 deltaValue 降序，取前 5）
  newEntries: TrendRow[]; // 新进榜
  gone: SnapshotRow[]; // 跌出榜（上次有本次无）
}

export function computeTrends(
  prevRows: SnapshotRow[],
  curRows: SnapshotRow[],
  baseline: string,
  current: string,
): TrendResult {
  const prevByBook = new Map(prevRows.map((r) => [r.bookId, r]));
  const rows: TrendRow[] = curRows.map((r) => {
    const prev = prevByBook.get(r.bookId);
    if (!prev) return { ...r, prevRank: null, delta: "new", deltaValue: 0 };
    if (prev.rank > r.rank) return { ...r, prevRank: prev.rank, delta: "up", deltaValue: prev.rank - r.rank };
    if (prev.rank < r.rank) return { ...r, prevRank: prev.rank, delta: "down", deltaValue: r.rank - prev.rank };
    return { ...r, prevRank: prev.rank, delta: "flat", deltaValue: 0 };
  });
  const gone = prevRows.filter((r) => !curRows.some((c) => c.bookId === r.bookId));
  const risers = rows
    .filter((r) => r.delta === "up")
    .sort((a, b) => b.deltaValue - a.deltaValue)
    .slice(0, 5);
  const newEntries = rows.filter((r) => r.delta === "new").slice(0, 5);
  return { baseline, current, rows, risers, newEntries, gone };
}
