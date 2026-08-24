import { describe, it, expect } from "vitest";
import { buildMarketSummary, renderMarketSummary, type SnapshotRow } from "@/lib/market/summary";

function row(bookId: string, name: string, category: string | null, rank: number, day: string): SnapshotRow {
  return { bookId, name, author: null, category, rank, capturedAt: day + "T12:00:00.000Z" };
}

const rows: SnapshotRow[] = [
  row("a", "惹金枝", "古风世情", 1, "2026-08-13"),
  row("b", "笨蛋美人", "古风世情", 2, "2026-08-13"),
  row("c", "掌上娇娇", "古风世情", 3, "2026-08-13"),
  row("d", "剑宗小魔童", "玄幻言情", 4, "2026-08-13"),
  row("b", "笨蛋美人", "古风世情", 1, "2026-08-14"), // up
  row("c", "掌上娇娇", "古风世情", 2, "2026-08-14"), // up
  row("a", "惹金枝", "古风世情", 3, "2026-08-14"), // down
  row("d", "剑宗小魔童", "玄幻言情", 4, "2026-08-14"),
  row("e", "我在末世有座城", "科幻末世", 5, "2026-08-14"), // new
];

describe("T9 市场摘要", () => {
  const s = buildMarketSummary(rows, "2026-08-14", "2026-08-14T13:00:00.000Z");

  it("题材聚合：按今日出现次数降序", () => {
    expect(s.categories[0].category).toBe("古风世情");
    expect(s.categories[0].appearances).toBe(3);
    expect(s.categories[0].topBooks[0]).toBe("笨蛋美人");
    expect(s.categories[1].category).toBe("玄幻言情");
  });

  it("上升最快：对比昨日 rank", () => {
    expect(s.risers.map((r) => r.bookId)).toEqual(["b", "c"]);
    expect(s.risers[0].deltaValue).toBe(1);
  });

  it("新进榜识别", () => {
    expect(s.newEntries.map((n) => n.bookId)).toEqual(["e"]);
  });

  it("天数和总数", () => {
    expect(s.dayCount).toBe(2);
    expect(s.totalBooks).toBe(5);
  });

  it("渲染为紧凑文本", () => {
    const text = renderMarketSummary(s);
    expect(text).toContain("古风世情");
    expect(text).toContain("上升最快");
    expect(text).toContain("新进榜");
    expect(text.length).toBeLessThan(600);
  });

  it("空数据不崩溃", () => {
    const s2 = buildMarketSummary([], "2026-08-14", "now");
    expect(s2.categories).toEqual([]);
    expect(s2.risers).toEqual([]);
  });
});
