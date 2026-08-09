// /api/v1/sessions — 会话列表 / 新建
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSession, listSessions } from "@/lib/chat/service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ sessions: await listSessions(user.id) });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const session = await createSession(user.id);
  return NextResponse.json({ session }, { status: 201 });
}
