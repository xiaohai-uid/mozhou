// POST /api/v1/novels/[id]/chapters/messages/[messageId]/insert — 插入 AI 回复到正文（工单 18 + J9 精确插入）
// J9 冲突：第一层 expectedContent 与当前正文不一致且非 force → 409 ContentChanged（客户端确认后 force 重发）；
// position/range 校验失败一律 400（不 silent clamp，force 同样校验）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ChapterNotFoundError,
  ContentChangedError,
  insertChapterMessage,
  type InsertTarget,
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
    mode?: unknown;
    position?: unknown;
    range?: unknown;
    expectedContent?: unknown;
  } | null;
  const content = typeof body?.content === "string" ? body.content : "";
  const force = body?.force === true;
  // 类型门禁：显式传入但类型错误（string/NaN 偷渡）→ NaN 交给 service isInt 拒绝（400），不静默忽略
  const rawPos = body?.position;
  const position = rawPos === undefined ? undefined : typeof rawPos === "number" ? rawPos : NaN;
  const rawRange = body?.range;
  const range =
    typeof rawRange === "object" && rawRange !== null
      ? {
          start:
            typeof (rawRange as { start?: unknown }).start === "number"
              ? ((rawRange as { start?: unknown }).start as number)
              : NaN,
          end:
            typeof (rawRange as { end?: unknown }).end === "number"
              ? ((rawRange as { end?: unknown }).end as number)
              : NaN,
        }
      : undefined;
  const target: InsertTarget = {
    mode:
      body?.mode === undefined
        ? "insert"
        : body?.mode === "replace"
          ? "replace"
          : ("INVALID" as InsertTarget["mode"]), // 显式非法 mode → service 拒绝（400）
    ...(position !== undefined ? { position } : {}),
    ...(range !== undefined ? { range } : {}),
    ...(typeof body?.expectedContent === "string" ? { expectedContent: body.expectedContent } : {}),
  };

  try {
    const result = await insertChapterMessage(
      user.id,
      Number(id),
      chapterId,
      messageId,
      content,
      force,
      target,
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
