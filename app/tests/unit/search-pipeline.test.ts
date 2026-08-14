import { describe, it, expect } from "vitest";
import { decide, type SourceResult } from "@/lib/search/pipeline";
import type { BookMatch } from "@/lib/search/bookIndex";
import type { FanqieSearchOutcome } from "@/lib/search/fanqie";

const localHit: BookMatch = {
  book: { bookId: "b1", name: "惹金枝", author: "佚名", category: "古风" },
  score: 3,
};

const fanqieOk: FanqieSearchOutcome = {
  ok: true,
  degraded: false,
  books: [
    { bookId: "f1", name: "凡人修仙传", author: "忘语", category: "仙侠" },
  ],
};

const fanqieDegraded: FanqieSearchOutcome = {
  ok: false,
  degraded: true,
  books: [],
  note: "番茄搜索上游 429",
};

describe("T5+T6 两级搜索决策", () => {
  it("本地命中 → book-index，degraded=false，不进番茄", () => {
    const d = decide("惹金枝", [localHit], null);
    expect(d.source).toBe("book-index");
    expect(d.degraded).toBe(false);
    expect(d.results).toHaveLength(1);
    expect(d.results[0]).toMatchObject({
      source: "book-index",
      sourceLabel: "书源索引",
      name: "惹金枝",
      author: "佚名",
      site: "novel-ai",
      status: "本地索引",
      bookId: "b1",
    });
  });

  it("本地未命中 + 番茄成功 → fanqie 映射兼容 SourceResult 字段", () => {
    const d = decide("凡人修仙", [], fanqieOk);
    expect(d.source).toBe("fanqie");
    expect(d.degraded).toBe(false);
    expect(d.results).toHaveLength(1);
    expect(d.results[0]).toMatchObject({
      source: "fanqie",
      sourceLabel: "番茄小说",
      name: "凡人修仙传",
      author: "忘语",
      site: "fanqienovel.com",
      status: "实时搜索",
      bookId: "f1",
    } satisfies SourceResult);
  });

  it("本地未命中 + 番茄降级 → empty results + degraded + note", () => {
    const d = decide("不存在", [], fanqieDegraded);
    expect(d.source).toBe("fanqie");
    expect(d.degraded).toBe(true);
    expect(d.results).toEqual([]);
    expect(d.note).toBe("番茄搜索上游 429");
  });

  it("本地未命中 + 番茄空结果(无降级) → treated as no-hit degraded", () => {
    const emptyOk: FanqieSearchOutcome = { ok: true, degraded: false, books: [] };
    const d = decide("xyz", [], emptyOk);
    expect(d.degraded).toBe(true);
    expect(d.results).toEqual([]);
  });

  it("无番茄结果且无 note → 兜底 note", () => {
    const d = decide("找不到", [], null);
    expect(d.degraded).toBe(true);
    expect(d.note).toContain("番茄源暂不可用");
  });
});