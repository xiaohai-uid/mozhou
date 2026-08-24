// POST /api/v1/runtime/jobs/[jobId]/end — 人工结束卡死任务（failed_terminal + manual_ended；越权统一 404）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { endJob, getJob } from "@/lib/tasks/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  let reason: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
  } catch {
    reason = null;
  }
  const ended = await endJob(jobId, reason);
  if (!ended) {
    return NextResponse.json({ error: "任务已处于终态，无需结束" }, { status: 409 });
  }
  return NextResponse.json({ jobId, status: ended.status, errorClass: ended.errorClass });
}
