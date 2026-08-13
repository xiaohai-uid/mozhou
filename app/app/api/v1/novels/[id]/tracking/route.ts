// GET/POST /api/v1/novels/[id]/tracking — storyrepo 作品级追踪与章节结算适配器。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getStoryTracking,
  normalizeStoryChapterFacts,
  settleChapter,
  StoryTrackingConflictError,
  StoryTrackingNotFoundError,
} from "@/lib/story/tracking";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const snapshot = await getStoryTracking(user.id, Number(id));
  if (!snapshot) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json(snapshot);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    chapterId?: unknown;
    idempotencyKey?: unknown;
    mustCover?: unknown;
    expectedStateRevision?: unknown;
    facts?: unknown;
  } | null;
  const chapterId = typeof body?.chapterId === "number" ? body.chapterId : Number(body?.chapterId);
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const mustCover = Array.isArray(body?.mustCover)
    ? body.mustCover.filter((word): word is string => typeof word === "string")
    : [];
  const expectedStateRevision = typeof body?.expectedStateRevision === "number" && Number.isInteger(body.expectedStateRevision)
    ? body.expectedStateRevision
    : undefined;
  if (!Number.isInteger(chapterId) || chapterId <= 0 || !idempotencyKey) {
    return NextResponse.json({ error: "缺少有效的章节或 workflow 幂等键" }, { status: 400 });
  }
  try {
    const result = await settleChapter({ userId: user.id, novelId: Number(id), chapterId, idempotencyKey, mustCover, expectedStateRevision, facts: normalizeStoryChapterFacts(body?.facts) });
    const snapshot = await getStoryTracking(user.id, Number(id));
    if (!snapshot) throw new StoryTrackingNotFoundError();
    return NextResponse.json({ ...snapshot, workflow: result }, { status: result.status === "rejected" ? 422 : 200 });
  } catch (error) {
    if (error instanceof StoryTrackingNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof StoryTrackingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "章节结算失败" }, { status: 400 });
  }
}
