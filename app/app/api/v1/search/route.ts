// POST /api/v1/search — 两级搜索（T5+T6 接线）：本地书目索引优先 → 番茄实时搜索降级。
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { rankingSnapshots } from "@/lib/schema";
import { matchBooks, type BookEntry } from "@/lib/search/bookIndex";
import { searchFanqie } from "@/lib/search/fanqie";
import { decide } from "@/lib/search/pipeline";

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

  // 第 2 级：仅本地未命中时走番茄实时搜索（失败/降级由 decide 折叠）。
  let fanqieOutcome = null;
  if (localHits.length === 0) {
    fanqieOutcome = await searchFanqie(query);
  }
  const decision = decide(query, localHits, fanqieOutcome);
  return NextResponse.json({
    source: decision.source,
    results: decision.results,
    degraded: decision.degraded,
    ...(decision.note ? { note: decision.note } : {}),
  });
}
