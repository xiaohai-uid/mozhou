// 番茄小说 Web 搜索（T6）：a_bogus 签名直调官方搜索 API。
// 算法与抖音共用（已验证 2026-08-14）；msToken 取自首页响应头 x-ms-token。
// 注意：本模块依赖 eval/new Function，仅限 Node 运行时（route 需 runtime="nodejs"）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const abogus = require("../abogus.cjs") as { makeABogus: (uri: string, ts?: number) => string };

export interface FanqieSearchBook {
  bookId: string;
  name: string;
  author: string | null;
  category: string | null;
}

export interface FanqieSearchOutcome {
  books: FanqieSearchBook[];
  ok: boolean;
  degraded: boolean;
  note?: string;
}

const SEARCH_URL = "https://fanqienovel.com/api/author/search/search_book/v1";
const HOME_URL = "https://fanqienovel.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

const PUA_RE = /[\uE000-\uF8FF]/;

let cachedMsToken: { value: string; at: number } | null = null;

/** 测试钩子：清空 msToken 缓存 */
export function __resetMsTokenCacheForTests(): void {
  cachedMsToken = null;
}

function cleanName(value: string): string {
  return value.replace(PUA_RE, "");
}

function hasPua(value: string): boolean {
  return PUA_RE.test(value);
}

/** 获取 msToken（首页响应头 x-ms-token），缓存 10 分钟 */
async function getMsToken(): Promise<string> {
  if (cachedMsToken && Date.now() - cachedMsToken.at < 10 * 60 * 1000) {
    return cachedMsToken.value;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HOME_URL, { headers: { "user-agent": UA }, signal: ctrl.signal });
    clearTimeout(timer);
    const token = res.headers.get("x-ms-token");
    if (!token) throw new Error("x-ms-token missing from home response");
    cachedMsToken = { value: token, at: Date.now() };
    return token;
  } finally {
    clearTimeout(timer);
  }
}

/** 详情页解码书名（与榜单 detail-ssr 同机制），失败返回 null */
async function decodeDetailName(bookId: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch("https://fanqienovel.com/page/" + bookId, {
      headers: { "user-agent": UA },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"bookName"\s*:\s*"([^"\\]+)"/);
    const title = m ? m[1] : null;
    if (!title || hasPua(title)) return null;
    return title;
  } catch {
    return null;
  }
}

/** 搜索番茄小说（关键词） */
export async function searchFanqie(query: string): Promise<FanqieSearchOutcome> {
  // 测试确定性：契约测试环境强制降级（外部源可达性不参与断言）
  if (process.env.FANQIE_SEARCH_MOCK === "1") {
    return { books: [], ok: false, degraded: true, note: "番茄搜索 mock 降级（测试环境）" };
  }
  try {
    const msToken = await getMsToken();
    const prefix =
      "filter=127,127,127,127&page_count=10&page_index=0&query_type=1" +
      "&query_word=" + encodeURIComponent(query) +
      "&msToken=" + encodeURIComponent(msToken);
    const aBogus = abogus.makeABogus(prefix, 0);
    const url = SEARCH_URL + "?" + prefix + "&a_bogus=" + encodeURIComponent(aBogus);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "user-agent": UA, referer: "https://fanqienovel.com/" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { books: [], ok: false, degraded: true, note: "番茄搜索上游 " + res.status };
    }
    const text = await res.text();
    if (!text) {
      return { books: [], ok: false, degraded: true, note: "番茄搜索返回空（风控或签名失效）" };
    }
    const json = JSON.parse(text) as {
      code?: number;
      data?: {
        search_book_data_list?: Array<{
          book_id?: string | number;
          book_name?: string;
          author?: string;
          categoryV2?: string;
        }>;
      };
    };
    if (json.code !== 0) {
      return { books: [], ok: false, degraded: true, note: "番茄搜索 code=" + String(json.code) };
    }
    const list = json.data?.search_book_data_list ?? [];
    const rawBooks = list.map((item) => ({
      bookId: String(item.book_id ?? ""),
      name: item.book_name ?? "",
      author: item.author ?? null,
      category: item.categoryV2 ?? null,
    })).filter((b) => b.bookId && b.name);
    // PUA 书名用详情页 detail-ssr 解码（并发，超时兜底）
    const books: FanqieSearchBook[] = await Promise.all(
      rawBooks.map(async (b) => {
        if (!hasPua(b.name)) return { ...b, name: cleanName(b.name) };
        const decoded = await decodeDetailName(b.bookId);
        return { ...b, name: decoded ?? cleanName(b.name) };
      }),
    );
    return { books, ok: true, degraded: false };
  } catch (err) {
    return {
      books: [],
      ok: false,
      degraded: true,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}