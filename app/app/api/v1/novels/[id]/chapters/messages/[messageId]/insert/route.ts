// POST /api/v1/novels/[id]/chapters/messages/[messageId]/insert — 插入 AI 回复到正文（工单 18）
// 冲突保护：生成快照 ≠ 当前正文 且非 force → 409 ContentChanged（客户端确认后 force 重发）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ChapterNotFoundError,
  ContentChangedError,
  insertChapterMessage,
} from "@/lib/novels/chapter-chat";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, messageId: messageIdRaw } = await params;
  const messageId = Number(messageIdRaw);
  const url = new URL(request.url);
  const chapterId = Number(url.searchParams.get("chapterId"));
  if (!chapterId) {
    return NextResponse.json({ error: "缺少 chapterId" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    content?: unknown;
    force?: unknown;
  } | null;
  const content = typeof body?.content === "string" ? body.content : "";
  const force = body?.force === true;

  try {
    const result = await insertChapterMessage(
      user.id,
      Number(id),
      chapterId,
      messageId,
      content,
      force,
    );
    return NextResponse.json({ ...result, message: { inserted: true } });
  } catch (err) {
    if (err instanceof ChapterNotFoundError) {
      return NextResponse.json({ error: "章节不存在" }, { status: 404 });
    }
    if (err instanceof ContentChangedError) {
      return NextResponse.json(
        { error: "正文已变化，这条回复基于旧正文", code: "ContentChanged" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
