// POST /api/v1/novels/[id]/chapters/chat/stop?chapterId=X
// Stops a chapter candidate through the database so the active Cloud Run
// instance can observe the decision even when the SSE disconnect is delayed.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_MODEL } from "@/lib/chat/models";
import { requestStopChapterCandidate } from "@/lib/novels/chapter-candidate";
import { resolveOwnedChapter } from "@/lib/novels/ownership";
import { resolveProviderBoundary } from "@/lib/ai/provider-boundary";
import { appendEvent, cancelJobImmediately } from "@/lib/tasks/service";
import { recordAttemptUsage } from "@/lib/tasks/usage-ledger";

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
  const cancelledTask = stopped ? await cancelJobImmediately(generationKey) : null;
  if (cancelledTask?.job) {
    await appendEvent({
      jobId: generationKey,
      eventType: "error",
      payload: { status: "cancelled", reason: "user_cancelled" },
      clientKey: "cancelled",
    }).catch(() => {});

    await Promise.all(cancelledTask.attempts.map(async (attempt) => {
      const boundary = resolveProviderBoundary({
        route: "chapter",
        model: attempt.model ?? DEFAULT_MODEL,
      });
      await recordAttemptUsage({
        userId: user.id,
        requestId: generationKey,
        taskId: generationKey,
        generationId: generationKey,
        attemptId: attempt.id,
        sourceClass: boundary.sourceClass,
        provider: attempt.provider ?? boundary.provider,
        model: attempt.model ?? boundary.model,
        credentialOwner: boundary.credentialOwner,
        billingOwner: boundary.billingOwner,
        route: "chapter",
        status: "cancelled",
        usageStatus: "unknown",
      });
    })).catch(() => {});
  }
  return NextResponse.json({ stopped: stopped || Boolean(cancelledTask?.job) });
}
