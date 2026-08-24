// /api/v1/sessions — 会话列表 / 新建（支持绑定当前作品 novelId）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSession, listSessions, SessionNotFoundError } from "@/lib/chat/service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ sessions: await listSessions(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    novelId?: unknown;
  } | null;
  const novelId =
    typeof body?.novelId === "number" && Number.isInteger(body.novelId)
      ? body.novelId
      : null;
  try {
    const session = await createSession(user.id, undefined, novelId);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    }
    throw error;
  }
}
