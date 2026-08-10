// POST /api/v1/draw — 抽卡模式：同一指令多模型并行生成候选（10 工单真实化）
// 前端 Promise.all 并发调用本端点（每模型一次）；结果不落库，选中后作为对话消息插入
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export const DRAW_MODELS = ["deepseek-v4-flash", "glm-4.5-flash"] as const;
export type DrawModel = (typeof DRAW_MODELS)[number];

const MAX_INSTRUCTION = 2000;

/** 测试用固定输出（DRAW_PROVIDER=mock），按模型区分便于断言 */
const MOCK_OUTPUTS: Record<string, string> = {
  "deepseek-v4-flash": "雨夜，灰烬镇的巷口。阿雀裹着单衣站在门檐下，雨水顺着瓦片连成细线。（mock）",
  "glm-4.5-flash": "夜雨敲瓦。阿雀立在门檐下，手里攥着一截没点完的灯芯。（mock）",
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    model?: unknown;
    instruction?: unknown;
  } | null;
  const model = body?.model as DrawModel | undefined;
  if (!model || !(DRAW_MODELS as readonly string[]).includes(model)) {
    return NextResponse.json(
      { error: `model 必须是 ${DRAW_MODELS.join(" / ")}` },
      { status: 400 },
    );
  }
  const instruction =
    typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    return NextResponse.json({ error: "写作指令不能为空" }, { status: 400 });
  }
  if (instruction.length > MAX_INSTRUCTION) {
    return NextResponse.json(
      { error: `写作指令过长（上限 ${MAX_INSTRUCTION} 字）` },
      { status: 400 },
    );
  }

  // 测试模式：返回固定输出
  if (process.env.DRAW_PROVIDER === "mock") {
    return NextResponse.json({ text: MOCK_OUTPUTS[model] ?? "" });
  }

  try {
    const res = await fetch(
      `${process.env.ONEAPI_BASE_URL ?? "http://localhost:3001"}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.ONEAPI_TOKEN ?? ""}`,
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "你是小说创作助手。严格按用户指令写一段小说正文（不要解释、不要标题、不要多余文字）。",
            },
            { role: "user", content: instruction },
          ],
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `模型 ${model} 调用失败（${res.status}）` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return NextResponse.json(
        { error: `模型 ${model} 返回为空` },
        { status: 502 },
      );
    }
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: `模型 ${model} 生成失败：${(err as Error).message}` },
      { status: 502 },
    );
  }
}
