// GET /api/v1/rankings — only verified Fanqie official boards are product-enabled.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  RANKING_BOARDS,
  fetchRankingWithRetry,
  findRankingBoard,
  resolveFanqieRankingRows,
  type RankingBoard,
  type RankingDegradation,
  type RankingRow,
} from "@/lib/story/rankings";
import {
  latestScanCapturedAt,
  scanAll,
  scanWithinCooldown,
} from "@/lib/rankings/scan";

export type { RankingBoard, RankingDegradation, RankingRow } from "@/lib/story/rankings";

const MOCK_ROWS: RankingRow[] = [
  "惹金枝", "笨蛋美人替嫁后被疯批王爷宠上天", "掌上娇娇", "攀高枝", "何不同舟渡",
].map((name, index) => ({
  bookId: `mock-${index + 1}`,
  rank: index + 1,
  name,
  source: "mock",
  sourceUrl: RANKING_BOARDS[0].listUrl,
  detailUrl: `https://example.invalid/mock/${index + 1}`,
  titleResolution: "detail-ssr",
  capturedAt: "1970-01-01T00:00:00.000Z",
  heat: "test-provider",
}));

interface RankingResponse {
  boards: RankingBoard[];
  board: Pick<RankingBoard, "id" | "displayName">;
  source: "fanqienovel.com" | "mock";
  capturedAt: string;
  rows: RankingRow[];
  degraded: boolean;
  degradation?: RankingDegradation;
  note?: string;
}

function responseBody(input: Omit<RankingResponse, "boards">): RankingResponse {
  return { boards: RANKING_BOARDS, ...input };
}

async function fetchRankingSource(url: string): Promise<Response> {
  return fetchRankingWithRetry({
    url,
    request: async (requestUrl) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        return await fetch(requestUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0" },
        });
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const requestedBoard = url.searchParams.get("board") ?? RANKING_BOARDS[0].id;
  const selectedBoard = findRankingBoard(requestedBoard);
  if (!selectedBoard) {
    return NextResponse.json({
      error: "未知榜单",
      code: "UNKNOWN_BOARD",
      boards: RANKING_BOARDS,
    }, { status: 400 });
  }

  const capturedAt = new Date().toISOString();
  const board = { id: selectedBoard.id, displayName: selectedBoard.displayName };

  // Mock is test-only and explicitly degraded; it is never a production fallback.
  if (process.env.RANKINGS_PROVIDER === "mock") {
    return NextResponse.json(responseBody({
      board,
      source: "mock",
      capturedAt,
      rows: MOCK_ROWS.map((row) => ({ ...row, sourceUrl: selectedBoard.listUrl })),
      degraded: true,
      degradation: {
        code: "SOURCE_FETCH_FAILED",
        attempted: 5,
        accepted: 5,
        rejected: 0,
      },
      note: "测试榜源，不代表生产数据",
    } satisfies Omit<RankingResponse, "boards">));
  }

  try {
    const listResponse = await fetchRankingSource(selectedBoard.listUrl);
    if (!listResponse.ok) {
      return NextResponse.json(responseBody({
        board,
        source: "fanqienovel.com",
        capturedAt,
        rows: [],
        degraded: true,
        degradation: { code: "SOURCE_FETCH_FAILED", attempted: 0, accepted: 0, rejected: 0 },
      } satisfies Omit<RankingResponse, "boards">));
    }

    const result = await resolveFanqieRankingRows({
      boardUrl: selectedBoard.listUrl,
      capturedAt,
      listHtml: await listResponse.text(),
      fetchDetail: async (bookId) => {
        const detail = await fetchRankingSource(`https://fanqienovel.com/page/${bookId}`);
        if (!detail.ok) throw new Error("detail source unavailable");
        return detail.text();
      },
    });
    return NextResponse.json(responseBody({
      board,
      source: "fanqienovel.com",
      capturedAt,
      rows: result.rows,
      degraded: result.degraded,
      ...(result.degradation ? { degradation: result.degradation } : {}),
    } satisfies Omit<RankingResponse, "boards">));
  } catch {
    return NextResponse.json(responseBody({
      board,
      source: "fanqienovel.com",
      capturedAt,
      rows: [],
      degraded: true,
      degradation: { code: "SOURCE_FETCH_FAILED", attempted: 0, accepted: 0, rejected: 0 },
    } satisfies Omit<RankingResponse, "boards">));
  }
}

