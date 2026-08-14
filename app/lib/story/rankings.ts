export type RankingMode = "long" | "short";

export interface RankingCategory {
  id: string;
  name: string;
  url: string;
}

/** The only ranking boards enabled in the product-facing P0-A API. */
export interface RankingBoard {
  id: string;
  displayName: string;
  source: "fanqienovel.com";
  sourceKind: "official-ranking";
  workLength: RankingMode;
  rankingKind: string;
  listUrl: string;
  enabled: boolean;
}

export interface RankingRow {
  bookId: string;
  rank: number;
  name: string;
  author?: string;
  status?: string;
  readerCount?: number;
  source: "fanqienovel.com" | "mock";
  sourceUrl: string;
  detailUrl: string;
  titleResolution: "detail-html" | "detail-ssr";
  capturedAt?: string;
  // Kept only for the deterministic test provider; production never fabricates it.
  heat?: string;
}

export type RankingDegradationCode =
  | "SOURCE_FETCH_FAILED"
  | "LIST_PARSE_FAILED"
  | "DETAIL_FETCH_PARTIAL"
  | "DETAIL_PARSE_FAILED"
  | "TITLE_QUALITY_REJECTED"
  | "QUALITY_THRESHOLD_NOT_MET"
  | "NO_VALID_ROWS";

export interface RankingDegradation {
  code: RankingDegradationCode;
  attempted: number;
  accepted: number;
  rejected: number;
}

export interface ResolvedRankingRows {
  rows: RankingRow[];
  degraded: boolean;
  attempted: number;
  accepted: number;
  rejected: number;
  degradation?: RankingDegradation;
}

const RETRYABLE_SOURCE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchRankingWithRetry(input: {
  url: string;
  request: (url: string) => Promise<Response>;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<Response> {
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = input.maxAttempts ?? 3;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await input.request(input.url);
      if (response.ok || !RETRYABLE_SOURCE_STATUS.has(response.status) || attempt === maxAttempts - 1) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) ? Math.min(5000, retryAfter * 1000) : 300 * 2 ** attempt;
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
      await sleep(300 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("榜单源请求失败");
}

const fanqieSource = "fanqienovel.com" as const;

/**
 * P0-A product catalog. The wider official catalog is intentionally kept out of
 * this API until its source adapters and quality gates exist in P1 Scan.
 */
export const RANKING_BOARDS: RankingBoard[] = [
  {
    id: "long-hot",
    displayName: "长篇热门榜",
    source: fanqieSource,
    sourceKind: "official-ranking",
    workLength: "long",
    rankingKind: "hot",
    listUrl: "https://fanqienovel.com/rank/0_2_1139",
    enabled: true,
  },
  {
    id: "short-hot",
    displayName: "短篇热门榜",
    source: fanqieSource,
    sourceKind: "official-ranking",
    workLength: "short",
    rankingKind: "hot",
    listUrl: "https://fanqienovel.com/rank/0_1_1139",
    enabled: true,
  },
];

/** Alias retained for story capability imports; it contains only enabled boards. */
export const FANQIE_BOARDS = RANKING_BOARDS;

/**
 * P1 reference catalog, not exposed as enabled product boards yet. These are
 * official names/URLs to be wired only when each source has a real adapter.
 */
export const FANQIE_OFFICIAL_CATALOG: RankingCategory[] = [
  ["0_2_1139", "女频热门榜"], ["1_2_1139", "男频热门榜"],
  ["0_1_1139", "女频新书榜"], ["1_1_1139", "男频新书榜"],
  ["0_2_1141", "女频西方奇幻榜"], ["1_2_1140", "男频东方仙侠榜"],
  ["0_2_8", "女频科幻末世榜"], ["1_2_8", "男频科幻末世榜"],
  ["0_2_261", "女频都市日常榜"], ["1_2_124", "男频都市修真榜"],
  ["0_2_79", "女频年代榜"], ["1_2_258", "男频传统玄幻榜"],
].map(([id, name]) => ({ id, name, url: `https://fanqienovel.com/rank/${id}` }));

const PUA_RE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

export function isValidRankingTitle(title: string): boolean {
  const normalized = decodeHtmlText(title);
  return normalized.length > 0
    && normalized.length <= 120
    && !PUA_RE.test(normalized)
    && !CONTROL_RE.test(normalized);
}

export interface FanqieBookCard {
  bookId: string;
  rank: number;
  listTitle: string;
}

export function extractFanqieBookCards(html: string): FanqieBookCard[] {
  const cards: FanqieBookCard[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']\/page\/([^?"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const bookId = match[1];
    if (!bookId || seen.has(bookId)) continue;
    seen.add(bookId);
    cards.push({ bookId, rank: cards.length + 1, listTitle: decodeHtmlText(match[2]) });
  }
  if (cards.length > 0) return cards;

  const jsonRe = /"bookId"\s*:\s*"([^"\\]+)"[\s\S]{0,500}?"bookName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  for (const match of html.matchAll(jsonRe)) {
    const bookId = match[1];
    if (!bookId || seen.has(bookId)) continue;
    seen.add(bookId);
    cards.push({ bookId, rank: cards.length + 1, listTitle: decodeJsonString(match[2]) });
  }
  return cards;
}

