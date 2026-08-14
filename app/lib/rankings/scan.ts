// T2 扫榜落库服务：遍历 enabled 榜单 → 抓列表 → 详情页解书名/作者/题材 → 批量 INSERT 快照。
// 幂等：一轮扫榜同一 capturedAt；(boardId, bookId, capturedAt) 唯一约束 + ON CONFLICT DO NOTHING。
// 依赖可注入（fetchHtml / persist），便于单测不连数据库。
import { max } from "drizzle-orm";
import { db } from "@/lib/db";
import { rankingSnapshots } from "@/lib/schema";
import {
  RANKING_BOARDS,
  extractFanqieBookCards,
  fetchRankingWithRetry,
  resolveFanqieDetailTitle,
  type RankingBoard,
} from "@/lib/story/rankings";

export interface ScanFailure {
  boardId: string;
  reason: string;
}

export interface ScanResult {
  boardsAttempted: number;
  boardsFailed: number;
  rowsInserted: number;
  capturedAt: string;
  failures: ScanFailure[];
}

/** 单条落库快照（name 已保证非空；author/category 可空）。 */
export interface ScanInsertRow {
  boardId: string;
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
  rank: number;
  capturedAt: string;
}

/** persist 返回本次实际插入行数（ON CONFLICT DO NOTHING 下 = 新增行数）。 */
export type ScanPersistFn = (rows: ScanInsertRow[]) => Promise<number>;

export interface ScanDeps {
  /** 抓取页面 HTML（列表页或详情页）。默认走 fetchRankingWithRetry + UA。 */
  fetchHtml: (url: string) => Promise<string>;
  /** 批量落库。默认 db.insert(...).onConflictDoNothing().returning()。 */
  persist: ScanPersistFn;
  /** 参与扫榜的榜；默认 RANKING_BOARDS 中 enabled 的榜。 */
  boards: RankingBoard[];
  /** 本轮扫榜时间戳（同一轮所有行共用）。默认 new Date().toISOString()。 */
  capturedAt: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0";

function defaultFetchHtml(): (url: string) => Promise<string> {
  return async (url) => {
    const response = await fetchRankingWithRetry({
      url,
      request: async (requestUrl) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          return await fetch(requestUrl, { signal: ctrl.signal, headers: { "User-Agent": UA } });
        } finally {
          clearTimeout(timer);
        }
      },
    });
    if (!response.ok) throw new Error(`榜单源 ${url} 返回 ${response.status}`);
    return response.text();
  };
}

const defaultPersist: ScanPersistFn = async (rows) => {
  // captured_at 为 timestamptz，落库时把 ISO 字符串转 Date。
  const values = rows.map((row) => ({ ...row, capturedAt: new Date(row.capturedAt) }));
  const inserted = await db
    .insert(rankingSnapshots)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: rankingSnapshots.id });
  return inserted.length;
};

/** 从 SSR HTML 提取带引号的字符串字段（处理转义）；找不到返回 null。 */
function extractJsonString(html: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const match = html.match(re);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

/** 抓单个榜：列表页前 20 → 逐本抓详情 → 组装可落库行（name 解不出的跳过）。 */
async function scanBoard(
  board: RankingBoard,
  capturedAt: string,
  fetchHtml: (url: string) => Promise<string>,
): Promise<ScanInsertRow[]> {
  const listHtml = await fetchHtml(board.listUrl);
  const cards = extractFanqieBookCards(listHtml).slice(0, 20);
  if (cards.length === 0) return [];

  const rows = await Promise.all(
    cards.map(async (card) => {
      try {
        const detailHtml = await fetchHtml(`https://fanqienovel.com/page/${card.bookId}`);
        const resolved = resolveFanqieDetailTitle(detailHtml);
        const name = resolved?.title ?? null;
        if (!name) return null;
        return {
          boardId: board.id,
          bookId: card.bookId,
          name,
          author: extractJsonString(detailHtml, "author"),
          category: extractJsonString(detailHtml, "categoryV2"),
          rank: card.rank,
          capturedAt,
        } satisfies ScanInsertRow;
      } catch {
        return null; // 单本详情失败跳过，不中断整榜
      }
    }),
  );

  return rows.filter((row): row is ScanInsertRow => row !== null);
}

export interface ScanOptions {
  fetchHtml?: (url: string) => Promise<string>;
  persist?: ScanPersistFn;
  boards?: RankingBoard[];
  capturedAt?: string;
}

export async function scanAll(options: ScanOptions = {}): Promise<ScanResult> {
  const deps: ScanDeps = {
    fetchHtml: options.fetchHtml ?? defaultFetchHtml(),
    persist: options.persist ?? defaultPersist,
    boards: (options.boards ?? RANKING_BOARDS).filter((b) => b.enabled),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
  };

  const failures: ScanFailure[] = [];
  let rowsInserted = 0;

  for (const board of deps.boards) {
    try {
      const rows = await scanBoard(board, deps.capturedAt, deps.fetchHtml);
      if (rows.length > 0) {
        rowsInserted += await deps.persist(rows);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ boardId: board.id, reason });
    }
  }

  return {
    boardsAttempted: deps.boards.length,
    boardsFailed: failures.length,
    rowsInserted,
    capturedAt: deps.capturedAt,
    failures,
  };
}

/** 最近一次成功扫榜时间（ISO）。无记录返回 null。 */
export async function latestScanCapturedAt(): Promise<string | null> {
  const [row] = await db
    .select({ m: max(rankingSnapshots.capturedAt) })
    .from(rankingSnapshots);
  return row?.m ? row.m.toISOString() : null;
}

/**
 * 冷却判定：最近扫榜时间距今不足 cooldownMs（默认 60s）则视为过于频繁。
 * 纯函数，route 用它做 429 拦截。
 */
export function scanWithinCooldown(
  lastCapturedAt: Date | string | null,
  now: Date = new Date(),
  cooldownMs = 60_000,
): boolean {
  if (!lastCapturedAt) return false;
  const time = typeof lastCapturedAt === "string" ? new Date(lastCapturedAt).getTime() : lastCapturedAt.getTime();
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time < cooldownMs;
}
