// POST /api/v1/search — 书源搜索（08 工单）：真实检索 + 网络容错降级（绝不抛异常）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { searchSources } from "@/lib/source/engine";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    query?: unknown;
  } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "搜索关键词不能为空" }, { status: 400 });
  }
  if (query.length > 100) {
    return NextResponse.json({ error: "搜索词过长（上限 100 字）" }, { status: 400 });
  }

  // 容错：engine 内部捕获所有网络异常并降级，这里不会再抛
  const outcome = await searchSources(query);
  return NextResponse.json(outcome);
}
