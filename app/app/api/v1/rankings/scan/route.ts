// POST /api/v1/rankings/scan - manual scan trigger
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { scanAll, latestScanCapturedAt, scanWithinCooldown } from "@/lib/rankings/scan";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const lastCapturedAt = await latestScanCapturedAt();
  if (scanWithinCooldown(lastCapturedAt)) {
    return NextResponse.json({ error: "扫榜过于频繁，请稍后再试", retryAfter: 60, lastCapturedAt }, { status: 429 });
  }
  const result = await scanAll();
  return NextResponse.json(result);
}
