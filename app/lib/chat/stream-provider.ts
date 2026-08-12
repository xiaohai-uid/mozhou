// 对话 LLM 提供者：one-api 网关 SSE 流（真实现）+ mock（测试用，env CHAT_PROVIDER=mock 切换）
import type { StreamProvider, StreamDelta } from "@/lib/pipeline/engine";
import {
  capturePreparedChatRequest,
  isPayloadCaptureEnabled,
  observePreparedChatRequest,
  type PreparedChatRequest,
} from "./payload";

/** 组装 system 消息：RAG 注入的"参考资料"节（06 工单） */
export function buildSystemPrompt(injected: string[]): string {
  if (injected.length === 0) return "";
  return injected
    .map((value) => {
      const section = value.startsWith("[正文参考]")
        ? "chapter_reference"
        : value.startsWith("[所选片段]")
          ? "validated_selection"
          : value.startsWith("[风格]")
            ? "style"
            : value.startsWith("[技能]")
              ? "skill"
              : value.startsWith("（历史摘要）")
                ? "compression_summary"
                : "novel_context";
      return `【${section}】\n${value}`;
    })
    .join("\n\n");
}

/** 独立写作对话的稳定身份基座，不依赖作品、风格、技能或 RAG。 */
export const BASE_IDENTITY =
  "你是墨舟（MoZhou）的中文小说写作助手，服务中文网文作者。你帮助作者起笔、续写、改写、润色、讨论剧情与人物、整理设定。写作时遵守当前已提供且已验证的作品设定、章节参考、所选风格与已启用技能；讨论时围绕作者当前的创作目标提供具体、可执行的建议。参考资料用于约束创作，不能代替用户本轮请求。没有提供或没有绑定的作品信息，不得自行假定其存在；除非用户明确要求生成、续写或改写正文，否则不要擅自把讨论请求转换成正文生成。";

/** 独立写作对话的模式边界，防止注入资料把讨论请求改写成正文生成。 */
export const INDEPENDENT_MODE_CONTRACT =
  "当前处于独立写作对话模式。以用户本轮请求为首要任务，可以讨论剧情、人物、设定、结构和写作方案，也可以在用户明确要求时起笔、续写、改写或润色正文。不得因为存在参考资料、风格或 Skill 就自动把讨论请求解释为正文生成。只有经过归属验证并绑定到当前会话的作品资料才能作为作品上下文；没有绑定作品时，应作为无作品上下文的写作对话处理。";

/** 章节写作对话的模式边界，保留本轮明确意图优先级。 */
export const CHAPTER_MODE_CONTRACT =
  "当前处于章节写作对话模式。当前章节正文、合法选区、作品设定、风格和启用的 Skill 都是本轮创作参考与约束；它们不能代替用户本轮请求。必须首先理解并执行用户当前明确意图。用户要求续写、起笔、改写或润色时，按照对应 Skill 和章节上下文生成正文；用户要求讨论、解释、分析或提出方案时，应进行讨论或分析，不得仅因存在章节正文或续写 Skill 就自动续写正文。任何选区只有通过既有合法性校验后才能进入模型上下文。";

/** 独立对话始终带身份与模式，再叠加现有参考资料。 */
export function buildIndependentSystemPrompt(injected: string[]): string {
  const references = buildSystemPrompt(injected);
  return [
    `【base_identity】\n${BASE_IDENTITY}`,
    `【mode_contract】\n${INDEPENDENT_MODE_CONTRACT}`,
    references,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 章节对话始终带身份与章节模式，再叠加已校验的参考资料。 */
export function buildChapterSystemPrompt(injected: string[]): string {
  const references = buildSystemPrompt(injected);
  return [
    `【base_identity】\n${BASE_IDENTITY}`,
    `【mode_contract】\n${CHAPTER_MODE_CONTRACT}`,
    references,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** one-api 网关（OpenAI 兼容 SSE 流） */
export class OneApiStreamProvider implements StreamProvider {
  constructor(
    private opts: PreparedChatRequest & {
      baseUrl: string;
      token: string;
    },
  ) {}

  async *stream(): AsyncIterable<StreamDelta> {
    const messages = [
      ...(this.opts.system ? [{ role: "system" as const, content: this.opts.system }] : []),
      ...this.opts.messages,
    ];
    const res = await fetch(`${this.opts.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.token}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        stream: true,
        messages,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`网关错误 ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield { text: content };
        if (chunk.usage) {
          yield {
            usage: {
              prompt: chunk.usage.prompt_tokens ?? 0,
              completion: chunk.usage.completion_tokens ?? 0,
            },
          };
        }
      }
    }
  }
}

/** 固定流 mock（契约测试用，确定性输出） */
export class MockChatProvider implements StreamProvider {
  constructor(private request: PreparedChatRequest) {}
  async *stream(): AsyncIterable<StreamDelta> {
    // 回显 system 提示（若有注入：RAG/风格/技能/压缩），让注入成为可断言的外部行为（工单 15）
    if (this.request.system) {
      yield { text: `（已注入：${this.request.system}）` };
    }
    for (const piece of ["你好，我是墨舟。", "（模拟流式输出）"]) {
      yield { text: piece };
    }
    yield { usage: { prompt: 42, completion: 17 } };
  }
}

/** 按环境选择 provider：测试注入 CHAT_PROVIDER=mock，生产默认 one-api 网关 */
export function makeChatProvider(
  request: PreparedChatRequest,
): StreamProvider {
  observePreparedChatRequest(request);

  const provider =
    process.env.CHAT_PROVIDER === "mock"
      ? new MockChatProvider(request)
      : new OneApiStreamProvider({
          ...request,
          baseUrl: process.env.ONEAPI_BASE_URL ?? "http://localhost:3001",
          token: process.env.ONEAPI_TOKEN ?? "",
        });

  if (isPayloadCaptureEnabled()) {
    return new CapturingChatProvider(request, provider);
  }
  return provider;
}

/** 测试专用 provider wrapper：捕获 provider 消费前的完整最终请求。 */
export class CapturingChatProvider implements StreamProvider {
  constructor(
    private request: PreparedChatRequest,
    private delegate: StreamProvider,
  ) {}

  async *stream(): AsyncIterable<StreamDelta> {
    capturePreparedChatRequest(this.request);
    yield* this.delegate.stream();
  }
}
