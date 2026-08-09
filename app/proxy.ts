// 认证守卫（Next.js 16 中间件，Node 运行时）
// - 受保护路径无有效会话 → 重定向 /login?next=…
// - 已登录访问 /login|/register → 重定向 /workspace
import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/workspace") && !session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  if ((pathname === "/login" || pathname === "/register") && session) {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*", "/chat/:path*", "/login", "/register"],
};
