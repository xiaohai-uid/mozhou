// 当前登录用户（route handler / server component 共用）
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";

export interface CurrentUser {
  id: number;
  email: string;
  tier: "free" | "member";
}

/** proxy 只做乐观校验，这里以数据库为准（用户可能已被删除） */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) return null;
  const [user] = await db
    .select({ id: users.id, email: users.email, tier: users.tier })
    .from(users)
    .where(eq(users.id, Number(session.sub)));
  return user ?? null;
}
