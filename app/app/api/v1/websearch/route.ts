// POST /api/v1/websearch — 联网搜索（任务二-C）：真实检索 + 超时优雅降级（绝不抛异常）
// 5s 超时；失败返回 degraded 标记和空结果，不把固定样例冒充为联网检索结果。
import { NextResponse } from "next/server";
import { isBatchRelevant } from "@/lib/websearch/quality";
import { getCurrentUser } from "@/lib/auth/current-user";
import { enforceAiLimit } from "@/lib/http/rate-limit";

export interface WebResult {
  title: string;
  source: string;
  snippet: string;
  url: string;
}

const TIMEOUT_MS = 5000;
const MAX_QUERY = 100;

/** 测试模式：确定性降级数据 */
const MOCK_RESULTS: WebResult[] = [
  { title: "「灰烬」在丧葬民俗中的含义", source: "民俗百科", snippet: "骨灰罐中留存火种，象征家族延续，多出现在南方宗族葬俗记载中…", url: "https://example.com/folk/ash" },
  { title: "灯芯草：生长环境与取火用途", source: "植物志", snippet: "灯芯草髓部可制灯芯，湿时柔韧，干后易燃，是旧时民间照明的主要材料…", url: "https://example.com/botany/rush" },
];

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 工单 C：AI 昂贵端点按用户限流（阈值 RATE_LIMIT_AI_PER_MIN，默认 30/分钟）
  const limited = enforceAiLimit(user.id, "websearch");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    query?: unknown;
  } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "搜索关键词不能为空" }, { status: 400 });
  }
  if (query.length > MAX_QUERY) {
    return NextResponse.json({ error: `搜索词过长（上限 ${MAX_QUERY} 字）` }, { status: 400 });
  }

  // 测试模式
  if (process.env.WEBSEARCH_PROVIDER === "mock") {
    return NextResponse.json({ results: MOCK_RESULTS, degraded: true, note: "联网检索服务降级（mock 数据）" });
  }

  try {
    // 真实检索：走公开搜索端点（Bing 无 key 的 html 查询，超时受控）
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0" } },
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`上游 ${res.status}`);

    // 简化解析：提取标题与摘要片段（真实解析器归后续切片）
    const html = await res.text();
    const titles = [...html.matchAll(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([^<]{5,80})<\/a>/g)]
      .slice(0, 6)
      .map((m) => ({ url: m[1], title: m[2].replace(/<[^>]+>/g, "").trim() }));
    if (titles.length === 0) {
      return NextResponse.json({
        results: [],
        degraded: true,
        note: "检索结果解析失败，未返回虚构结果，请稍后重试",
      });
    }
    // 结果质量门：反爬/无关页（非 CJK、与 query 零重叠）视为上游异常 → 降级，不返回无关内容
    if (!isBatchRelevant(titles.map((t) => ({ title: t.title, snippet: "" })), query)) {
      return NextResponse.json({
        results: [],
        degraded: true,
        note: "检索结果质量异常（疑似反爬页），未返回无关内容，请稍后重试",
      });
    }
    return NextResponse.json({
      results: titles.map((t) => ({
        title: t.title,
        source: "联网检索",
        snippet: `来自 ${t.url.split("/")[2] ?? "网络"} 的检索结果…`,
        url: t.url,
      })),
      degraded: false,
    });
  } catch (err) {
    // 超时/网络失败 → 优雅降级（绝不抛异常，不返回虚构结果）
    return NextResponse.json({
      results: [],
      degraded: true,
      note: `联网检索暂时不可用（${(err as Error).message}），未返回虚构结果`,
    });
  }
}
