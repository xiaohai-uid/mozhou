// GET /api/v1/rankings/trends — 单榜趋势（T3 接线）：最近两次快照对比涨跌/新进/跌出。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { RANKING_BOARDS, findRankingBoard } from "@/lib/story/rankings";
import { buildTrendResponse, fetchTrendGroups } from "@/lib/rankings/trends-db";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const requestedBoard = url.searchParams.get("board") ?? "long-hot";
  const board = findRankingBoard(requestedBoard);
  if (!board) {
    return NextResponse.json({
      error: "未知榜单",
      code: "UNKNOWN_BOARD",
      boards: RANKING_BOARDS,
    }, { status: 400 });
  }

  const groups = await fetchTrendGroups(board.id);
  const result = buildTrendResponse(groups, { id: board.id, displayName: board.displayName });
  if (result.kind === "no-snapshot") {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 404 });
  }
  return NextResponse.json(result.body);
}
