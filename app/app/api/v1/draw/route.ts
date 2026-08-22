// POST /api/v1/draw — 抽卡模式：同一指令多模型并行生成候选（10 工单真实化）
// 前端 Promise.all 并发调用本端点（每模型一次）；结果不落库，选中后作为对话消息插入
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { consumeRateLimit, rateLimit429 } from "@/lib/http/rate-limit";
import { assertQuota, recordUsage } from "@/lib/account/service";
import { createUnifiedCompletionProvider } from "@/lib/ai/provider";
import { recordAttemptUsage } from "@/lib/tasks/usage-ledger";

export const DRAW_MODELS = ["glm-4.5-flash", "deepseek-v4-flash"] as const;
export type DrawModel = (typeof DRAW_MODELS)[number];

const MAX_INSTRUCTION = 2000;

/** 测试用固定输出（DRAW_PROVIDER=mock），按模型区分便于断言 */
const MOCK_OUTPUTS: Record<string, string> = {
  "deepseek-v4-flash": "雨夜，灰烬镇的巷口。阿雀裹着单衣站在门檐下，雨水顺着瓦片连成细线。（mock）",
  "glm-4.5-flash": "夜雨敲瓦。阿雀立在门檐下，手里攥着一截没点完的灯芯。（mock）",
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 工单 C：AI 昂贵端点按用户限流（10/分钟）
  const rl = consumeRateLimit(`ai:${user.id}:draw`, 10, 60_000);
  if (!rl.ok) return rateLimit429(rl.retryAfterSec);

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

  // 额度 gating（11 工单）：free 用户抽卡超 20 次/月 → 402
  const quotaBlock = await assertQuota(user.id, "draw");
  if (quotaBlock) {
    return NextResponse.json({ error: quotaBlock.error }, { status: quotaBlock.status });
  }

  const provider = createUnifiedCompletionProvider({
    route: "draw",
    model,
    mockResult: { text: MOCK_OUTPUTS[model] ?? "" },
  });
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
  const recordLedger = (status: "succeeded" | "failed", promptTokens?: number, completionTokens?: number) =>
    recordAttemptUsage({
      userId: user.id,
      requestId,
      taskId: null,
      generationId: requestId,
      attemptId: null,
      sourceClass: provider.boundary.sourceClass,
      provider: provider.boundary.provider,
      model: provider.boundary.model,
      credentialOwner: provider.boundary.credentialOwner,
      billingOwner: provider.boundary.billingOwner,
      route: "draw",
      status,
      promptTokens,
      completionTokens,
    }).catch(() => {});

  // 测试模式：返回固定输出（同样记账，保证配额逻辑可测）
  if (provider.boundary.sourceClass === "TEST_MOCK") {
    await recordLedger("succeeded", 10, 5);
    await recordUsage(user.id, "抽卡模式", 10, 5).catch(() => {});
    return NextResponse.json({ text: MOCK_OUTPUTS[model] ?? "" });
  }

  try {
    const data = await provider.complete({
      model,
      system: "你是小说创作助手。严格按用户指令写一段小说正文（不要解释、不要标题、不要多余文字）。",
      messages: [{ role: "user", content: instruction }],
    });
    const text = data.text.trim();
    if (!text) {
      await recordLedger("failed", data.usage?.promptTokens, data.usage?.completionTokens);
      return NextResponse.json(
        { error: `模型 ${model} 返回为空` },
        { status: 502 },
      );
    }
    await recordLedger("succeeded", data.usage?.promptTokens, data.usage?.completionTokens);
    // 用量记账（11 工单）：抽卡节点 +1 次
    await recordUsage(user.id, "抽卡模式", data.usage?.promptTokens ?? 0, data.usage?.completionTokens ?? 0).catch(() => {});
    return NextResponse.json({ text });
  } catch (err) {
    await recordLedger("failed");
    return NextResponse.json(
      { error: `模型 ${model} 生成失败：${(err as Error).message}` },
      { status: 502 },
    );
  }
}
