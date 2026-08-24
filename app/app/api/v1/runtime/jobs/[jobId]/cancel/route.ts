// POST /api/v1/runtime/jobs/[jobId]/cancel — 通用取消；running 由 owner 在边界收口
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { cancelJob, getJob } from "@/lib/tasks/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const cancelled = await cancelJob(jobId);
  if (!cancelled) return NextResponse.json({ error: "任务已处于终态，无需取消" }, { status: 409 });
  return NextResponse.json({
    jobId,
    status: cancelled.status,
    cancelRequested: cancelled.cancelRequested,
  });
}
