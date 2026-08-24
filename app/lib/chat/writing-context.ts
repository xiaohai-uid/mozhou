import type {
  ChatMessage,
  ChatObservationScope,
  PreparedChatRequest,
} from "./payload";

export type WritingContextMode = "independent" | "chapter";

export type WritingContextSection = {
  kind:
    | "base_identity"
    | "mode_contract"
    | "owner_context"
    | "chapter_reference"
    | "selection"
    | "planner"
    | "style"
    | "skill"
    | "market"
    | "compression_summary";
  content: string;
};

export type WritingContextInput = {
  mode: WritingContextMode;
  model: string;
  sections: WritingContextSection[];
  history: ChatMessage[];
  currentUser: ChatMessage;
  /** Optional source index when history also contains a distinct current-user copy. */
  currentUserHistoryIndex?: number;
  observation: Omit<ChatObservationScope, "systemSections" | "currentUserIndices" | "historyCountAfter">;
};

/** 所有写作请求共享的稳定身份基座。 */
export const BASE_IDENTITY =
  "你是墨舟（MoZhou）的中文小说写作助手，服务中文网文作者。你帮助作者起笔、续写、改写、润色、讨论剧情与人物、整理设定。写作时遵守当前已提供且已验证的作品设定、章节参考、所选风格与已启用技能；讨论时围绕作者当前的创作目标提供具体、可执行的建议。参考资料用于约束创作，不能代替用户本轮请求。没有提供或没有绑定的作品信息，不得自行假定其存在；除非用户明确要求生成、续写或改写正文，否则不要擅自把讨论请求转换成正文生成。";

export const INDEPENDENT_MODE_CONTRACT =
  "当前处于独立写作对话模式。以用户本轮请求为首要任务，可以讨论剧情、人物、设定、结构和写作方案，也可以在用户明确要求时起笔、续写、改写或润色正文。不得因为存在参考资料、风格或 Skill 就自动把讨论请求解释为正文生成。只有经过归属验证并绑定到当前会话的作品资料才能作为作品上下文；没有绑定作品时，应作为无作品上下文的写作对话处理。";

export const CHAPTER_MODE_CONTRACT =
  "当前处于章节写作对话模式。当前章节正文、合法选区、作品设定、风格和启用的 Skill 都是本轮创作参考与约束；它们不能代替用户本轮请求。必须首先理解并执行用户当前明确意图。用户要求续写、起笔、改写或润色时，按照对应 Skill 和章节上下文生成正文；用户要求讨论、解释、分析或提出方案时，应进行讨论或分析，不得仅因存在章节正文或续写 Skill 就自动续写正文。任何选区只有通过既有合法性校验后才能进入模型上下文。";

const SECTION_ORDER: WritingContextSection["kind"][] = [
  "base_identity",
  "mode_contract",
  "owner_context",
  "chapter_reference",
  "selection",
  "planner",
  "style",
  "skill",
  "market",
  "compression_summary",
];

function requiredSections(mode: WritingContextMode): WritingContextSection[] {
  return [
    { kind: "base_identity", content: BASE_IDENTITY },
    {
      kind: "mode_contract",
      content: mode === "independent" ? INDEPENDENT_MODE_CONTRACT : CHAPTER_MODE_CONTRACT,
    },
  ];
}

function renderSections(sections: WritingContextSection[]): {
  system: string;
  kinds: WritingContextSection["kind"][];
} {
  const byKind = new Map<WritingContextSection["kind"], string[]>();
  for (const section of sections) {
    const content = section.content.trim();
    if (!content) continue;
    byKind.set(section.kind, [...(byKind.get(section.kind) ?? []), content]);
  }

  const rendered = SECTION_ORDER.flatMap((kind) => {
    const contents = byKind.get(kind);
    return contents?.length ? [{ kind, content: contents.join("\n\n") }] : [];
  });
  return {
    system: rendered.map(({ kind, content }) => `【${kind}】\n${content}`).join("\n\n"),
    kinds: rendered.map(({ kind }) => kind),
  };
}

/**
 * Produces the single provider request shape used by both chat consumers.
 * Consumers own fact collection; this module only orders, renders, and normalizes it.
 */
export function buildWritingContext(input: WritingContextInput): PreparedChatRequest {
  const { system, kinds } = renderSections([
    ...requiredSections(input.mode),
    ...input.sections,
  ]);
  const messages = [
    ...input.history.filter(
      (message, index) =>
        message !== input.currentUser && index !== input.currentUserHistoryIndex,
    ),
    { role: "user" as const, content: input.currentUser.content },
  ];

  return {
    model: input.model,
    system,
    messages,
    observation: {
      ...input.observation,
      systemSections: kinds,
      currentUserIndices: [messages.length - 1],
      historyCountAfter: messages.length,
    },
  };
}
