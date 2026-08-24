// POST /api/v1/market/briefings — 从最近 7 天扫榜快照生成版本化 MarketBrief（工单 05，Delta 5）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createMarketBriefing } from "@/lib/market/briefing-artifacts";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const created = await createMarketBriefing();
  if (!created) {
    return NextResponse.json({ error: "暂无市场数据" }, { status: 404, statusText: "NO_DATA" });
  }
  return NextResponse.json({ briefing: created }, { status: 201 });
}
