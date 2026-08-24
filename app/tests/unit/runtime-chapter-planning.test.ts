// chapter_planning：任务卡派生与渲染（纯函数）
import { describe, it, expect } from "vitest";
import { buildTaskCard, renderChapterTaskCard } from "@/lib/runtime/executors/chapter-planning";
import type { StoryTrackingState } from "@/lib/schema";

const state: StoryTrackingState = {
  statusCard: { currentChapterId: 2, currentChapter: "002", settledChapters: 1, lastSettledAt: "2026-08-15T00:00:00Z" },
  characterStates: [
    { name: "阿雀", state: "知道火苗的秘密", chapterId: 1 },
    { name: "零界", state: "不知情", chapterId: 1 },
  ],
  promises: [
    { id: "p1", text: "灰烬有籽", status: "open", chapterId: 1 },
    { id: "p2", text: "火苗会偏转", status: "resolved", chapterId: 1 },
  ],
  timeline: [{ text: "火苗偏转", chapterId: 1, chapter: "001" }],
  readerKnowledge: [{ text: "阿雀知道火苗秘密", chapterId: 1 }],
  chapterRecords: [],
};

describe("buildTaskCard", () => {
  it("从追踪状态派生冲突/铺垫/钩子（只含 open 伏笔，去重）", () => {
    const card = buildTaskCard(state, { id: 2, title: "灰烬有籽", ch: "002" });
    expect(card.chapter).toEqual({ id: 2, title: "灰烬有籽", ch: "002" });
    expect(card.conflictPush).toContain("阿雀：知道火苗的秘密");
    expect(card.conflictPush).toContain("灰烬有籽"); // open 伏笔
    expect(card.conflictPush).not.toContain("火苗会偏转"); // resolved 伏笔不入冲突
    expect(card.payoffSetup).toContain("火苗偏转");
    expect(card.chapterHook).toContain("灰烬有籽");
    expect(card.emotionalGoal).toBeNull(); // 规则化不伪造情绪目标
    expect(card.sourceSummary).toContain("1 章已结算");
    expect(card.sourceSummary).toContain("1 条伏笔待回收");
  });

  it("无追踪状态 → 空卡", () => {
    const card = buildTaskCard(null, { id: null, title: null, ch: null });
    expect(card).toEqual({
      chapter: { id: null, title: null, ch: null },
      emotionalGoal: null,
      conflictPush: [],
      payoffSetup: [],
      chapterHook: [],
      sourceSummary: "",
      methodHints: [],
    });
  });
});

describe("renderChapterTaskCard", () => {
  it("渲染为可读任务卡文本", () => {
    const text = renderChapterTaskCard(buildTaskCard(state, { id: 2, title: "灰烬有籽", ch: "002" }));
    expect(text).toContain("第 002 章 · 灰烬有籽");
    expect(text).toContain("冲突推进：阿雀：知道火苗的秘密；零界：不知情；灰烬有籽");
    expect(text).toContain("章尾钩子：灰烬有籽；阿雀知道火苗秘密");
  });

  it("空卡 → 空字符串", () => {
    expect(renderChapterTaskCard(buildTaskCard(null, { id: null, title: null, ch: null }))).toBe("");
    expect(renderChapterTaskCard(null)).toBe("");
  });

  it("方法参考（BenchmarkPack）：渲染只含抽象方法", () => {
    const card = buildTaskCard(state, { id: 2, title: "灰烬有籽", ch: "002" });
    card.methodHints = ["信息差悬念", "章尾钩子"];
    const text = renderChapterTaskCard(card);
    expect(text).toContain("方法参考（BenchmarkPack）：信息差悬念；章尾钩子");
  });
});
