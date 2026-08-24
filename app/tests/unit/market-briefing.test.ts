import { describe, it, expect } from "vitest";
import {
  buildBriefingResponse,
  buildTitleCandidates,
  type SnapshotRow,
} from "@/lib/market/service";

function row(over: Partial<SnapshotRow>): SnapshotRow {
  return {
    bookId: "b1",
    name: "书名",
    author: "作者",
    category: null,
    rank: 1,
    capturedAt: "2026-08-14T00:00:00.000Z",
    ...over,
  };
}

describe("T9 市场简报", () => {
  it("无数据 → 404 NO_DATA", () => {
    const r = buildBriefingResponse([], "2026-08-14T00:00:00.000Z", "2026-08-14T12:00:00.000Z");
    expect(r.status).toBe(404);
    if (r.status === 404) {
      expect(r.error).toBe("暂无市场数据");
      expect(r.code).toBe("NO_DATA");
    }
  });

  it("有数据 → 200 summary + rendered 文本", () => {
    const rows = [
      row({ bookId: "b1", name: "甲", category: "古风", rank: 1, capturedAt: "2026-08-14T00:00:00.000Z" }),
      row({ bookId: "b2", name: "乙", category: "仙侠", rank: 2, capturedAt: "2026-08-14T00:00:00.000Z" }),
      row({ bookId: "b3", name: "丙", category: "古风", rank: 3, capturedAt: "2026-08-14T00:00:00.000Z" }),
    ];
    const r = buildBriefingResponse(rows, "2026-08-14T00:00:00.000Z", "2026-08-14T12:00:00.000Z");
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.summary.totalBooks).toBe(3);
    expect(r.summary.dayCount).toBe(1);
    expect(r.rendered).toContain("【市场风向");
    expect(r.rendered).toContain("古风");
  });

  it("候选书名规则生成：genre 关键词 + 榜书词缀组合，references 去重限 10", () => {
    const names = Array.from({ length: 15 }, (_, i) => `书${i % 3}`);
    const r = buildTitleCandidates(names, "玄幻");
    expect(r.references.length).toBeLessThanOrEqual(10);
    // 去重后应为 3 个不同书名
    expect(new Set(r.references).size).toBe(r.references.length);
    expect(r.references).toHaveLength(3);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates[0]).toContain("玄幻");
  });

  it("无 genre → 用默认关键词生成候选", () => {
    const r = buildTitleCandidates(["惹金枝"], null);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});
