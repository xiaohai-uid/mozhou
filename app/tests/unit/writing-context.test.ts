import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat/payload";
import {
  BASE_IDENTITY,
  buildWritingContext,
  CHAPTER_MODE_CONTRACT,
  INDEPENDENT_MODE_CONTRACT,
  type WritingContextInput,
} from "@/lib/chat/writing-context";

function input(overrides: Partial<WritingContextInput> = {}): WritingContextInput {
  return {
    mode: "independent",
    model: "deepseek-v4-flash",
    sections: [],
    history: [],
    currentUser: { role: "user", content: "请继续写" },
    observation: {
      route: "chat",
      mode: "independent",
      historyCountBefore: 0,
      compressionApplied: false,
      ragEntryCount: 0,
      stylePresent: false,
      skillCount: 0,
      novelScopePresent: false,
      chapterScopePresent: false,
      ownerScopeResolved: true,
    },
    ...overrides,
  };
}

function sectionKinds(system: string | undefined): string[] {
  return [...(system ?? "").matchAll(/【([^\]】]+)】/g)].map((match) => match[1]!);
}

describe("buildWritingContext", () => {
  it("renders writing facts in the canonical section order", () => {
    const request = buildWritingContext(input({
      mode: "chapter",
      sections: [
        { kind: "skill", content: "[技能] 续写" },
        { kind: "owner_context", content: "[设定] 宗门" },
        { kind: "compression_summary", content: "（历史摘要）先前讨论" },
        { kind: "chapter_reference", content: "[正文参考] 前文" },
        { kind: "style", content: "[风格] 克制" },
        { kind: "selection", content: "[所选片段] 这一句" },
      ],
    }));

    expect(sectionKinds(request.system)).toEqual([
      "base_identity",
      "mode_contract",
      "owner_context",
      "chapter_reference",
      "selection",
      "style",
      "skill",
      "compression_summary",
    ]);
  });

  it("omits empty optional sections without disturbing required sections", () => {
    const request = buildWritingContext(input({
      sections: [
        { kind: "style", content: "   " },
        { kind: "skill", content: "[技能] 润色" },
        { kind: "owner_context", content: "" },
      ],
    }));

    expect(sectionKinds(request.system)).toEqual([
      "base_identity",
      "mode_contract",
      "skill",
    ]);
    expect(request.system).not.toContain("【style】");
    expect(request.system).not.toContain("【owner_context】");
  });

  it("renders system once and sends replayable history followed by the current user", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "历史问题" },
      { role: "assistant", content: "历史回答" },
    ];
    const request = buildWritingContext(input({
      sections: [{ kind: "owner_context", content: "[设定] 只属于当前作品" }],
      history,
      currentUser: { role: "user", content: "本轮作者请求：收束场景" },
    }));

    expect(request.system).toContain(BASE_IDENTITY);
    expect(request.system).not.toContain("本轮作者请求：收束场景");
    expect(request.messages).toEqual([
      { role: "user", content: "历史问题" },
      { role: "assistant", content: "历史回答" },
      { role: "user", content: "本轮作者请求：收束场景" },
    ]);
    expect(request.observation).toMatchObject({
      systemSections: ["base_identity", "mode_contract", "owner_context"],
      currentUserIndices: [2],
      historyCountAfter: 3,
    });
  });

  it("uses the mode-specific contract with the shared renderer and message builder", () => {
    const independent = buildWritingContext(input());
    const chapter = buildWritingContext(input({
      mode: "chapter",
      observation: { ...input().observation, route: "chapter-chat", mode: "chapter", chapterScopePresent: true },
    }));

    expect(independent.system).toContain(INDEPENDENT_MODE_CONTRACT);
    expect(chapter.system).toContain(CHAPTER_MODE_CONTRACT);
    expect(sectionKinds(independent.system)).toEqual(sectionKinds(chapter.system));
    expect(independent.messages).toEqual(chapter.messages);
  });

  it("normalizes an empty, duplicated, or non-final current user to one final user message", () => {
    const currentUser: ChatMessage = { role: "assistant", content: "" };
    const request = buildWritingContext(input({
      history: [
        { role: "user", content: "历史" },
        currentUser,
        { role: "assistant", content: "历史答复" },
        currentUser,
      ],
      currentUser,
    }));

    expect(request.messages).toEqual([
      { role: "user", content: "历史" },
      { role: "assistant", content: "历史答复" },
      { role: "user", content: "" },
    ]);
    expect(request.observation.currentUserIndices).toEqual([2]);
  });

  it("removes a structurally equal current user copy while preserving different replayable history", () => {
    const currentUser: ChatMessage = { role: "user", content: "本轮请求" };
    const request = buildWritingContext(input({
      history: [
        { role: "user", content: "较早且不同的请求" },
        { role: "user", content: "本轮请求" },
        { role: "assistant", content: "历史回答" },
      ],
      currentUser,
      currentUserHistoryIndex: 1,
    }));

    expect(request.messages).toEqual([
      { role: "user", content: "较早且不同的请求" },
      { role: "assistant", content: "历史回答" },
      { role: "user", content: "本轮请求" },
    ]);
    expect(request.messages.filter((message) => message.role === "user" && message.content === "本轮请求"))
      .toHaveLength(1);
  });

  it("keeps owner facts explicit and does not invent unowned novel context", () => {
    const owned = buildWritingContext(input({
      sections: [{ kind: "owner_context", content: "[设定] 当前作品的角色" }],
      observation: { ...input().observation, novelScopePresent: true, ownerScopeResolved: true },
    }));
    const unowned = buildWritingContext(input({
      observation: { ...input().observation, novelScopePresent: false, ownerScopeResolved: false },
    }));

    expect(owned.system).toContain("【owner_context】\n[设定] 当前作品的角色");
    expect(unowned.system).not.toContain("【owner_context】");
    expect(unowned.observation).toMatchObject({ novelScopePresent: false, ownerScopeResolved: false });
  });

  it("returns the existing provider request shape", () => {
    const request = buildWritingContext(input());

    expect(request).toMatchObject({
      model: "deepseek-v4-flash",
      system: expect.any(String),
      messages: expect.any(Array),
      observation: expect.any(Object),
    });
  });
});
