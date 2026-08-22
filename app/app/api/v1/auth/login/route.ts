// POST /api/v1/auth/login — 邮箱+密码登录
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { parseCredentials } from "@/lib/auth/validation";
import { verifyPassword } from "@/lib/auth/password";
import { signSession, setSessionCookie } from "@/lib/auth/session";
import { consumeRateLimit, rateLimit429 } from "@/lib/http/rate-limit";

// 用户不存在时也对假哈希做一次 compare，抹平「邮箱未注册」的响应时差
const DUMMY_HASH =
  "$2b$12$dpGbxe16YFWRKE6xJcBjfeuGsBe3/7l8WcHhI.a4i1NBWpL94b2eK";

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

  // 工单 C：登录防爆破。键 = 邮箱+来源 IP，10 次/分钟，失败尝试同样计数
  // （计数在密码校验前消耗）。多实例部署需共享存储，见 lib/http/rate-limit.ts。
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const rl = consumeRateLimit(`login:${email.toLowerCase()}|${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimit429(rl.retryAfterSec);

  const [user] = await db.select().from(users).where(eq(users.email, email));
  // 统一文案 + 恒定时间：不暴露「邮箱未注册」还是「密码错误」
  const matched = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matched) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const token = await signSession({ sub: String(user.id), email: user.email, tier: user.tier });
  const cookieStore = await cookies();
  setSessionCookie(cookieStore, token);

  return NextResponse.json({
    user: { id: user.id, email: user.email, tier: user.tier },
  });
}
