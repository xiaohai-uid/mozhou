// GET /api/v1/market/briefing — 市场风向简报（T9 接线）：最近 7 天榜单快照聚合。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { buildBriefingResponse, fetchRecentSnapshots } from "@/lib/market/service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const now = new Date();
  const rows = await fetchRecentSnapshots(7);
  const result = buildBriefingResponse(rows, now.toISOString(), now.toISOString());
  if (result.status === 404) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 404 });
  }
  return NextResponse.json({ summary: result.summary, rendered: result.rendered });
}
