// GET /api/v1/runtime/jobs/[jobId] — 任务详情（票 09：job + steps + attempts + events；越权统一 404）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getJobDetail } from "@/lib/tasks/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { jobId } = await params;
  const detail = await getJobDetail(jobId);
  if (!detail || detail.job.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
