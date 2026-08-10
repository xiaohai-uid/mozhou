// POST /api/v1/distill — 风格蒸馏：上传文本 → LLM 分析生成四维风格指南（07 工单）
// 免费模型走 one-api 网关；测试注入 DISTILL_PROVIDER=mock 返回固定指南（与 CHAT_PROVIDER 模式一致）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { recordUsage } from "@/lib/account/service";
import type { StyleGuide } from "@/lib/schema";

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
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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

  // 测试模式：返回固定指南
  if (process.env.DISTILL_PROVIDER === "mock") {
    return NextResponse.json({ guide: MOCK_GUIDE });
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
          model: process.env.DISTILL_MODEL ?? "deepseek-v4-flash",
          stream: false,
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: text.slice(0, MAX_TEXT) },
          ],
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `风格分析服务暂不可用（${res.status}）` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const guide = parseGuide(raw);
    if (!guide) {
      return NextResponse.json(
        { error: "风格分析结果解析失败，请重试" },
        { status: 502 },
      );
    }
    // 用量记账（11 工单）
    await recordUsage(user.id, "风格蒸馏", data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0).catch(() => {});
    return NextResponse.json({ guide });
  } catch (err) {
    return NextResponse.json(
      { error: `风格分析失败：${(err as Error).message}` },
      { status: 502 },
    );
  }
}
