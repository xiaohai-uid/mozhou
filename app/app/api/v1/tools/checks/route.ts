// POST /api/v1/tools/checks — 写作机检（storyrepo 与普通写作工具共用）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { runWritingChecks } from "@/lib/story/checks";
import type { WritingCheckResult } from "@/lib/story/checks";

export type CheckResult = WritingCheckResult;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    mustCover?: unknown;
    knownEntities?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "正文不能为空" }, { status: 400 });
  const mustCover = Array.isArray(body?.mustCover)
    ? body.mustCover.filter((word): word is string => typeof word === "string")
    : [];
  const knownEntities = Array.isArray(body?.knownEntities)
    ? body.knownEntities.filter((entity): entity is string => typeof entity === "string")
    : [];
  try {
    return NextResponse.json({ checks: runWritingChecks(text, { mustCover, knownEntities }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "机检失败";
    return NextResponse.json({ error: message }, { status: message.startsWith("正文过长") ? 413 : 400 });
  }
}
