// POST /api/v1/novels/[id]/chapters/chat/stop?chapterId=X
// Stops a chapter candidate through the database so the active Cloud Run
// instance can observe the decision even when the SSE disconnect is delayed.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requestStopChapterCandidate } from "@/lib/novels/chapter-candidate";
import { resolveOwnedChapter } from "@/lib/novels/ownership";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const novelId = Number(id);
  const chapterId = Number(new URL(request.url).searchParams.get("chapterId"));
  if (!Number.isInteger(novelId) || !Number.isInteger(chapterId) || chapterId <= 0) {
    return NextResponse.json({ error: "缺少有效的 chapterId" }, { status: 400 });
  }

  let body: { generationKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const generationKey =
    typeof body.generationKey === "string" ? body.generationKey.trim() : "";
  if (!generationKey || generationKey.length > 120) {
    return NextResponse.json({ error: "生成请求键无效" }, { status: 400 });
  }

  if (!(await resolveOwnedChapter({ userId: user.id, novelId, chapterId }))) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }

  const stopped = await requestStopChapterCandidate({
    userId: user.id,
    novelId,
    chapterId,
    generationKey,
  });
  return NextResponse.json({ stopped });
}
