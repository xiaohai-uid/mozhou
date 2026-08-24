// POST /api/v1/distill — 风格蒸馏：上传文本 → LLM 分析生成四维风格指南（07 工单）
// Provider 只从统一 source-class boundary 进入；测试注入 DISTILL_PROVIDER=mock 返回固定指南。
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { enforceAiLimit } from "@/lib/http/rate-limit";
import { recordUsage } from "@/lib/account/service";
import type { StyleGuide } from "@/lib/schema";
import { createUnifiedCompletionProvider } from "@/lib/ai/provider";
import { recordAttemptUsage } from "@/lib/tasks/usage-ledger";

const MAX_TEXT = 20000;
const MIN_TEXT = 200;

/** 测试用固定指南（DISTILL_PROVIDER=mock） */
const MOCK_GUIDE: StyleGuide = {
  narrative: "第三人称限知视角，紧贴主角感官，场景以触觉与气味开场",
  sentence: "短句为主，动作前置，句中少用连接词，偶用顶针衔接",
  imagery: "偏好农耕/土地/器物意象，拟人化土地，数字具象化",
  rhythm: "段落短促如开垦节奏，冲突段落句长骤增，收束处留白",
};

const PROMPT = `你是资深编辑。分析以下小说文本的写作风格，输出严格 JSON（不要 markdown 代码块、不要多余文字），格式：
{"narrative":"叙事视角（100字内）","sentence":"句式节奏（100字内）","imagery":"意象偏好（100字内）","rhythm":"情绪节奏（100字内）"}
文本：
`;

/** 容错解析：剥离 ```json 围栏与前后杂音 */
function parseGuide(raw: string): StyleGuide | null {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<StyleGuide>;
    if (
      typeof obj.narrative === "string" &&
      typeof obj.sentence === "string" &&
      typeof obj.imagery === "string" &&
      typeof obj.rhythm === "string"
    ) {
      return {
        narrative: obj.narrative,
        sentence: obj.sentence,
        imagery: obj.imagery,
        rhythm: obj.rhythm,
      };
    }
  } catch {
    // fallthrough
  }
  return null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 工单 C：AI 昂贵端点按用户限流（阈值 RATE_LIMIT_AI_PER_MIN，默认 30/分钟）
  const limited = enforceAiLimit(user.id, "distill");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < MIN_TEXT) {
    return NextResponse.json(
      { error: `文本太短，建议 1 万字以上效果更好（至少 ${MIN_TEXT} 字）` },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json(
      { error: `文本过长，最多支持 ${MAX_TEXT} 字` },
      { status: 413 },
    );
  }

  const model = process.env.DISTILL_MODEL ?? "glm-4.5-flash";
  const provider = createUnifiedCompletionProvider({
    route: "distill",
    model,
    mockResult: { text: JSON.stringify(MOCK_GUIDE) },
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
      route: "distill",
      status,
      promptTokens,
      completionTokens,
    }).catch(() => {});

  // 测试模式：返回固定指南；boundary 已在此处完成生产防火墙校验。
  if (provider.boundary.sourceClass === "TEST_MOCK") {
    await recordLedger("succeeded");
    return NextResponse.json({ guide: MOCK_GUIDE });
  }

  try {
    const data = await provider.complete({
      model,
      system: PROMPT,
      messages: [{ role: "user", content: text.slice(0, MAX_TEXT) }],
    });
    const raw = data.text;
    const guide = parseGuide(raw);
    if (!guide) {
      await recordLedger("failed", data.usage?.promptTokens, data.usage?.completionTokens);
      return NextResponse.json(
        { error: "风格分析结果解析失败，请重试" },
        { status: 502 },
      );
    }
    await recordLedger("succeeded", data.usage?.promptTokens, data.usage?.completionTokens);
    // 用量记账（11 工单）
    await recordUsage(user.id, "风格蒸馏", data.usage?.promptTokens ?? 0, data.usage?.completionTokens ?? 0).catch(() => {});
    return NextResponse.json({ guide });
  } catch (err) {
    await recordLedger("failed");
    return NextResponse.json(
      { error: `风格分析失败：${(err as Error).message}` },
      { status: 502 },
    );
  }
}
