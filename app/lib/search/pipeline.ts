// 搜索决策：实时正规书源优先，本地榜单索引作为离线回退。
import type { BookMatch } from "./bookIndex";
import type { SearchOutcome, SourceResult } from "@/lib/source/engine";

export type { SourceResult };

export type PipelineSource = "book-index" | "fanqie" | "multi-source";

export interface PipelineDecision {
  source: PipelineSource;
  results: SourceResult[];
  degraded: boolean;
  note?: string;
}

const BOOK_INDEX_LABEL = "书源索引";

function toBookIndexResult(match: BookMatch): SourceResult {
  return {
    source: "book-index",
    sourceLabel: BOOK_INDEX_LABEL,
    name: match.book.name,
    author: match.book.author ?? "",
    site: "novel-ai",
    status: "本地索引",
    capturedAt: new Date().toISOString(),
    url: "",
    bookId: match.book.bookId,
  };
}

/**
 * 决策：实时源有可验证结果时优先展示；实时源无结果时回退本地榜单索引；
 * 两者都没有时返回空结果 + degraded，绝不拿无关榜单或固定样例冒充命中。
 */
export function decide(
  _query: string,
  localHits: BookMatch[],
  sourceOutcome: SearchOutcome | null,
): PipelineDecision {
  if (sourceOutcome && sourceOutcome.results.length > 0) {
    const onlyFanqie = sourceOutcome.results.every((result) => result.source === "fanqie");
    return {
      source: onlyFanqie ? "fanqie" : "multi-source",
      results: sourceOutcome.results,
      degraded: sourceOutcome.degraded,
      ...(sourceOutcome.note ? { note: sourceOutcome.note } : {}),
    };
  }

  if (localHits.length > 0) {
    return {
      source: "book-index",
      results: localHits.map(toBookIndexResult),
      degraded: sourceOutcome?.degraded ?? false,
      ...(sourceOutcome?.note ? { note: sourceOutcome.note } : {}),
    };
  }

  return {
    source: "multi-source",
    results: [],
    degraded: true,
    note: sourceOutcome?.note ?? "正规书源暂不可用，未返回虚构书目；请稍后重试",
  };
}
