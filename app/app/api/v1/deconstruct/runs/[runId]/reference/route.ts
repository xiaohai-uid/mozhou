// GET /api/v1/deconstruct/runs/:runId/reference — 稳定 artifact 的下游写作消费投影。
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { deconstructionRuns } from "@/lib/schema";
import { buildWritingReference } from "@/lib/story/deconstruction-artifacts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { runId: rawRunId } = await params;
  const runId = Number(rawRunId);
  if (!Number.isInteger(runId) || runId <= 0) return NextResponse.json({ error: "运行记录无效" }, { status: 400 });
  const [run] = await db
    .select({ result: deconstructionRuns.result, status: deconstructionRuns.status })
    .from(deconstructionRuns)
    .where(and(eq(deconstructionRuns.id, runId), eq(deconstructionRuns.userId, user.id)));
  if (!run) return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
  if (run.status !== "completed" || !run.result) return NextResponse.json({ error: "拆解尚未完成" }, { status: 409 });
  return NextResponse.json({ runId, reference: buildWritingReference(run.result) });
}
