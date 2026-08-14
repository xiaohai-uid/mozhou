// crawl4ai 客户端（T7）：本地/生产无头浏览器抓取通道，作为榜单/搜索的兜底。
// 本地开发默认 http://127.0.0.1:11235（CRAWL4AI_BASE_URL 覆盖，生产指向 Cloud Run 服务）。

const BASE_URL = process.env.CRAWL4AI_BASE_URL ?? "http://127.0.0.1:11235";
const TOKEN = process.env.CRAWL4AI_TOKEN ?? "local-dev-token";

export interface Crawl4aiResult {
  url: string;
  markdown: string;
  html: string;
}

export interface Crawl4aiOutcome {
  results: Crawl4aiResult[];
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 90_000;

/**
 * 抓取单个 URL（JS 渲染），可选 wait_for 等待条件。
 * waitFor 支持：CSS 选择器字符串，或 { type: "js", query: "return ..." }。
 */
export async function crawlUrl(
  url: string,
  waitFor?: string | { type: "css" | "js"; query: string; timeout?: number },
): Promise<Crawl4aiOutcome> {
  const body: Record<string, unknown> = { urls: [url], priority: 10 };
  if (waitFor !== undefined) {
    body.wait_for = typeof waitFor === "string"
      ? { query: waitFor, type: "css", timeout: 20_000 }
      : { query: waitFor.query, type: waitFor.type, timeout: waitFor.timeout ?? 20_000 };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(BASE_URL + "/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { results: [], ok: false, error: "crawl4ai HTTP " + res.status };
    const data = (await res.json()) as {
      success?: boolean;
      results?: Array<{ url?: string; markdown?: unknown; html?: string }>;
    };
    if (!data.success) return { results: [], ok: false, error: "crawl4ai success=false" };
    const results = (data.results ?? []).map((r) => {
      const md = r.markdown as { fit_markdown?: string; raw_markdown?: string } | string | null;
      const markdown = typeof md === "string" ? md : (md?.fit_markdown ?? md?.raw_markdown ?? "");
      return { url: r.url ?? url, markdown, html: r.html ?? "" };
    });
    return { results, ok: true };
  } catch (err) {
    return { results: [], ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
