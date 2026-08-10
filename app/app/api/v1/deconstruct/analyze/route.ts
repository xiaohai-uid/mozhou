// POST /api/v1/deconstruct/analyze — 小说拆解：文本 → LLM 分析三段式结构（结构/剧情/节奏）
// 09 工单：复用 07 蒸馏模式（one-api 非流式 + JSON 容错解析 + mock 测试模式）
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { recordUsage } from "@/lib/account/service";

export interface DeconstructResult {
  structure: string[]; // 结构（开场/中段/收束）
  plot: string[]; // 剧情（伏笔/人物/推进）
  rhythm: string[]; // 节奏（句段/缓急/悬念）
}

const MAX_TEXT = 30000;
const MIN_TEXT = 200;

/** 测试用固定结果（DECONSTRUCT_PROVIDER=mock） */
const MOCK_RESULT: DeconstructResult = {
  structure: ["开场：灰罐火苗偏斜", "中段：阿雀醒来对话", "收束：铁灰飞鸟掠过"],
  plot: ["伏笔：火苗朝零界偏斜", "人物：陆沉舟夜间外出", "推进：灯芯与药引"],
  rhythm: ["短句密（对话段）", "缓（景物描写）", "悬（结尾鸟飞向零界）"],
};

const PROMPT = `你是资深小说编辑。拆解以下小说章节文本，输出严格 JSON（不要 markdown 代码块、不要多余文字），格式：
{"structure":["结构要点1","结构要点2","结构要点3"],"plot":["剧情要点1","剧情要点2","剧情要点3"],"rhythm":["节奏要点1","节奏要点2","节奏要点3"]}
每类 2-4 条，每条 20 字内。
文本：
`;

/** 容错解析：剥离 ```json 围栏与前后杂音，校验三数组 */
function parseResult(raw: string): DeconstructResult | null {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Partial<DeconstructResult>;
    const arr = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === "string");
    if (arr(obj.structure) && arr(obj.plot) && arr(obj.rhythm)) {
      return {
        structure: obj.structure,
        plot: obj.plot,
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
    title?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < MIN_TEXT) {
    return NextResponse.json(
      { error: `文本太短，建议整章上传（至少 ${MIN_TEXT} 字）` },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json(
      { error: `文本过长，最多支持 ${MAX_TEXT} 字` },
      { status: 413 },
    );
  }
  const title = typeof body?.title === "string" ? body.title.trim() : "未命名章节";

  // 测试模式：返回固定结果
  if (process.env.DECONSTRUCT_PROVIDER === "mock") {
    return NextResponse.json({ result: MOCK_RESULT, title });
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
          model: process.env.DECONSTRUCT_MODEL ?? "deepseek-v4-flash",
          stream: false,
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: `章节《${title}》\n\n${text.slice(0, MAX_TEXT)}` },
          ],
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `拆解服务暂不可用（${res.status}）` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const result = parseResult(raw);
    if (!result) {
      return NextResponse.json(
        { error: "拆解结果解析失败，请重试" },
        { status: 502 },
      );
    }
    // 用量记账（11 工单）
    await recordUsage(user.id, "小说拆解", data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0).catch(() => {});
    return NextResponse.json({ result, title });
  } catch (err) {
    return NextResponse.json(
      { error: `拆解失败：${(err as Error).message}` },
      { status: 502 },
    );
  }
}
