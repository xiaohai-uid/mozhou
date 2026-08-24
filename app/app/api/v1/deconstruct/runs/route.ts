// GET /api/v1/deconstruct/runs — 当前用户可恢复的拆解运行记录。
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { deconstructionRuns } from "@/lib/schema";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const runs = await db
    .select({
      id: deconstructionRuns.id,
      novelId: deconstructionRuns.novelId,
      title: deconstructionRuns.title,
      sourceLength: deconstructionRuns.sourceLength,
      requestKey: deconstructionRuns.requestKey,
      status: deconstructionRuns.status,
      result: deconstructionRuns.result,
      errorMessage: deconstructionRuns.errorMessage,
      attemptCount: deconstructionRuns.attemptCount,
      lastErrorClass: deconstructionRuns.lastErrorClass,
      lastAttemptAt: deconstructionRuns.lastAttemptAt,
      createdAt: deconstructionRuns.createdAt,
      updatedAt: deconstructionRuns.updatedAt,
    })
    .from(deconstructionRuns)
    .where(and(eq(deconstructionRuns.userId, user.id)))
    .orderBy(desc(deconstructionRuns.updatedAt))
    .limit(50);
  return NextResponse.json({ runs });
}
