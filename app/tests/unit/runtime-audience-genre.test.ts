// audience_genre：market_note 提炼与渲染（纯函数）
import { describe, it, expect } from "vitest";
import { buildMarketNote, renderMarketNote } from "@/lib/runtime/executors/audience-genre";
import type { MarketBriefingData } from "@/lib/market/briefing-artifacts";

const data: MarketBriefingData = {
  version: "v17",
  dayCount: 7,
  summary: {
    generatedAt: "2026-08-14T00:00:00Z",
    dayCount: 7,
    totalBooks: 40,
    categories: [
      { category: "科幻末世", appearances: 12, topBooks: ["《A》", "《B》"], avgRank: 5 },
      { category: "都市", appearances: 8, topBooks: ["《C》"], avgRank: 8 },
    ],
    risers: [{ bookId: "b1", name: "《上升书》", category: null, deltaValue: 12 }],
    newEntries: [{ bookId: "b2", name: "《新进书》", category: null }],
  },
  rendered: "（略）",
};

describe("buildMarketNote", () => {
  it("提炼题材期待/上升最快/新进元素 + 差异化约束（不把榜书当正文素材）", () => {
    const note = buildMarketNote(data);
    expect(note.briefingVersion).toBe("v17");
    expect(note.provenance).toContain("7 日");
    expect(note.note).toContain("题材期待：当前热门 科幻末世×12 本、都市×8 本");
    expect(note.note).toContain("上升最快参考：《上升书》");
    expect(note.note).toContain("新进元素：《新进书》");
    expect(note.note).toContain("不得作为正文素材");
  });
});

describe("renderMarketNote", () => {
  it("渲染带版本与来源（可审计）", () => {
    const text = renderMarketNote(buildMarketNote(data));
    expect(text).toContain("[市场] v17（ranking-snapshot · 7 日）");
    expect(text).toContain("题材期待");
  });

  it("脏输入 → 空字符串", () => {
    expect(renderMarketNote(null)).toBe("");
    expect(renderMarketNote({})).toBe("");
  });
});
