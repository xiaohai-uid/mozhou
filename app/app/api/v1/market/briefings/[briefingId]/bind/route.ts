// POST /api/v1/market/briefings/:briefingId/bind — 绑定简报到作品（归属校验）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { bindMarketBriefing } from "@/lib/market/briefing-artifacts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ briefingId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { briefingId } = await params;
  const body = (await request.json().catch(() => null)) as { novelId?: unknown } | null;
  const novelId = typeof body?.novelId === "number" && Number.isInteger(body.novelId) ? body.novelId : null;
  if (novelId == null) {
    return NextResponse.json({ error: "缺少 novelId" }, { status: 400 });
  }
  const ok = await bindMarketBriefing({ userId: user.id, novelId, artifactId: briefingId });
  if (!ok) {
    return NextResponse.json({ error: "作品不存在或简报不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
