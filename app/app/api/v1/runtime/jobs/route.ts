// GET /api/v1/runtime/jobs — 任务列表（票 09，owner scope）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listJobs } from "@/lib/tasks/service";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const jobs = await listJobs(user.id, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ jobs });
}