export interface FanqieDetailTitle {
  title: string;
  resolution: "detail-html" | "detail-ssr";
}

export function resolveFanqieDetailTitle(html: string): FanqieDetailTitle | null {
  const jsonMatch = html.match(/"bookName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  const jsonTitle = jsonMatch ? decodeJsonString(jsonMatch[1]) : "";
  if (isValidRankingTitle(jsonTitle)) return { title: decodeHtmlText(jsonTitle), resolution: "detail-ssr" };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)(?:完整版|最新章节|在线阅读|_番茄小说|-番茄小说|_番茄|-番茄)/i);
  const title = titleMatch ? decodeHtmlText(titleMatch[1]) : "";
  return isValidRankingTitle(title) ? { title, resolution: "detail-html" } : null;
}

/** Compatibility helper for existing callers that only need the decoded title. */
export function extractFanqieDetailTitle(html: string): string | null {
  return resolveFanqieDetailTitle(html)?.title ?? null;
}

function degraded(
  code: RankingDegradationCode,
  attempted: number,
  accepted: number,
): ResolvedRankingRows {
  return {
    rows: [],
    degraded: true,
    attempted,
    accepted,
    rejected: Math.max(0, attempted - accepted),
    degradation: { code, attempted, accepted, rejected: Math.max(0, attempted - accepted) },
  };
}

export async function resolveFanqieRankingRows(input: {
  boardUrl: string;
  capturedAt: string;
  listHtml: string;
  fetchDetail: (bookId: string) => Promise<string>;
}): Promise<ResolvedRankingRows> {
  // P0-A intentionally attempts exactly five rows; it never promotes a sixth
  // row to conceal a rejected first-five detail page.
  const cards = extractFanqieBookCards(input.listHtml).slice(0, 5);
  if (cards.length === 0) return degraded("LIST_PARSE_FAILED", 0, 0);

  let fetchFailures = 0;
  let titleFailures = 0;
  const details = await Promise.all(cards.map(async (card) => {
    try {
      const resolved = resolveFanqieDetailTitle(await input.fetchDetail(card.bookId));
      if (!resolved) {
        titleFailures += 1;
        return null;
      }
      return { card, resolved };
    } catch {
      fetchFailures += 1;
      return null;
    }
  }));

  const valid = details.filter((item): item is {
    card: FanqieBookCard;
    resolved: FanqieDetailTitle;
  } => item !== null);
  const rows = valid.map((item) => ({
    bookId: item.card.bookId,
    rank: item.card.rank,
    name: item.resolved.title,
    source: fanqieSource,
    sourceUrl: input.boardUrl,
    detailUrl: `https://fanqienovel.com/page/${item.card.bookId}`,
    titleResolution: item.resolved.resolution,
    capturedAt: input.capturedAt,
  }));
  const attempted = cards.length;
  const accepted = rows.length;
  const rejected = attempted - accepted;
  if (accepted === attempted && accepted === 5) {
    return { rows, degraded: false, attempted, accepted, rejected };
  }

  const code: RankingDegradationCode = accepted === 0
    ? "NO_VALID_ROWS"
    : fetchFailures > 0
      ? "DETAIL_FETCH_PARTIAL"
      : titleFailures > 0
        ? "TITLE_QUALITY_REJECTED"
        : "QUALITY_THRESHOLD_NOT_MET";
  return {
    rows,
    degraded: true,
    attempted,
    accepted,
    rejected,
    degradation: { code, attempted, accepted, rejected },
  };
}

export function findRankingBoard(value: string | null): RankingBoard | undefined {
  return RANKING_BOARDS.find((board) => board.id === value);
}
