// GET /api/v1/runtime/generations/:generationId — 本次创作链路证据（plan + SkillRuns + manifest，脱敏视图）
// V1.3 工单 01：右栏「本次创作链路」与移动端二级面板的数据源。
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { generationPlans } from "@/lib/schema";
import { loadGenerationEvidence } from "@/lib/runtime/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { generationId } = await params;
  if (!generationId.trim()) {
    return NextResponse.json({ error: "缺少 generationId" }, { status: 400 });
  }
  // 归属校验：plan.userId 必须等于当前用户（防跨用户读证据）
  const [planRow] = await db
    .select({ userId: generationPlans.userId })
    .from(generationPlans)
    .where(eq(generationPlans.generationId, generationId));
  if (!planRow || planRow.userId !== user.id) {
    return NextResponse.json({ error: "生成记录不存在" }, { status: 404 });
  }
  const evidence = await loadGenerationEvidence(generationId);
  return NextResponse.json({ evidence });
}
