// POST /api/v1/novels/[id]/chapters/messages/[messageId]/discard — 丢弃候选，不修改正文
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { discardChapterMessage } from "@/lib/novels/chapter-chat";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, messageId: messageIdRaw } = await params;
  const chapterId = Number(new URL(request.url).searchParams.get("chapterId"));
  const messageId = Number(messageIdRaw);
  if (!chapterId || !Number.isInteger(messageId)) {
    return NextResponse.json({ error: "缺少有效参数" }, { status: 400 });
  }
  const ok = await discardChapterMessage(user.id, Number(id), chapterId, messageId);
  if (!ok) return NextResponse.json({ error: "候选不存在或已处理" }, { status: 404 });
  return NextResponse.json({ ok: true, status: "discarded" });
}
