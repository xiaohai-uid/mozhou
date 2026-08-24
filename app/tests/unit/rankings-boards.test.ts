import { describe, it, expect } from "vitest";
import { RANKING_BOARDS, resolveFanqieRankingRows, findRankingBoard } from "@/lib/story/rankings";

describe("T1 榜单配置合法性", () => {
  it("16 个核心榜，id 唯一、URL 合法、enabled", () => {
    expect(RANKING_BOARDS.length).toBe(16);
    const ids = RANKING_BOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(16);
    for (const b of RANKING_BOARDS) {
      expect(b.id).toMatch(/^(f|m)-(long|short)-[a-z-]+$/);
      expect(b.listUrl).toMatch(/^https:\/\/fanqienovel\.com\/rank\/(0|1)_(1|2)_\d+$/);
      expect(b.source).toBe("fanqienovel.com");
      expect(b.enabled).toBe(true);
      expect(b.displayName.length).toBeGreaterThan(2);
    }
  });

  it("女频/男频 × 长/短篇 都有覆盖", () => {
    const combos = new Set(RANKING_BOARDS.map((b) => b.id.split("-").slice(0, 2).join("-")));
    for (const combo of ["f-long", "f-short", "m-long", "m-short"]) {
      expect(combos.has(combo)).toBe(true);
    }
  });

  it("findRankingBoard 按 id 命中；未知返回 undefined", () => {
    expect(findRankingBoard("f-long-gufeng")?.id).toBe("f-long-gufeng");
    expect(findRankingBoard("nope")).toBeUndefined();
    expect(findRankingBoard(null)).toBeUndefined();
  });
});

describe("T1 每榜前 20", () => {
  function listHtml(n: number): string {
    let out = "";
    for (let i = 1; i <= n; i += 1) {
      out += '<a href="/page/100000' + i + '">书' + i + "</a>";
    }
    return out;
  }
  const okDetail = () => JSON.stringify({ bookName: "明文书名" });

  it("解析 20 张卡片并全部解码（degraded=false）", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: "https://fanqienovel.com/rank/0_2_1139",
      capturedAt: "2026-08-14T00:00:00.000Z",
      listHtml: listHtml(20),
      fetchDetail: async () => okDetail(),
    });
    expect(result.rows).toHaveLength(20);
    expect(result.degraded).toBe(false);
    expect(result.accepted).toBe(20);
  });

  it("列表超过 20 只取前 20", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: "https://fanqienovel.com/rank/0_2_1139",
      capturedAt: "2026-08-14T00:00:00.000Z",
      listHtml: listHtml(30),
      fetchDetail: async () => okDetail(),
    });
    expect(result.rows).toHaveLength(20);
    expect(result.rows[19].rank).toBe(20);
  });

  it("部分详情失败 → degraded=true + 已解码行保留", async () => {
    const result = await resolveFanqieRankingRows({
      boardUrl: "https://fanqienovel.com/rank/0_2_1139",
      capturedAt: "2026-08-14T00:00:00.000Z",
      listHtml: listHtml(5),
      fetchDetail: async (bookId) => {
        if (bookId.endsWith("1")) throw new Error("detail down");
        return okDetail();
      },
    });
    expect(result.rows.length).toBe(4);
    expect(result.degraded).toBe(true);
    expect(result.degradation?.code).toBe("DETAIL_FETCH_PARTIAL");
  });
});
