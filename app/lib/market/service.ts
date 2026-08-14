// T9 市场服务：briefing（最近 N 天聚合摘要）与 titles（候选书名规则生成）。
// DB 读取（fetchRecentSnapshots）与纯折叠（buildBriefingResponse / buildTitleCandidates）分离。
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { rankingSnapshots } from "@/lib/schema";
import {
  buildMarketSummary,
  renderMarketSummary,
  type SnapshotRow,
} from "./summary";

export type { SnapshotRow } from "./summary";

/** 读取最近 days 天内的全部榜单快照行（boardId 不限，覆盖全部 enabled 榜）。 */
export async function fetchRecentSnapshots(days: number): Promise<SnapshotRow[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      bookId: rankingSnapshots.bookId,
      name: rankingSnapshots.name,
      author: rankingSnapshots.author,
      category: rankingSnapshots.category,
      rank: rankingSnapshots.rank,
      capturedAt: rankingSnapshots.capturedAt,
    })
    .from(rankingSnapshots)
    .where(gte(rankingSnapshots.capturedAt, cutoff));
  return rows.map((r) => ({
    bookId: r.bookId,
    name: r.name,
    author: r.author,
    category: r.category,
    rank: r.rank,
    capturedAt: r.capturedAt.toISOString(),
  }));
}

export type BriefingBuildResult =
  | { status: 404; error: string; code: string }
  | { status: 200; summary: ReturnType<typeof buildMarketSummary>; rendered: string };

/** 折叠简报响应：无快照 → 404 NO_DATA；否则 buildMarketSummary + render。 */
export function buildBriefingResponse(
  rows: SnapshotRow[],
  todayIso: string,
  nowIso: string,
): BriefingBuildResult {
  if (rows.length === 0) {
    return { status: 404, error: "暂无市场数据", code: "NO_DATA" };
  }
  const summary = buildMarketSummary(rows, todayIso, nowIso);
  return { status: 200, summary, rendered: renderMarketSummary(summary) };
}

/**
 * 取最近一次扫榜（最新 capturedAt）的 distinct 书名；可选按 category 过滤（genre）。
 * 返回去重书名数组，按上榜名次近似稳定（依赖快照内顺序）。
 */
export async function fetchLatestBookNames(
  category?: string | null,
): Promise<string[]> {
  const [latest] = await db
    .select({ capturedAt: rankingSnapshots.capturedAt })
    .from(rankingSnapshots)
    .orderBy(desc(rankingSnapshots.capturedAt))
    .limit(1);
  if (!latest) return [];

  const rows = await db
    .select({ name: rankingSnapshots.name })
    .from(rankingSnapshots)
    .where(
      category
        ? and(eq(rankingSnapshots.category, category), eq(rankingSnapshots.capturedAt, latest.capturedAt))
        : eq(rankingSnapshots.capturedAt, latest.capturedAt),
    )
    .orderBy(rankingSnapshots.rank)
    .limit(200);
  return [...new Set(rows.map((r) => r.name).filter((n) => n && n.trim()))];
}

/** 榜单书名词缀语料（原型级候选模板的一部分）。 */
const TITLE_AFFIXES = [
  "开局惊艳全场",
  "爆款潜力股",
  "甜宠天花板",
  "百万热度预定",
  "逆风翻盘",
  "封神之作",
  "流量黑马",
  "读者追更榜",
];

function cleanRef(name: string): string {
  return name.replace(/[《》【】「」『』?？!！。，、]/g, "").trim().slice(0, 12);
}

/**
 * 候选书名规则生成（原型级；二期接 LLM）：genre 关键词 + 榜书词缀组合。
 * references = 参考书名（去重，最多 10）；candidates = 模板化候选（最多 10）。
 */
export function buildTitleCandidates(
  bookNames: string[],
  genre: string | null,
): { references: string[]; candidates: string[] } {
  const kw = genre?.trim() || "新书";
  const references = [...new Set(bookNames.filter((n) => n && n.trim()))].slice(0, 10);
  const candidates: string[] = [];
  for (const affix of TITLE_AFFIXES.slice(0, 4)) {
    candidates.push(`${kw}：${affix}`);
  }
  for (const ref of references.slice(0, 5)) {
    const core = cleanRef(ref);
    if (core) candidates.push(`《${core}》·${kw}进阶`);
  }
  return { references, candidates: candidates.slice(0, 10) };
}
