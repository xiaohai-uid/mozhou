// GET /api/v1/account — 账户概览：tier + 真实用量（11 工单）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAccountOverview } from "@/lib/account/service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const overview = await getAccountOverview(user.id, user.email);
  return NextResponse.json(overview);
}
