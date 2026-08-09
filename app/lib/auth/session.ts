// JWT 会话（httpOnly cookie）。仅依赖 jose：proxy.ts（Node/edge）与 route handler 双端可用。
// 注意：只允许 type-only import（编译期擦除），保持 edge 安全。
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { users } from "@/lib/schema";

export const SESSION_COOKIE = "mozhou_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

export interface SessionPayload {
  sub: string; // user id
  email: string;
  tier: typeof users.$inferSelect.tier;
}

const rawSecret = process.env.AUTH_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  // 生产缺失密钥 = 任何人可伪造 JWT，宁可启动失败也不静默用默认值
  throw new Error("AUTH_SECRET 未配置（生产环境必须设置）");
}
const secret = new TextEncoder().encode(rawSecret ?? "dev-secret-change-me");

/** 写入会话 cookie 的最小接口（与 next/headers cookies() 结构兼容，避免引入内部类型） */
export interface SessionCookieStore {
  set(
    name: string,
    value: string,
    options: {
      httpOnly?: boolean;
      sameSite?: "lax" | "strict" | "none";
      secure?: boolean;
      path?: string;
      maxAge?: number;
    },
  ): void;
}

/** 写入会话 cookie（注册/登录共用） */
export function setSessionCookie(store: SessionCookieStore, token: string) {
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload } as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return null;
    }
    // 校验而非白名单归一：tier 只可能是 schema 枚举两值，防伪造 token 注入非法值
    if (payload.tier !== "free" && payload.tier !== "member") {
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email,
      tier: payload.tier,
    };
  } catch {
    return null;
  }
}
