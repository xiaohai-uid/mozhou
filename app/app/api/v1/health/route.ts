// GET /api/v1/health — 存活 + 数据库可达性探测（工单 D）。
// 公开无鉴权：供 compose healthcheck / 负载均衡 / uptime 监控使用，不泄露任何业务数据。
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function GET() {
  let dbStatus = "up";
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbStatus = "down";
  }
  // db down 也算实例存活：503 让编排层重启/摘流，响应体区分故障面
  return NextResponse.json(
    { ok: true, db: dbStatus, uptimeSec: Math.floor(process.uptime()) },
    { status: dbStatus === "up" ? 200 : 503 },
  );
}
