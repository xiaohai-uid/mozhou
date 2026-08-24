// /api/v1/auth/logout — 清除会话 cookie
// POST：登出（契约）；GET：会话失效兜底（如用户已被删除），删 cookie 后 303 回登录页
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/login" },
  });
}
