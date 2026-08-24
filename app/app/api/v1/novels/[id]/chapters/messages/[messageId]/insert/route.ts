// POST /api/v1/novels/[id]/chapters/messages/[messageId]/insert — 插入 AI 回复到正文（工单 18 + J9 精确插入）
// J9 冲突：第一层 expectedContent 与当前正文不一致且非 force → 409 ContentChanged（客户端确认后 force 重发）；
// position/range 校验失败一律 400（不 silent clamp，force 同样校验）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ChapterNotFoundError,
  ContentChangedError,
  insertChapterMessage,
  recordQualityGateOverride,
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
    mode?: unknown;
    editedContent?: unknown;
    force?: unknown;
    target?: unknown;
  } | null;
  const mode = body?.mode === "original" || body?.mode === "edited" ? body.mode : null;
  if (!mode) {
    return NextResponse.json({ error: "缺少有效的候选确认模式" }, { status: 400 });
  }
  const editedContent = typeof body?.editedContent === "string" ? body.editedContent : undefined;
  if (mode === "edited" && !editedContent?.trim()) {
    return NextResponse.json({ error: "编辑后的候选内容不能为空" }, { status: 400 });
  }
  const force = body?.force === true;
  const rawTarget = typeof body?.target === "object" && body.target !== null
    ? body.target as { mode?: unknown; position?: unknown; range?: unknown; expectedContent?: unknown }
    : {};
  // 类型门禁：显式传入但类型错误（string/NaN 偷渡）→ NaN 交给 service isInt 拒绝（400），不静默忽略
  const rawPos = rawTarget.position;
  const position = rawPos === undefined ? undefined : typeof rawPos === "number" ? rawPos : NaN;
  const rawRange = rawTarget.range;
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
      rawTarget.mode === "insert"
        ? "insert"
        : rawTarget.mode === "replace"
          ? "replace"
          : rawTarget.mode === undefined
            ? "insert"
            : ("INVALID" as InsertTarget["mode"]), // 显式非法 mode → service 拒绝（400）
    ...(position !== undefined ? { position } : {}),
    ...(range !== undefined ? { range } : {}),
    ...(typeof rawTarget.expectedContent === "string" ? { expectedContent: rawTarget.expectedContent } : {}),
  };

  try {
    const result = await insertChapterMessage(
      user.id,
      Number(id),
      chapterId,
      messageId,
      mode,
      editedContent,
      force,
      target,
    );
    // 质量门（工单 03 收尾）：插入成功时把「存在未通过检查项仍确认插入」记录进证据（不静默放行）
    const qualityGate = await recordQualityGateOverride(Number(id), messageId);
    return NextResponse.json({ ...result, message: { inserted: true }, qualityGate });
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
