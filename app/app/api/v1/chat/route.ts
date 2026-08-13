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
import { LlmConfigurationError } from "@/lib/chat/llm-transport";

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

  // 归属校验在流外完成：他人会话 → 404（不进入 SSE）
  if (sessionId !== undefined && (await listMessages(sessionId, user.id)) === null) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  if (sessionId === undefined && novelId !== null && !(await isNovelOwned(user.id, novelId))) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const targetSession =
          sessionId ??
          (await createSession(user.id, undefined, novelId)).id;
        send({ type: "start", sessionId: targetSession });
        const result = await runChat({
          userId: user.id,
          sessionId: targetSession,
          model,
          content,
          novelId,
          styleId,
          skills,
          onDelta: (text) => send({ type: "delta", text }),
        });
        if (result.state.task?.status === "ok" && result.messageId) {
          send({
            type: "done",
            messageId: result.messageId,
            injected: result.injected,
            compressed: result.compressed,
          });
        } else if (result.state.task?.status === "ok") {
          send({ type: "error", message: "模型返回为空，请重试" });
        } else {
          send({
            type: "error",
            message: result.state.task?.lastError ?? "生成失败",
          });
        }
      } catch (err) {
        send({
          type: "error",
          message:
            err instanceof SessionNotFoundError
              ? "会话不存在"
              : err instanceof LlmConfigurationError
                ? "生成服务暂不可用，请稍后重试"
              : ((err as Error).message ?? "生成失败"),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
