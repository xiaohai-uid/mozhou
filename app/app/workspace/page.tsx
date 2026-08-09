import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { LogoutButton } from "./logout-button";

export default async function WorkspacePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect("/login");

  // proxy 只做乐观校验，这里以数据库为准（用户可能已被删除）
  const [user] = await db
    .select({ id: users.id, email: users.email, tier: users.tier })
    .from(users)
    .where(eq(users.id, Number(session.sub)));
  if (!user) {
    // 先经 logout route handler 清 cookie 再回登录页；
    // 直接 redirect /login 会因 proxy 的「已登录访问 /login」再踢回，死循环
    redirect("/api/v1/auth/logout");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-bold text-white">
          墨
        </div>
        <h1 className="text-2xl font-semibold tracking-wide">
          欢迎回来，{user.email}
        </h1>
        <Badge variant="secondary" className="text-xs">
          {user.tier === "member" ? "会员" : "免费版"}
        </Badge>
      </div>
      <p className="text-zinc-400">
        写作工作台正在打磨中——小说项目、人物库与世界观即将上线。
      </p>
      <LogoutButton />
    </main>
  );
}
