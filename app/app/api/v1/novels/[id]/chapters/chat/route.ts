// POST /api/v1/novels/[id]/chapters/chat?chapterId=X — 章节对话（SSE 流式，工单 17）
// 技能驱动：body 带 skills[]（内置场景技能 + 我的技能）+ styleId；注入链见 chapter-chat.ts。
// 停止：客户端断开 SSE（request.signal abort）→ AI 消息标记 stopped（保留已生成部分）。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { consumeRateLimit, rateLimit429 } from "@/lib/http/rate-limit";
import { DEFAULT_MODEL, isChatModel } from "@/lib/chat/models";
import { resolveOwnedChapter } from "@/lib/novels/ownership";
import {
  ChapterChatError,
  GenerationKeyConflictError,
  ChapterNotFoundError,
  runChapterChat,
} from "@/lib/novels/chapter-chat";
import { createSseResponse, safeSseErrorMessage } from "@/lib/http/sse";
import { ProviderBoundaryError } from "@/lib/ai/provider-boundary";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 工单 C：AI 昂贵端点按用户限流（30/分钟）
  const rl = consumeRateLimit(`ai:${user.id}:chapter-chat`, 30, 60_000);
  if (!rl.ok) return rateLimit429(rl.retryAfterSec);
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
    generationKey?: unknown;
    retryOfGenerationKey?: unknown;
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
  const generationKey =
    body.generationKey === undefined
      ? undefined
      : typeof body.generationKey === "string" && body.generationKey.trim().length <= 120
        ? body.generationKey.trim()
        : null;
  if (generationKey === null) {
    return NextResponse.json({ error: "生成请求键无效" }, { status: 400 });
  }
  const retryOfGenerationKey =
    body.retryOfGenerationKey === undefined
      ? undefined
      : typeof body.retryOfGenerationKey === "string" && body.retryOfGenerationKey.trim().length <= 120
        ? body.retryOfGenerationKey.trim()
        : null;
  if (retryOfGenerationKey === null) {
    return NextResponse.json({ error: "重试请求键无效" }, { status: 400 });
  }

  // J9：选区绑定（改写/润色等）。校验：整数、0<=start<=end、text 与正文区间一致（防伪造注入）
  const sel = body.selection as
    | { start?: unknown; end?: unknown; text?: unknown }
    | undefined;
  let selection: { start: number; end: number; text: string } | undefined;
  if (sel !== undefined) {
    const chapter = await resolveOwnedChapter({ userId: user.id, novelId: Number(id), chapterId });
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
  if (!(await resolveOwnedChapter({ userId: user.id, novelId, chapterId }))) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }

  return createSseResponse(async (writer, signal) => {
      try {
        writer.start({ type: "start", phase: "preparing" });
        const result = await runChapterChat({
          userId: user.id,
          novelId,
          chapterId,
          content,
          model,
          styleId,
          skills,
          generationKey,
          retryOfGenerationKey,
          selection,
          signal,
          onPhase: (phase) => writer.phase({ type: "phase", phase }),
          onDelta: (text) => writer.delta({ type: "delta", text }),
        });
        if (result.status === "generating") {
          writer.error({ type: "error", code: "GenerationInProgress", message: "这条生成仍在进行，请稍后刷新" });
        } else if (result.stopped) {
          writer.error({ type: "error", code: "AiCancelled", message: "已停止生成" });
        } else if (result.reply && ["completed_candidate", "applied"].includes(result.status)) {
          writer.done({
            type: "done",
            messageId: result.messageId,
            // V1.3 工单 01：本次创作链路证据（SkillRun 脱敏视图）
            skillRuns: result.skillRuns,
            generationId: result.generationId,
          });
        } else if (result.status === "error") {
          writer.error({
            type: "error",
            code: result.errorCode ?? "AiGenerationFailed",
            message: result.errorCode === "FREE_UNAVAILABLE"
              ? "当前免费 AI 暂时不可用，你仍可以自己继续写作。"
              : "生成失败，请重试",
          });
        } else {
          writer.error({ type: "error", code: "AiInvalidResponse", message: "模型返回为空，请重试" });
        }
      } catch (err) {
        writer.error({
          type: "error",
          code:
            err instanceof ChapterNotFoundError
              ? "ChapterNotFound"
              : err instanceof GenerationKeyConflictError
                ? "GenerationKeyConflict"
                : err instanceof ChapterChatError
                  ? err.code
                  : err instanceof ProviderBoundaryError && err.code === "FREE_UNAVAILABLE"
                    ? "FREE_UNAVAILABLE"
                : "AiGenerationFailed",
          message:
            err instanceof ChapterNotFoundError
              ? "章节不存在"
              : err instanceof GenerationKeyConflictError
                ? "生成请求键与原请求不一致"
                : err instanceof ChapterChatError && err.code === "FREE_UNAVAILABLE"
                  ? "当前免费 AI 暂时不可用，你仍可以自己继续写作。"
                  : err instanceof ProviderBoundaryError && err.code === "FREE_UNAVAILABLE"
                    ? "当前免费 AI 暂时不可用，你仍可以自己继续写作。"
                : safeSseErrorMessage(err),
        });
      }
  }, request.signal);
}
