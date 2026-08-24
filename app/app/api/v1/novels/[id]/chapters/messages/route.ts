// /api/v1/novels/[id]/chapters/messages — 章节对话历史（工单 17，V1.1 Journey ⑦）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listChapterMessages } from "@/lib/novels/chapter-chat";

/** GET /api/v1/novels/[id]/chapters/messages?chapterId=X — 章节对话历史（新→旧） */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const chapterId = Number(url.searchParams.get("chapterId"));
  if (!chapterId) {
    return NextResponse.json({ error: "缺少 chapterId" }, { status: 400 });
  }
  const messages = await listChapterMessages(user.id, Number(id), chapterId);
  if (!messages) return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  return NextResponse.json({ messages });
}
