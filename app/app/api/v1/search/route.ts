// POST /api/v1/search — 本地索引 + 四个正规平台实时搜索；结果只保留可验证书目。
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { rankingSnapshots } from "@/lib/schema";
import { matchBooks, type BookEntry } from "@/lib/search/bookIndex";
import { decide } from "@/lib/search/pipeline";
import { searchSources } from "@/lib/source/engine";

// fanqie 搜索用 a_bogus 签名（require/eval），需 Node 运行时。
export const runtime = "nodejs";

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

  // 第 1 级：本地书目索引。DISTINCT ON (book_id) + ORDER BY book_id, captured_at DESC
  // 取每本书最新一次扫榜的 name/author/category。
  const rows = await db
    .selectDistinctOn([rankingSnapshots.bookId], {
      bookId: rankingSnapshots.bookId,
      name: rankingSnapshots.name,
      author: rankingSnapshots.author,
      category: rankingSnapshots.category,
    })
    .from(rankingSnapshots)
    .orderBy(rankingSnapshots.bookId, desc(rankingSnapshots.capturedAt));
  const entries: BookEntry[] = rows.map((r) => ({
    bookId: r.bookId,
    name: r.name,
    author: r.author,
    category: r.category,
  }));
  const localHits = matchBooks(entries, query);

  // 第 2 级：起点、番茄、七猫、晋江并行实时搜索；失败/部分失败由 decide 折叠。
  // 即使本地命中也请求实时源，避免把历史榜单索引误当成唯一书源。
  const sourceOutcome = await searchSources(query);
  const decision = decide(query, localHits, sourceOutcome);
  return NextResponse.json({
    source: decision.source,
    results: decision.results,
    degraded: decision.degraded,
    ...(decision.note ? { note: decision.note } : {}),
  });
}
