// GET /api/v1/runtime/jobs/[jobId]/events?afterSeq=N — 事件游标补发（spec §6.2 Q2；SSE Last-Event-ID 语义）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readEvents, getJob } from "@/lib/tasks/service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { jobId } = await params;
  const url = new URL(request.url);
  const afterSeq = Number(url.searchParams.get("afterSeq") ?? "0");
  if (!jobId.trim() || !Number.isFinite(afterSeq) || afterSeq < 0) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const job = await getJob(jobId);
  // 归属校验：越权统一 404（不泄露存在性）
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const events = await readEvents(jobId, afterSeq);
  return NextResponse.json({ jobId, afterSeq, events });
}
