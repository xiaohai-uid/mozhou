// 两级搜索决策（T5+T6 接线）：本地书目索引优先，未命中才走番茄实时搜索。
// 纯函数；输入本地命中与番茄结果，输出最终响应结构（含 SourceResult 兼容映射）。
import type { BookMatch } from "./bookIndex";
import type { FanqieSearchOutcome } from "./fanqie";

/** 兼容现有前端 SourceResult 字段（source/sourceLabel/name/author/site/status）+ bookId。 */
export interface SourceResult {
  source: string;
  sourceLabel: string;
  name: string;
  author: string;
  site: string;
  status: string;
  bookId: string;
}

export type PipelineSource = "book-index" | "fanqie";

export interface PipelineDecision {
  source: PipelineSource;
  results: SourceResult[];
  degraded: boolean;
  note?: string;
}

const BOOK_INDEX_LABEL = "书源索引";
const FANQIE_LABEL = "番茄小说";

function toBookIndexResult(match: BookMatch): SourceResult {
  return {
    source: "book-index",
    sourceLabel: BOOK_INDEX_LABEL,
    name: match.book.name,
    author: match.book.author ?? "",
    site: "novel-ai",
    status: "本地索引",
    bookId: match.book.bookId,
  };
}

function toFanqieResult(book: { bookId: string; name: string; author: string | null }): SourceResult {
  return {
    source: "fanqie",
    sourceLabel: FANQIE_LABEL,
    name: book.name,
    author: book.author ?? "",
    site: "fanqienovel.com",
    status: "实时搜索",
    bookId: book.bookId,
  };
}

/**
 * 决策：本地有命中 → book-index；否则番茄成功且非降级 → fanqie；
 * 否则返回空结果 + degraded + note。
 */
export function decide(
  _query: string,
  localHits: BookMatch[],
  fanqieOutcome: FanqieSearchOutcome | null,
): PipelineDecision {
  if (localHits.length > 0) {
    return {
      source: "book-index",
      results: localHits.map(toBookIndexResult),
      degraded: false,
    };
  }
  if (fanqieOutcome && !fanqieOutcome.degraded && fanqieOutcome.books.length > 0) {
    return {
      source: "fanqie",
      results: fanqieOutcome.books.map(toFanqieResult),
      degraded: false,
    };
  }
  return {
    source: "fanqie",
    results: [],
    degraded: true,
    note: fanqieOutcome?.note ?? "本地书目未命中，番茄源暂不可用；请稍后重试",
  };
}
