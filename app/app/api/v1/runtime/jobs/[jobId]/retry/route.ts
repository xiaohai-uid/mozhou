// POST /api/v1/runtime/jobs/[jobId]/retry — 人工重试指定 step（Q4：仅「未产生结果」的 step；越权统一 404）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getJob, retryStep } from "@/lib/tasks/service";

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
  let body: { stepId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const stepId = Number(body.stepId);
  if (!Number.isInteger(stepId) || stepId <= 0) {
    return NextResponse.json({ error: "缺少合法 stepId" }, { status: 400 });
  }
  const retried = await retryStep(jobId, stepId);
  if (!retried) {
    return NextResponse.json(
      { error: "该步骤已产生结果或任务不在可重试状态（不重复扣费底线）" },
      { status: 409 },
    );
  }
  return NextResponse.json({ jobId, status: retried.status });
}
