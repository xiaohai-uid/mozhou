// POST /api/v1/market/titles — 候选书名生成（T9 接线，原型级规则生成；二期接 LLM）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  buildTitleCandidates,
  fetchLatestBookNames,
} from "@/lib/market/service";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    genre?: unknown;
  } | null;
  const genre =
    typeof body?.genre === "string" && body.genre.trim()
      ? body.genre.trim()
      : undefined;

  const bookNames = await fetchLatestBookNames(genre);
  const { references, candidates } = buildTitleCandidates(bookNames, genre ?? null);

  return NextResponse.json({ genre: genre ?? null, references, candidates });
}
