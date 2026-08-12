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
  return (
    "以下是作者小说设定库中与当前写作相关的参考资料，写作时必须遵守，不得写崩设定：\n" +
    injected.map((s) => `- ${s}`).join("\n")
  );
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
