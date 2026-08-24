// Journey ⑧+⑨（V1.2）：useBodyHistory 纯逻辑核心单测（稳定规则；UI 行为由浏览器验收案例覆盖）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBodyHistory, UNDO_MERGE_MS, type SelectionState } from "@/components/features/undo-history";

const SEL = (s: number, e = s): SelectionState => ({ start: s, end: e });

describe("createBodyHistory（Journey ⑧ 冻结语义）", () => {
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

  it("普通输入 → undo 回到初始（正文 + selection）", () => {
    const h = createBodyHistory("A");
    h.setSelection(SEL(1));
    h.type("AB", SEL(2));
    expect(h.canUndo).toBe(true);
    const r = h.undo();
    expect(r?.content).toBe("A");
    expect(r?.selection).toEqual({ start: 1, end: 1 }); // 恢复输入前 caret
    expect(h.canUndo).toBe(false);
  });

  it("窗口内连续输入合并为一层 undo", () => {
    const h = createBodyHistory("A");
    h.type("AB", SEL(2));
    vi.advanceTimersByTime(UNDO_MERGE_MS - 1);
    h.type("ABC", SEL(3));
    vi.advanceTimersByTime(UNDO_MERGE_MS - 1);
    h.type("ABCD", SEL(4));
    expect(h.undo()?.content).toBe("A");
    expect(h.canUndo).toBe(false);
  });

  it("停顿超过窗口 → 分为两层 undo", () => {
    const h = createBodyHistory("A");
    h.type("AB", SEL(2));
    vi.advanceTimersByTime(UNDO_MERGE_MS + 1);
    h.type("ABC", SEL(3));
    expect(h.undo()?.content).toBe("AB");
    expect(h.undo()?.content).toBe("A");
  });

  it("undo → redo 恢复（正文 + selection）", () => {
    const h = createBodyHistory("A");
    h.setSelection(SEL(0));
    h.type("AB", SEL(2));
    expect(h.undo()?.selection).toEqual({ start: 0, end: 0 });
    const r = h.redo();
    expect(r?.content).toBe("AB");
    expect(r?.selection).toEqual({ start: 2, end: 2 }); // 恢复输入后 caret
    expect(h.canRedo).toBe(false);
  });

  it("redo 后新输入清空 future（redo 分支失效）", () => {
    const h = createBodyHistory("A");
    h.type("AB", SEL(2));
    h.undo();
    h.type("AC", SEL(3));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
  });

  it("纯 caret 移动（setSelection）不创建 undo entry", () => {
    const h = createBodyHistory("A");
    h.setSelection(SEL(0));
    h.setSelection(SEL(1));
    h.setSelection(SEL(2));
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });

  it("J9 apply（AI 插入）：记录插入前 selection，undo 整体恢复（正文 + caret）", () => {
    const h = createBodyHistory("ABCDEF");
    h.setSelection(SEL(3)); // caret 在 C、D 之间
    h.apply("ABCXYZDEF", SEL(6)); // 插入 XYZ，caret 在 XYZ 后
    expect(h.current).toBe("ABCXYZDEF");
    const u = h.undo();
    expect(u?.content).toBe("ABCDEF");
    expect(u?.selection).toEqual({ start: 3, end: 3 }); // 恢复插入前 caret
    const r = h.redo();
    expect(r?.content).toBe("ABCXYZDEF");
    expect(r?.selection).toEqual({ start: 6, end: 6 }); // redo 光标在插入内容末尾
  });

  it("J9 apply（AI 替换选区）：undo 恢复原选中文本并恢复选区（仍选中）", () => {
    const h = createBodyHistory("ABCDEF");
    h.setSelection(SEL(1, 4)); // 选中 BCD
    h.apply("AXYEF", SEL(3)); // 替换为 XY，caret 在 XY 后
    expect(h.current).toBe("AXYEF");
    const u = h.undo();
    expect(u?.content).toBe("ABCDEF");
    expect(u?.selection).toEqual({ start: 1, end: 4 }); // 原选区恢复（仍选中，可继续处理）
    const r = h.redo();
    expect(r?.content).toBe("AXYEF");
    expect(r?.selection).toEqual({ start: 3, end: 3 });
  });

  it("apply 打断输入合并窗口（其后输入从新一层开始）", () => {
    const h = createBodyHistory("A");
    h.type("AB", SEL(2));
    vi.advanceTimersByTime(UNDO_MERGE_MS - 1);
    h.apply("ABX", SEL(3));
    h.type("ABXY", SEL(4));
    expect(h.undo()?.content).toBe("ABX");
    expect(h.undo()?.content).toBe("AB");
    expect(h.undo()?.content).toBe("A");
  });

  it("相同值 type/apply 不产生栈项", () => {
    const h = createBodyHistory("A");
    h.type("A", SEL(0));
    h.apply("A", SEL(0));
    expect(h.canUndo).toBe(false);
  });

  it("reset（章节加载/切换）清空全部 history 与 selection", () => {
    const h = createBodyHistory("A");
    h.type("AB", SEL(2));
    h.apply("ABX", SEL(3));
    h.reset("新章节正文");
    expect(h.current).toBe("新章节正文");
    expect(h.selection).toEqual({ start: 0, end: 0 });
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
