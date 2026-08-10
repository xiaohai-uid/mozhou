// GET/POST /api/v1/sync/config — WebDAV 云同步配置（任务二-C）
// POST 保存并测试连接：真实 WebDAV OPTIONS 探测（5s 超时），失败返回可读错误（不抛异常）
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { syncConfigs } from "@/lib/schema";

const TIMEOUT_MS = 5000;

/** GET：读取已保存配置（不回传密码原文） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [row] = await db
    .select({ url: syncConfigs.url, username: syncConfigs.username, autoSync: syncConfigs.autoSync })
    .from(syncConfigs)
    .where(eq(syncConfigs.userId, user.id));
  if (!row) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, ...row });
}

/** POST：保存配置 + 测试连接 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    username?: unknown;
    password?: unknown;
    autoSync?: unknown;
  } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!url || !username || !password) {
    return NextResponse.json({ error: "服务器地址/账号/应用密码均不能为空" }, { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "服务器地址须以 http(s):// 开头" }, { status: 400 });
  }
  const autoSync = body?.autoSync === false ? false : true;

  // 测试模式：确定性成功
  if (process.env.SYNC_PROVIDER === "mock") {
    await saveConfig(user.id, url, username, password, autoSync);
    return NextResponse.json({ ok: true, message: "已连接（mock 测试）" });
  }

  // 真实 WebDAV 连接测试（OPTIONS 探测，超时受控）
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const res = await fetch(url, {
      method: "OPTIONS",
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${auth}` },
    });
    clearTimeout(timer);
    if (res.status >= 500 || res.status === 0) {
      throw new Error(`服务器响应 ${res.status}`);
    }
    await saveConfig(user.id, url, username, password, autoSync);
    return NextResponse.json({ ok: true, message: "已连接" });
  } catch (err) {
    // 连接失败：不保存？—— 保存但标记测试失败（用户可重试），返回可读错误
    return NextResponse.json(
      { ok: false, message: `连接测试失败：${(err as Error).message}` },
      { status: 200 },
    );
  }
}

async function saveConfig(
  userId: number,
  url: string,
  username: string,
  password: string,
  autoSync: boolean,
) {
  const [existing] = await db
    .select({ id: syncConfigs.id })
    .from(syncConfigs)
    .where(eq(syncConfigs.userId, userId));
  if (existing) {
    await db
      .update(syncConfigs)
      .set({ url, username, password, autoSync, updatedAt: sql`now()` })
      .where(eq(syncConfigs.id, existing.id));
  } else {
    await db.insert(syncConfigs).values({ userId, url, username, password, autoSync });
  }
}
