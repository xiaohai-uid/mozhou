import { describe, it, expect } from "vitest";
import { computeTrends, type SnapshotRow } from "@/lib/rankings/trends";

const prev: SnapshotRow[] = [
  { bookId: "a", name: "甲", rank: 1 },
  { bookId: "b", name: "乙", rank: 2 },
  { bookId: "c", name: "丙", rank: 3 },
  { bookId: "d", name: "丁", rank: 4 },
];
const cur: SnapshotRow[] = [
  { bookId: "b", name: "乙", rank: 1 }, // up 1
  { bookId: "a", name: "甲", rank: 2 }, // down 1
  { bookId: "c", name: "丙", rank: 3 }, // flat
  { bookId: "e", name: "戊", rank: 4 }, // new
  { bookId: "f", name: "己", rank: 5 }, // new
];

describe("T3 趋势 delta", () => {
  const t = computeTrends(prev, cur, "2026-08-13T00:00:00.000Z", "2026-08-14T00:00:00.000Z");

  it("涨跌/持平/新进归类正确", () => {
    const byId = new Map(t.rows.map((r) => [r.bookId, r]));
    expect(byId.get("a")?.delta).toBe("down");
    expect(byId.get("a")?.deltaValue).toBe(1);
    expect(byId.get("b")?.delta).toBe("up");
    expect(byId.get("b")?.deltaValue).toBe(1);
    expect(byId.get("c")?.delta).toBe("flat");
    expect(byId.get("e")?.delta).toBe("new");
    expect(byId.get("e")?.prevRank).toBeNull();
  });

  it("跌出榜 = 上次有本次无", () => {
    expect(t.gone.map((g) => g.bookId)).toEqual(["d"]);
  });

  it("上升最快按 deltaValue 降序（含多级上升）", () => {
    const t2 = computeTrends(
      [
        { bookId: "x", name: "x", rank: 10 },
        { bookId: "y", name: "y", rank: 8 },
      ],
      [
        { bookId: "x", name: "x", rank: 1 }, // up 9
        { bookId: "y", name: "y", rank: 2 }, // up 6
      ],
      "b", "c",
    );
    expect(t2.risers[0].bookId).toBe("x");
    expect(t2.risers[0].deltaValue).toBe(9);
    expect(t2.risers[1].bookId).toBe("y");
  });

  it("时间戳回显", () => {
    expect(t.baseline).toBe("2026-08-13T00:00:00.000Z");
    expect(t.current).toBe("2026-08-14T00:00:00.000Z");
  });

  it("空快照不崩溃", () => {
    const t2 = computeTrends([], [], "b", "c");
    expect(t2.rows).toEqual([]);
    expect(t2.risers).toEqual([]);
  });
});
