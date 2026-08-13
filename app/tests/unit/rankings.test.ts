import { describe, expect, it } from "vitest";
import {
  FANQIE_BOARDS,
  RANKING_BOARDS,
  extractFanqieBookCards,
  extractFanqieDetailTitle,
  fetchRankingWithRetry,
  isValidRankingTitle,
  resolveFanqieDetailTitle,
  resolveFanqieRankingRows,
} from "@/lib/story/rankings";

const listHtml = (count: number, titles = Array.from({ length: count }, (_, i) => `榜单书${i + 1}`)) =>
  titles.map((title, i) => `<a href="/page/book-${i + 1}">${title}</a>`).join("\n");

const detail = (title: string) => `{"bookName":"${title}"}`;

describe("番茄榜单 P0-A 质量契约", () => {
  it("只暴露两个启用的产品榜单", () => {
    expect(RANKING_BOARDS.map((board) => board.id)).toEqual(["long-hot", "short-hot"]);
    expect(FANQIE_BOARDS).toHaveLength(2);
    expect(RANKING_BOARDS.every((board) => board.enabled && board.sourceKind === "official-ranking")).toBe(true);
  });

  it("列表解析保留 bookId 和原始 rank", () => {
    expect(extractFanqieBookCards(listHtml(2))).toEqual([
      { bookId: "book-1", rank: 1, listTitle: "榜单书1" },
      { bookId: "book-2", rank: 2, listTitle: "榜单书2" },
    ]);
  });

  it("列表页 PUA 标题不作为最终输出", () => {
    const cards = extractFanqieBookCards('<a href="/page/123">惹枝</a>');
    expect(cards[0].listTitle).toBe("惹枝");
    expect(isValidRankingTitle(cards[0].listTitle)).toBe(false);
  });

  it("拒绝 BMP PUA 标题", () => expect(isValidRankingTitle("惹\uE000枝")).toBe(false));

  it("拒绝 supplementary PUA 标题", () => expect(isValidRankingTitle(`惹${String.fromCodePoint(0xF0000)}枝`)).toBe(false));

  it("拒绝空标题", () => expect(isValidRankingTitle("   ")).toBe(false));

  it("拒绝控制字符标题", () => expect(isValidRankingTitle("惹\u0000金枝")).toBe(false));

  it("详情页优先解析 SSR bookName", () => {
    expect(resolveFanqieDetailTitle(detail("惹金枝"))).toEqual({ title: "惹金枝", resolution: "detail-ssr" });
    expect(extractFanqieDetailTitle(detail("惹金枝"))).toBe("惹金枝");
  });

  it("详情页 HTML title 可作为第二解析路径", () => {
    expect(resolveFanqieDetailTitle("<title>恶毒女背叛傻子老好人夫君后完整版在线阅读_番茄小说</title>"))
      .toEqual({ title: "恶毒女背叛傻子老好人夫君后", resolution: "detail-html" });
  });

  it("详情页解析失败不生成假标题", () => expect(extractFanqieDetailTitle("<html>no title</html>")).toBeNull());

  it("5/5 详情成功时 degraded=false", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => detail(bookId),
    });
    expect(result.degraded).toBe(false);
    expect(result).toMatchObject({ attempted: 5, accepted: 5, rejected: 0 });
    expect(result.rows).toHaveLength(5);
  });

  it("4/5 详情成功时 degraded=true", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => bookId === "book-5" ? "invalid" : detail(bookId),
    });
    expect(result.degraded).toBe(true);
    expect(result).toMatchObject({ attempted: 5, accepted: 4, rejected: 1 });
    expect(result.degradation?.code).toBe("TITLE_QUALITY_REJECTED");
  });

  it("0/5 详情成功时返回空数组并 degraded=true", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async () => "invalid",
    });
    expect(result.rows).toEqual([]);
    expect(result).toMatchObject({ attempted: 5, accepted: 0, rejected: 5, degraded: true });
    expect(result.degradation?.code).toBe("NO_VALID_ROWS");
  });

  it("详情 fetch 部分失败时不抛异常", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => { if (bookId === "book-2") throw new Error("secret/raw upstream error"); return detail(bookId); },
    });
    expect(result.degraded).toBe(true);
    expect(result.degradation?.code).toBe("DETAIL_FETCH_PARTIAL");
    expect(JSON.stringify(result)).not.toContain("secret/raw upstream error");
  });

  it("只尝试前五名，不用第六名掩盖质量失败", async () => {
    const requested: string[] = [];
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(6),
      fetchDetail: async (bookId) => { requested.push(bookId); return detail(bookId); },
    });
    expect(requested).toHaveLength(5);
    expect(result.rows.at(-1)?.rank).toBe(5);
  });

  it("保留列表 rank 而不是按过滤后的行重新编号", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => bookId === "book-1" ? "invalid" : detail(bookId),
    });
    expect(result.rows[0].rank).toBe(2);
  });

  it("输出详情 URL、来源 URL 和解析来源", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[1].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => bookId === "book-1" ? "<title>书一完整版_番茄小说</title>" : detail(bookId),
    });
    expect(result.rows[0]).toMatchObject({
      bookId: "book-1",
      source: "fanqienovel.com",
      sourceUrl: RANKING_BOARDS[1].listUrl,
      detailUrl: "https://fanqienovel.com/page/book-1",
      titleResolution: "detail-html",
    });
  });

  it("列表解析失败返回 LIST_PARSE_FAILED", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: "<html>empty</html>",
      fetchDetail: async () => detail("never"),
    });
    expect(result.degradation).toEqual({ code: "LIST_PARSE_FAILED", attempted: 0, accepted: 0, rejected: 0 });
  });

  it("详情质量失败仍保留可验证的部分行", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(2),
      fetchDetail: async (bookId) => bookId === "book-1" ? detail("书一") : "invalid",
    });
    expect(result.rows.map((row) => row.name)).toEqual(["书一"]);
    expect(result.degradation?.accepted).toBe(1);
  });

  it("标题解码保留 HTML 实体", () => expect(extractFanqieDetailTitle(detail("A &amp; B"))).toBe("A & B"));

  it("标题长度超过质量上限时拒绝", () => expect(isValidRankingTitle("a".repeat(121))).toBe(false));

  it("重复 bookId 只保留一条列表记录", () => {
    expect(extractFanqieBookCards('<a href="/page/1">一</a><a href="/page/1">一</a>')).toHaveLength(1);
  });

  it("所有行均不含 PUA", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5, ["", "二", "三", "四", "五"]),
      fetchDetail: async (bookId) => detail(bookId === "book-1" ? "明文一" : bookId),
    });
    expect(result.rows.every((row) => isValidRankingTitle(row.name))).toBe(true);
  });

  it("成功响应的 accepted/attempted 是 5/5", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: RANKING_BOARDS[0].listUrl,
      capturedAt: "2026-08-13T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => detail(bookId),
    });
    expect(`${result.accepted}/${result.attempted}`).toBe("5/5");
  });

  it("429 会按重试策略再次请求", async () => {
    let calls = 0;
    const result = await fetchRankingWithRetry({
      url: "https://fanqienovel.com/rank/long-hot",
      request: async () => ++calls === 1 ? new Response("busy", { status: 429 }) : new Response("ok", { status: 200 }),
      sleep: async () => undefined,
    });
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
  });

  it("5xx 连续失败后返回最后一次响应，不泄漏上游正文", async () => {
    let calls = 0;
    const result = await fetchRankingWithRetry({
      url: "https://fanqienovel.com/rank/long-hot",
      request: async () => { calls += 1; return new Response("upstream secret", { status: 503 }); },
      sleep: async () => undefined,
    });
    expect(calls).toBe(3);
    expect(result.status).toBe(503);
    expect(JSON.stringify({ status: result.status })).not.toContain("upstream secret");
  });
});
