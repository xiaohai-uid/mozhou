// POST /api/v1/novels/[id]/chapters/chat?chapterId=X — 章节对话（SSE 流式，工单 17）
// 技能驱动：body 带 skills[]（内置场景技能 + 我的技能）+ styleId；注入链见 chapter-chat.ts。
// 停止：客户端断开 SSE（request.signal abort）→ AI 消息标记 stopped（保留已生成部分）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_MODEL, isChatModel } from "@/lib/chat/models";
import { getChapter } from "@/lib/novels/service";
import { LlmConfigurationError } from "@/lib/chat/llm-transport";
import { createSseStream } from "@/lib/http/sse";
import {
  ChapterNotFoundError,
  runChapterChat,
} from "@/lib/novels/chapter-chat";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  const url = new URL(request.url);
  const chapterId = Number(url.searchParams.get("chapterId"));
  if (!chapterId) {
    return NextResponse.json({ error: "缺少 chapterId" }, { status: 400 });
  }

  let body: {
    content?: unknown;
    model?: unknown;
    styleId?: unknown;
    skills?: unknown;
    selection?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }
  if (content.length > 4000) {
    return NextResponse.json({ error: "消息过长（上限 4000 字）" }, { status: 400 });
  }
  const model =
    typeof body.model === "string" && isChatModel(body.model)
      ? body.model
      : DEFAULT_MODEL;
  const styleId =
    typeof body.styleId === "number" && Number.isInteger(body.styleId)
      ? body.styleId
      : null;
  const skills =
    Array.isArray(body.skills) &&
    body.skills.every((s) => typeof s === "string" && s.trim())
      ? (body.skills as string[]).map((s) => s.trim())
      : [];

  // J9：选区绑定（改写/润色等）。校验：整数、0<=start<=end、text 与正文区间一致（防伪造注入）
  const sel = body.selection as
    | { start?: unknown; end?: unknown; text?: unknown }
    | undefined;
  let selection: { start: number; end: number; text: string } | undefined;
  if (sel !== undefined) {
    const chapter = await getChapter(user.id, Number(id), chapterId);
    if (!chapter) return NextResponse.json({ error: "章节不存在" }, { status: 404 });
    const s = sel.start;
    const e = sel.end;
    const t = sel.text;
    if (
      typeof s !== "number" ||
      !Number.isInteger(s) ||
      typeof e !== "number" ||
      !Number.isInteger(e) ||
      s < 0 ||
      e < s ||
      e > chapter.content.length ||
      typeof t !== "string" ||
      !t.trim() ||
      chapter.content.slice(s, e) !== t
    ) {
      return NextResponse.json({ error: "选区无效" }, { status: 400 });
    }
    selection = { start: s, end: e, text: t };
  }

  // 归属预校验（不进 SSE）：章节不存在/他人章节 → 404
  const novelId = Number(id);
  if (!(await getChapter(user.id, novelId, chapterId))) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }

  const stream = createSseStream(request, async ({ send }) => {
    try {
        send({ type: "start" });
        const result = await runChapterChat({
          userId: user.id,
          novelId,
          chapterId,
          content,
          model,
          styleId,
          skills,
          selection,
          signal: request.signal,
          onDelta: (text) => {
            if (!send({ type: "delta", text })) {
              throw new Error("SSE client disconnected");
            }
          },
        });
        if (result.stopped) {
          send({ type: "error", code: "AiCancelled", message: "已停止生成" });
        } else if (result.reply) {
          send({ type: "done", messageId: result.messageId });
        } else {
          send({ type: "error", code: "AiInvalidResponse", message: "模型返回为空，请重试" });
        }
      } catch (err) {
        send({
          type: "error",
          code:
            err instanceof ChapterNotFoundError
              ? "ChapterNotFound"
              : "AiGenerationFailed",
          message: err instanceof LlmConfigurationError
            ? "生成服务暂不可用，请稍后重试"
            : (err as Error).message ?? "生成失败",
        });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
