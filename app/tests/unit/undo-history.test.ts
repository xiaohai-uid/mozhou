// Journey ⑧（V1.2）：useBodyHistory 纯逻辑核心单测（稳定规则；UI 行为由浏览器验收案例覆盖）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBodyHistory, UNDO_MERGE_MS } from "@/components/features/undo-history";

describe("createBodyHistory（Journey ⑧ 方案 A 冻结语义）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("初始：canUndo/canRedo 为 false，undo/redo 返回 null", () => {
    const h = createBodyHistory("A");
    expect(h.current).toBe("A");
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it("普通输入 → undo 回到初始", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe("A");
    expect(h.canUndo).toBe(false);
  });

  it("窗口内连续输入合并为一层 undo", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    vi.advanceTimersByTime(UNDO_MERGE_MS - 1);
    h.type("ABC");
    vi.advanceTimersByTime(UNDO_MERGE_MS - 1);
    h.type("ABCD");
    // 三次输入在一个窗口内 → 一次 undo 回到初始
    expect(h.undo()).toBe("A");
    expect(h.canUndo).toBe(false);
  });

  it("停顿超过窗口 → 分为两层 undo", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    vi.advanceTimersByTime(UNDO_MERGE_MS + 1);
    h.type("ABC");
    expect(h.undo()).toBe("AB"); // 先回到停顿前
    expect(h.undo()).toBe("A"); // 再回到初始
  });

  it("undo → redo 恢复", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    expect(h.undo()).toBe("A");
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe("AB");
    expect(h.canRedo).toBe(false);
  });

  it("redo 后新输入清空 future（redo 分支失效）", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    h.undo();
    h.type("AC"); // 新输入
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
  });

  it("apply（AI 插入等程序化变更）为单原子一层", () => {
    const h = createBodyHistory("A");
    h.type("AB"); // 输入一层
    h.apply("AB\n\nAI 插入八百字……");
    expect(h.undo()).toBe("AB"); // 一次 undo 整体撤销插入
    expect(h.undo()).toBe("A");
  });

  it("apply 打断输入合并窗口（其后输入从新一层开始）", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    vi.advanceTimersByTime(UNDO_MERGE_MS - 1);
    h.apply("ABX");
    h.type("ABXY"); // 窗口未过但已被 apply 打断
    expect(h.undo()).toBe("ABX"); // 输入层
    expect(h.undo()).toBe("AB"); // apply 层
    expect(h.undo()).toBe("A");
  });

  it("相同值 type/apply 不产生栈项", () => {
    const h = createBodyHistory("A");
    h.type("A");
    h.apply("A");
    expect(h.canUndo).toBe(false);
  });

  it("reset（章节加载/切换）清空全部 history", () => {
    const h = createBodyHistory("A");
    h.type("AB");
    h.apply("ABX");
    h.reset("新章节正文");
    expect(h.current).toBe("新章节正文");
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
