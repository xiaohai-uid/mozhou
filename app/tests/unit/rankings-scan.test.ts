import { describe, it, expect, vi } from "vitest";
import {
  scanAll,
  scanWithinCooldown,
  type ScanInsertRow,
} from "@/lib/rankings/scan";
import type { RankingBoard } from "@/lib/story/rankings";

function board(id: string, listUrl: string): RankingBoard {
  return {
    id,
    displayName: id,
    source: "fanqienovel.com",
    sourceKind: "official-ranking",
    workLength: "long",
    rankingKind: "genre",
    listUrl,
    enabled: true,
  };
}

function listHtml(count: number): string {
  let out = "";
  for (let i = 1; i <= count; i += 1) {
    out += '<a href="/page/100000' + i + '">书' + i + "</a>";
  }
  return out;
}

function detailHtml(bookName: string, category?: string, author = "作者甲"): string {
  const cat = category ? `,\"categoryV2\":\"${category}\"` : "";
  return `{"bookName":"${bookName}","author":"${author}"${cat}}`;
}

// 幂等键：boardId + bookId + capturedAt
function keyOf(row: ScanInsertRow): string {
  return `${row.boardId}|${row.bookId}|${row.capturedAt}`;
}

describe("T2 scanAll 扫榜落库", () => {
  const capturedAt = "2026-08-14T12:00:00.000Z";

  it("成功路径：2 个榜 rowsInserted 正确、capturedAt 一致、category 解析正确", async () => {
    const boards = [
      board("b-a", "https://fanqienovel.com/rank/0_2_1139"),
      board("b-b", "https://fanqienovel.com/rank/1_2_258"),
    ];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes("/rank/")) return listHtml(3);
      return detailHtml("明文书名", "都市脑洞");
    });
    const persisted: ScanInsertRow[] = [];
    const persist = vi.fn(async (rows: ScanInsertRow[]) => {
      persisted.push(...rows);
      return rows.length;
    });

    const result = await scanAll({ boards, fetchHtml, persist, capturedAt });

    expect(result.boardsAttempted).toBe(2);
    expect(result.boardsFailed).toBe(0);
    expect(result.rowsInserted).toBe(6);
    expect(result.capturedAt).toBe(capturedAt);
    expect(result.failures).toEqual([]);
    expect(persisted).toHaveLength(6);
    for (const row of persisted) {
      expect(row.capturedAt).toBe(capturedAt);
      expect(row.category).toBe("都市脑洞");
      expect(row.name).toBe("明文书名");
      expect(row.rank).toBeGreaterThanOrEqual(1);
      expect(row.boardId).toMatch(/^b-[ab]$/);
    }
  });

  it("幂等：相同 capturedAt 重复扫描不报错、落库行集一致", async () => {
    const boards = [board("b-a", "https://fanqienovel.com/rank/0_2_1139")];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes("/rank/")) return listHtml(2);
      return detailHtml("幂等书");
    });
    const persist = vi.fn(async (rows: ScanInsertRow[]) => rows.length);

    const deps = { boards, fetchHtml, persist, capturedAt };
    const first = await scanAll(deps);
    const second = await scanAll(deps);

    expect(first.rowsInserted).toBe(2);
    expect(second.rowsInserted).toBe(2); // 重复扫描不抛错、正常返回
    // 两次落库的行（幂等键）一致 ⇒ (boardId, bookId, capturedAt) 冲突会被 ON CONFLICT DO NOTHING 吞掉。
    const callRows = persist.mock.calls.map((c) => c[0] as ScanInsertRow[]);
    const firstKeys = callRows[0].map(keyOf).sort();
    const secondKeys = callRows[1].map(keyOf).sort();
    expect(secondKeys).toEqual(firstKeys);
  });

  it("失败容错：一榜 fetch 失败 → boardsFailed=1，其余继续", async () => {
    const boards = [
      board("b-bad", "https://fanqienovel.com/rank/0_2_1139"),
      board("b-good", "https://fanqienovel.com/rank/1_2_258"),
    ];
    const fetchHtml = vi.fn(async (url: string) => {
      if (url.includes("0_2_1139")) throw new Error("列表源挂了");
      if (url.includes("/rank/")) return listHtml(4);
      return detailHtml("好书");
    });
    const persist = vi.fn(async (rows: ScanInsertRow[]) => rows.length);

    const result = await scanAll({ boards, fetchHtml, persist, capturedAt });

    expect(result.boardsAttempted).toBe(2);
    expect(result.boardsFailed).toBe(1);
    expect(result.failures).toEqual([{ boardId: "b-bad", reason: "列表源挂了" }]);
    expect(result.rowsInserted).toBe(4); // good 榜 4 行照常落库
  });

  it("冷却：60 秒内重复 scan → 命中 429 判定", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    expect(scanWithinCooldown(new Date(now.getTime() - 30_000), now)).toBe(true);
    expect(scanWithinCooldown(new Date(now.getTime() - 61_000), now)).toBe(false);
    expect(scanWithinCooldown(null, now)).toBe(false);
  });
});
