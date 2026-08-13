import { describe, expect, it } from "vitest";
import {
  FANQIE_BOARDS,
  extractFanqieBookCards,
  extractFanqieDetailTitle,
  isValidRankingTitle,
  resolveFanqieRankingRows,
} from "@/lib/story/rankings";

describe("番茄榜单质量边界", () => {
  it("从列表页提取 bookId，但不把字体混淆标题当可信标题", () => {
    const cards = extractFanqieBookCards(`
      <a href="/page/123" class="title">惹枝</a>
      <a href="/page/456" class="title">笨蛋</a>
    `);

    expect(cards).toEqual([
      { bookId: "123", listTitle: "惹枝" },
      { bookId: "456", listTitle: "笨蛋" },
    ]);
    expect(isValidRankingTitle(cards[0].listTitle)).toBe(false);
  });

  it("优先从详情页 SSR JSON 或 title 恢复明文标题", () => {
    expect(extractFanqieDetailTitle(`..."bookName":"惹金枝"...`)).toBe("惹金枝");
    expect(
      extractFanqieDetailTitle("<title>恶毒女背叛傻子老好人夫君后完整版在线免费阅读_番茄小说</title>"),
    ).toBe("恶毒女背叛傻子老好人夫君后");
  });

  it("详情页失败时只返回可信行，并明确 degraded", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: "https://fanqienovel.com/rank/0_2_1139",
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: `
        <a href="/page/123">惹枝</a>
        <a href="/page/456">掌娇娇</a>
      `,
      fetchDetail: async (bookId) => bookId === "123"
        ? `..."bookName":"惹金枝"...`
        : `..."bookName":"掌娇娇"...`,
    });

    expect(result.rows).toEqual([
      {
        rank: 1,
        name: "惹金枝",
        heat: "—",
        source: "fanqienovel.com",
        capturedAt: "2026-08-13T00:00:00.000Z",
        url: "https://fanqienovel.com/page/123",
      },
    ]);
    expect(result.degraded).toBe(true);
    expect(result.degradationReason).toContain("1/2");
  });

  it("官方目录包含男女频阅读榜和新书榜，而不是两个固定榜名", () => {
    expect(FANQIE_BOARDS.map((board) => board.name)).toEqual([
      "番茄女频阅读榜",
      "番茄男频阅读榜",
      "番茄女频新书榜",
      "番茄男频新书榜",
    ]);
    expect(FANQIE_BOARDS.every((board) => board.categories.length > 1)).toBe(true);
  });
});
