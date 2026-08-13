// GET /api/v1/rankings — 网文扫榜：真实榜源不可用时返回空榜并标记 degraded。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export interface RankingBoard {
  name: string;
  site: string;
  url: string;
  mode: "long" | "short";
}

export interface RankingRow {
  rank: number;
  name: string;
  heat: string;
  source: string;
  capturedAt: string;
  url: string;
}

const BOARDS: RankingBoard[] = [
  { name: "长篇热门榜", site: "番茄小说", url: "https://fanqienovel.com/rank/0_2_1139", mode: "long" },
  { name: "短篇热门榜", site: "番茄小说", url: "https://fanqienovel.com/rank/0_1_1139", mode: "short" },
];

/** 按榜数据（mock：各榜不同，验证按榜查询链路） */
const BOARD_ROWS: Record<string, RankingRow[]> = {
  "畅销榜 Top10": [
    { rank: 1, name: "宿命之环", heat: "9.8 万人在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 2, name: "道诡异仙", heat: "8.7 万人在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 3, name: "深海余烬", heat: "7.9 万人在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 4, name: "玄鉴仙族", heat: "6.4 万人在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 5, name: "夜的命名术", heat: "5.8 万人在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
  ],
  "月票榜": [
    { rank: 1, name: "大奉打更人", heat: "12.3 万月票", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 2, name: "诡秘之主2", heat: "11.1 万月票", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 3, name: "凡人修仙传", heat: "9.7 万月票", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
  ],
  "新书榜": [
    { rank: 1, name: "重生之我在大学当卷王", heat: "3.2 万在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 2, name: "我在修仙界开网吧", heat: "2.8 万在读", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
  ],
  "完结榜": [
    { rank: 1, name: "剑来", heat: "已完结", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 2, name: "雪中悍刀行", heat: "已完结", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
    { rank: 3, name: "诡秘之主", heat: "已完结", source: "mock", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://example.invalid/mock" },
  ],
};

const FALLBACK_ROWS = BOARD_ROWS["畅销榜 Top10"];

const RETRYABLE_SOURCE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function fetchRankingSource(url: string): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0" },
      });
      if (res.ok || !RETRYABLE_SOURCE_STATUS.has(res.status) || attempt === 2) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) ? Math.min(5000, retryAfter * 1000) : 300 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("榜单源请求失败");
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const board = url.searchParams.get("board") ?? "畅销榜 Top10";
  const selectedBoard = BOARDS.find((item) => item.name === board) ?? BOARDS[0];

  // 测试模式：按榜返回不同数据（验证按榜查询）
  if (process.env.RANKINGS_PROVIDER === "mock") {
    return NextResponse.json({
      boards: BOARDS,
      rows: (BOARD_ROWS[board] ?? FALLBACK_ROWS).map((row) => ({ ...row, source: "mock", url: selectedBoard.url })),
      board: selectedBoard.name,
      degraded: true,
      note: "榜单数据源降级（mock 数据）",
    });
  }

  // 真实榜源请求（带榜参数，超时受控）；失败降级
  try {
    const res = await fetchRankingSource(selectedBoard.url);
    if (!res.ok) throw new Error(`上游 ${res.status}`);
    const html = await res.text();
    const capturedAt = new Date().toISOString();
    const names = [...html.matchAll(/"bookName":"([^"\\]+)"/g)]
      .map((m) => m[1])
      .filter((n, i, all) => all.indexOf(n) === i)
      .slice(0, 10);
    if (names.length === 0) {
      return NextResponse.json({ boards: BOARDS, rows: [], board: selectedBoard.name, degraded: true, note: "榜单解析失败，未返回虚构榜单" });
    }
    return NextResponse.json({
      boards: BOARDS,
      rows: names.slice(0, 5).map((n, i) => ({ rank: i + 1, name: n, heat: "—", source: "fanqienovel.com", capturedAt, url: selectedBoard.url })),
      board: selectedBoard.name,
      degraded: false,
    });
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "榜单源请求超时"
      : "榜单源暂时不可达";
    return NextResponse.json({
      boards: BOARDS,
      rows: [],
      board: selectedBoard.name,
      degraded: true,
      note: `${message}，未返回虚构榜单`,
    });
  }
}
