// POST /api/v1/auth/register — 注册并自动登录
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { parseCredentials } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";
import { signSession, setSessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = parseCredentials(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  let user: { id: number; email: string; tier: "free" | "member" };
  try {
    // 并发同邮箱注册时靠唯一约束兜底（先查后插的竞态窗口）
    [user] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email, tier: users.tier });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "该邮箱已注册，请直接登录" }, { status: 409 });
    }
    throw err;
  }

  const token = await signSession({ sub: String(user.id), email: user.email, tier: user.tier });
  const cookieStore = await cookies();
  setSessionCookie(cookieStore, token);

  return NextResponse.json({ user }, { status: 201 });
}
