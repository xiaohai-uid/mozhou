import { describe, it, expect } from "vitest";
import { buildTrendResponse, type TrendGroup } from "@/lib/rankings/trends-db";

const board = { id: "f-long-gufeng", displayName: "女频长篇·古风世情" };

const groupA: TrendGroup = {
  capturedAt: "2026-08-13T00:00:00.000Z",
  rows: [
    { bookId: "a", name: "甲", rank: 1 },
    { bookId: "b", name: "乙", rank: 2 },
  ],
};

const groupB: TrendGroup = {
  capturedAt: "2026-08-14T00:00:00.000Z",
  rows: [
    { bookId: "b", name: "乙", rank: 1 },
    { bookId: "c", name: "丙", rank: 2 },
  ],
};

describe("T3 trends 快照选择", () => {
  it("无快照 → no-snapshot（404 语义）", () => {
    const r = buildTrendResponse([], board);
    expect(r.kind).toBe("no-snapshot");
    if (r.kind === "no-snapshot") {
      expect(r.error).toBe("暂无快照");
      expect(r.code).toBe("NO_SNAPSHOT");
    }
  });

  it("仅一次快照 → 降级语义：baseline null，risers/newEntries/gone 空，rows 为当前行", () => {
    const r = buildTrendResponse([groupA], board);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.body.degraded).toBe(true);
    expect(r.body.baseline).toBeNull();
    expect(r.body.current).toBe("2026-08-13T00:00:00.000Z");
    expect(r.body.rows).toHaveLength(2);
    expect(r.body.risers).toEqual([]);
    expect(r.body.newEntries).toEqual([]);
    expect(r.body.gone).toEqual([]);
  });

  it("两次快照 → computeTrends 全量 delta（不论输入顺序）", () => {
    // 故意乱序传入，buildTrendResponse 应自排序
    const r = buildTrendResponse([groupA, groupB], board);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.body.degraded).toBe(false);
    expect(r.body.current).toBe("2026-08-14T00:00:00.000Z");
    expect(r.body.baseline).toBe("2026-08-13T00:00:00.000Z");
    const byId = new Map((r.body.rows as Array<{ bookId: string; delta?: string }>).map((x) => [x.bookId, x]));
    expect(byId.get("b")?.delta).toBe("up");
    expect(byId.get("c")?.delta).toBe("new");
    expect(r.body.newEntries.map((x) => x.bookId)).toContain("c");
    expect(r.body.gone.map((x) => x.bookId)).toContain("a");
  });

  it("board 引用回显", () => {
    const r = buildTrendResponse([groupA], board);
    if (r.kind === "ok") expect(r.body.board).toEqual(board);
  });
});