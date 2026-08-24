// GET /api/v1/novels/:id/briefings — 作品已绑定 MarketBrief 列表（新→旧，脱敏元数据）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isNovelOwned } from "@/lib/chat/service";
import { listBoundBriefings } from "@/lib/market/briefing-artifacts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const novelId = Number((await params).id);
  if (!Number.isInteger(novelId) || !(await isNovelOwned(user.id, novelId))) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  const rows = await listBoundBriefings(novelId);
  return NextResponse.json({
    briefings: rows.map(({ artifact }) => ({
      artifactId: artifact.artifactId,
      version: artifact.version,
      provenance: artifact.provenance,
      createdAt: artifact.createdAt.toISOString(),
    })),
  });
}
