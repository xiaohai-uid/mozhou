// POST /api/v1/chat — SSE 流式写作对话（经管线引擎记账）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  createSession,
  isNovelOwned,
  listMessages,
  runChat,
  SessionNotFoundError,
} from "@/lib/chat/service";
import { DEFAULT_MODEL, isChatModel } from "@/lib/chat/models";
import { createSseResponse, safeSseErrorMessage } from "@/lib/http/sse";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: {
    sessionId?: unknown;
    model?: unknown;
    content?: unknown;
    novelId?: unknown;
    styleId?: unknown;
    skills?: unknown;
    marketRef?: unknown;
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
  const sessionId =
    typeof body.sessionId === "number" ? body.sessionId : undefined;
  const novelId =
    typeof body.novelId === "number" && Number.isInteger(body.novelId)
      ? body.novelId
      : null;
  const styleId =
    typeof body.styleId === "number" && Number.isInteger(body.styleId)
      ? body.styleId
      : null;
  const skills =
    Array.isArray(body.skills) &&
    body.skills.every((s) => typeof s === "string" && s.trim())
      ? (body.skills as string[]).map((s) => s.trim())
      : [];
  const marketRef = body.marketRef === true;

  // 归属校验在流外完成：他人会话 → 404（不进入 SSE）
  if (sessionId !== undefined && (await listMessages(sessionId, user.id)) === null) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  if (sessionId === undefined && novelId !== null && !(await isNovelOwned(user.id, novelId))) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }

  return createSseResponse(async (writer) => {
      try {
        const targetSession =
          sessionId ??
          (await createSession(user.id, undefined, novelId)).id;
        writer.start({ type: "start", sessionId: targetSession });
        const result = await runChat({
          userId: user.id,
          sessionId: targetSession,
          model,
          content,
          novelId,
          styleId,
          skills,
          marketRef,
          onDelta: (text) => writer.delta({ type: "delta", text }),
        });
        if (result.state.task?.status === "ok" && result.messageId) {
          writer.done({
            type: "done",
            messageId: result.messageId,
            injected: result.injected,
            compressed: result.compressed,
            // V1.3 工单 01：本次创作链路证据（SkillRun 脱敏视图）
            skillRuns: result.skillRuns,
            generationId: result.generationId,
          });
        } else if (result.state.task?.status === "ok") {
          writer.error({ type: "error", message: "模型返回为空，请重试" });
        } else {
          writer.error({
            type: "error",
            message: safeSseErrorMessage(result.state.task?.lastError),
          });
        }
      } catch (err) {
        writer.error({
          type: "error",
          message:
            err instanceof SessionNotFoundError
              ? "会话不存在"
              : safeSseErrorMessage(err),
        });
      }
  }, request.signal);
}
