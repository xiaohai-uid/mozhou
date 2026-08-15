// story_grounding 产物渲染（纯函数）：格式与旧 RAG 直拼兼容 + 追踪行
import { describe, it, expect } from "vitest";
import { renderContextPack } from "@/lib/runtime/executors/story-grounding";

describe("renderContextPack", () => {
  it("人物/设定条目格式与旧直拼一致", () => {
    const text = renderContextPack({
      entries: [
        { kind: "character", name: "阿雀", note: "知道火苗的秘密" },
        { kind: "worldview", name: "火苗", note: null },
      ],
      tracking: null,
    });
    expect(text).toContain("[人物] 阿雀：知道火苗的秘密");
    expect(text).toContain("[设定] 火苗");
  });

  it("追踪数据 → [追踪] 行（角色状态/伏笔/时间线/读者已知）", () => {
    const text = renderContextPack({
      entries: [],
      tracking: {
        statusCard: { currentChapterId: 1, currentChapter: "012", settledChapters: 11, lastSettledAt: null },
        characterStates: [{ name: "阿雀", state: "知道秘密", chapterId: 1 }],
        promises: [{ id: "p1", text: "灰烬有籽", status: "open", chapterId: 1 }],
        timeline: [{ text: "火苗偏转", chapterId: 1, chapter: "011" }],
        readerKnowledge: [{ text: "火苗的秘密", chapterId: 1 }],
        chapterRecords: [],
      },
    });
    expect(text).toContain("[追踪] 角色状态：阿雀——知道秘密");
    expect(text).toContain("[追踪] 伏笔：灰烬有籽（未回收）");
    expect(text).toContain("[追踪] 时间线：火苗偏转");
    expect(text).toContain("[追踪] 读者已知：火苗的秘密");
  });

  it("空数据 → 空字符串", () => {
    expect(renderContextPack({ entries: [], tracking: null })).toBe("");
  });

  it("脏输入不抛错", () => {
    expect(renderContextPack(null)).toBe("");
    expect(renderContextPack({})).toBe("");
  });
});
