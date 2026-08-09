// GET /api/v1/sessions/{id}/messages — 会话消息（校验归属）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listMessages } from "@/lib/chat/service";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) {
    return NextResponse.json({ error: "无效的会话 ID" }, { status: 400 });
  }

  const rows = await listMessages(sessionId, user.id);
  if (rows === null) {
    // 会话不存在或不属于该用户
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  return NextResponse.json({ messages: rows });
}
