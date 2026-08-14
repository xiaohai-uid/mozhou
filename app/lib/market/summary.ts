// 市场摘要（T9 场景 A/D）：由最近 N 天榜单快照聚合出结构化市场数据。
// 纯函数；输入为快照行数组，输出为可注入 chat 的紧凑摘要。

export interface SnapshotRow {
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
  rank: number;
  capturedAt: string;
}

export interface CategoryTrend {
  category: string;
  appearances: number; // 该题材上榜书次数（今日）
  topBooks: string[]; // 今日前 3 书名
  avgRank: number;
}

export interface MarketSummary {
  generatedAt: string;
  dayCount: number; // 覆盖天数
  totalBooks: number;
  categories: CategoryTrend[]; // 按 appearances 降序
  risers: Array<{ bookId: string; name: string; category: string | null; deltaValue: number }>;
  newEntries: Array<{ bookId: string; name: string; category: string | null }>;
}

/** 按 (bookId, capturedAt) 对快照行去重并取最新 name/author/category */
export function dedupeRows(rows: SnapshotRow[]): SnapshotRow[] {
  const byKey = new Map<string, SnapshotRow>();
  for (const row of rows) {
    const key = row.bookId + "|" + row.capturedAt;
    const prev = byKey.get(key);
    if (!prev || (prev.name.length === 0 && row.name.length > 0)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function buildMarketSummary(
  rows: SnapshotRow[],
  today: string, // 今日 capturedAt（ISO）
  generatedAt: string,
): MarketSummary {
  const unique = dedupeRows(rows);
  const days = new Set(unique.map((r) => r.capturedAt.slice(0, 10)));
  // 只聚合最新一轮扫榜（最新 capturedAt），避免同日多轮混合
  const latestCaptured = unique.reduce((max, r) => (r.capturedAt > max ? r.capturedAt : max), "");
  const todayRows = unique.filter((r) => r.capturedAt === latestCaptured);
  const byCategory = new Map<string, { appearances: number; books: Array<{ name: string; rank: number }>; rankSum: number }>();
  for (const row of todayRows) {
    const key = row.category ?? "未分类";
    const entry = byCategory.get(key) ?? { appearances: 0, books: [], rankSum: 0 };
    entry.appearances += 1;
    entry.rankSum += row.rank;
    entry.books.push({ name: row.name, rank: row.rank });
    byCategory.set(key, entry);
  }
  const categories: CategoryTrend[] = [...byCategory.entries()]
    .map(([category, e]) => ({
      category,
      appearances: e.appearances,
      topBooks: e.books.sort((a, b) => a.rank - b.rank).slice(0, 3).map((b) => b.name),
      avgRank: Math.round((e.rankSum / e.appearances) * 10) / 10,
    }))
    .sort((a, b) => b.appearances - a.appearances);

  // 涨跌：与最近一次早于 today 的快照对比（简化：对每本书找今天与昨天 rank 差）
  const prevDay = [...days].filter((d) => d < today.slice(0, 10)).sort().pop();
  const prevRows = prevDay ? unique.filter((r) => r.capturedAt.slice(0, 10) === prevDay) : [];
  const prevRank = new Map(prevRows.map((r) => [r.bookId, r.rank]));
  const risers: MarketSummary["risers"] = [];
  const newEntries: MarketSummary["newEntries"] = [];
  for (const row of todayRows) {
    const p = prevRank.get(row.bookId);
    if (p === undefined) {
      newEntries.push({ bookId: row.bookId, name: row.name, category: row.category });
    } else if (p > row.rank) {
      risers.push({ bookId: row.bookId, name: row.name, category: row.category, deltaValue: p - row.rank });
    }
  }
  risers.sort((a, b) => b.deltaValue - a.deltaValue).splice(5);

  const uniqueBookIds = new Set(unique.map((r) => r.bookId));
  return {
    generatedAt,
    dayCount: days.size,
    totalBooks: uniqueBookIds.size,
    categories,
    risers: risers.slice(0, 5),
    newEntries: newEntries.slice(0, 5),
  };
}

/** 渲染为可注入 chat 的紧凑文本（几百 token） */
export function renderMarketSummary(summary: MarketSummary): string {
  const lines: string[] = [];
  lines.push("【市场风向 · 最近 " + summary.dayCount + " 天扫榜】");
  lines.push("今日上榜书目 " + summary.totalBooks + " 本。题材分布：");
  for (const c of summary.categories.slice(0, 5)) {
    lines.push("- " + c.category + "：" + c.appearances + " 本，代表《" + c.topBooks.join("》《") + "》");
  }
  if (summary.risers.length > 0) {
    lines.push("上升最快：" + summary.risers.map((r) => "《" + r.name + "》↑" + r.deltaValue).join("、"));
  }
  if (summary.newEntries.length > 0) {
    lines.push("新进榜：" + summary.newEntries.map((r) => "《" + r.name + "》").join("、"));
  }
  return lines.join("\n");
}
