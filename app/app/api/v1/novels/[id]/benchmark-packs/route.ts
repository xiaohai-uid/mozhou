// /api/v1/novels/:id/benchmark-packs — BenchmarkPack 创建绑定（POST）与列表（GET）（工单 06）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isNovelOwned } from "@/lib/chat/service";
import { createBenchmarkPack, listBenchmarkPacks } from "@/lib/story/benchmark-packs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const novelId = Number((await params).id);
  if (!Number.isInteger(novelId) || novelId <= 0) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = typeof body?.runId === "number" && Number.isInteger(body.runId) ? body.runId : null;
  if (runId == null) {
    return NextResponse.json({ error: "缺少 runId" }, { status: 400 });
  }
  const created = await createBenchmarkPack({ userId: user.id, novelId, runId });
  if (!created) {
    return NextResponse.json({ error: "作品不存在或拆解运行未完成" }, { status: 404 });
  }
  return NextResponse.json({ pack: created }, { status: 201 });
}

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
  const rows = await listBenchmarkPacks(novelId);
  return NextResponse.json({
    packs: rows.map(({ artifact }) => ({
      artifactId: artifact.artifactId,
      version: artifact.version,
      provenance: artifact.provenance,
      sourceRunId: (artifact.data as { sourceRunId?: number })?.sourceRunId ?? null,
      createdAt: artifact.createdAt.toISOString(),
    })),
  });
}
