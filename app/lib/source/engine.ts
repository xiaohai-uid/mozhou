// 多源书名搜索：四个平台分别请求、分别解析，部分源失败不影响其他源。
// 这里只返回作品元数据和官方作品页，不抓取章节正文；外部源不可验证时明确 degraded。
import { searchFanqie } from "@/lib/search/fanqie";
import { searchJjwxc } from "@/lib/search/jjwxc";
import { searchQidian } from "@/lib/search/qidian";
import { searchQimao } from "@/lib/search/qimao";
import { filterPua } from "./quality";

export interface SourceResult {
  source: string;
  sourceLabel: string;
  name: string;
  author: string;
  site: string;
  status: string;
  capturedAt: string;
  url: string;
  bookId: string;
}

export interface SearchOutcome {
  results: SourceResult[];
  degraded: boolean;
  note?: string;
}

function capturedAt(): string {
  return new Date().toISOString();
}

const TEST_RESULTS: SourceResult[] = [
  {
    source: "fanqie",
    sourceLabel: "番茄小说",
    name: "灰烬有籽",
    author: "佚名",
    site: "fanqienovel.com",
    status: "测试数据",
    capturedAt: "1970-01-01T00:00:00.000Z",
    url: "https://fanqienovel.com/page/test-book",
    bookId: "test-book",
  },
];

function mapResult(input: {
  source: string;
  sourceLabel: string;
  site: string;
  bookId: string;
  name: string;
  author: string | null;
  status: string | null;
  url: string;
}, at: string): SourceResult {
  return {
    source: input.source,
    sourceLabel: input.sourceLabel,
    name: input.name,
    author: input.author ?? "未知作者",
    site: input.site,
    status: input.status ?? "未知状态",
    capturedAt: at,
    url: input.url,
    bookId: input.bookId,
  };
}

/** 真实检索：四个正规平台并发搜索，保留成功源，返回部分失败状态。 */
export async function searchSources(query: string): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) return { results: [], degraded: false };

  // 测试模式：只允许确定性测试数据，不让单测依赖外部站点。
  if (process.env.SOURCE_PROVIDER === "mock") {
    return { results: TEST_RESULTS, degraded: true, note: "书源检索服务降级（测试数据）" };
  }

  const [qidian, fanqie, qimao, jjwxc] = await Promise.all([
    searchQidian(q),
    searchFanqie(q),
    searchQimao(q),
    searchJjwxc(q),
  ]);

  const at = capturedAt();
  const results = filterPua([
    ...qidian.books.map((book) => mapResult({
      source: "qidian",
      sourceLabel: "起点中文网",
      site: "qidian.com",
      bookId: book.bookId,
      name: book.name,
      author: book.author,
      status: book.status,
      url: book.url,
    }, at)),
    ...fanqie.books.map((book) => mapResult({
      source: "fanqie",
      sourceLabel: "番茄小说",
      site: "fanqienovel.com",
      bookId: book.bookId,
      name: book.name,
      author: book.author,
      status: "实时搜索",
      url: `https://fanqienovel.com/page/${book.bookId}`,
    }, at)),
    ...qimao.books.map((book) => mapResult({
      source: "qimao",
      sourceLabel: "七猫小说",
      site: "qimao.com",
      bookId: book.bookId,
      name: book.name,
      author: book.author,
      status: book.status,
      url: book.url,
    }, at)),
    ...jjwxc.books.map((book) => mapResult({
      source: "jjwxc",
      sourceLabel: "晋江文学城",
      site: "jjwxc.net",
      bookId: book.bookId,
      name: book.name,
      author: book.author,
      status: book.status,
      url: book.url,
    }, at)),
  ]);

  const degraded = [qidian, fanqie, qimao, jjwxc].some((outcome) => outcome.degraded);
  if (results.length > 0) {
    return {
      results,
      degraded,
      ...(degraded ? { note: "部分正规书源暂时不可用，已保留可验证结果" } : {}),
    };
  }
  return {
    results: [],
    degraded: true,
    note: degraded ? "正规书源暂时不可用，未返回虚构书目" : "未找到匹配的正规书源结果",
  };
}
