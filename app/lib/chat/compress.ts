// 上下文自动压缩（12 工单）：会话历史超阈值 → 早期消息摘要化，保留近期原文。
import type { ChatMessage } from "./payload";
import { DEFAULT_MODEL } from "./models";
import type { CompletionAdapter } from "./llm-transport";

/** 上下文窗口（对齐 UI 上下文面板 8K） */
export const CONTEXT_MAX_TOKENS = 8000;
/** 压缩触发阈值（70%） */
export const CONTEXT_TRIGGER_RATIO = 0.7;
/** 压缩后保留的近期原文条数 */
export const KEEP_RECENT = 6;
/** 摘要目标长度 */
export const SUMMARY_MAX_CHARS = 200;

/** 只接受原历史的近期后缀，压缩器返回异常结构时由 consumer fail-open。 */
export function isUsableKeptHistory(
  source: ChatMessage[],
  candidate: unknown,
): candidate is ChatMessage[] {
  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.length > KEEP_RECENT ||
    candidate.length > source.length
  ) {
    return false;
  }
  const offset = source.length - candidate.length;
  return candidate.every((message, index) => {
    if (!message || typeof message !== "object") return false;
    const item = message as Partial<ChatMessage>;
    const expected = source[offset + index];
    return (
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string" &&
      item.role === expected?.role &&
      item.content === expected?.content
    );
  });
}

/** 粗略 token 估算：中文约 2 字/token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 历史总 token（消息级累计） */
export function historyTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/** 是否触发压缩（超 70% 窗口） */
export function shouldCompress(
  messages: ChatMessage[],
  maxTokens: number = CONTEXT_MAX_TOKENS,
  ratio: number = CONTEXT_TRIGGER_RATIO,
): boolean {
  return historyTokens(messages) > maxTokens * ratio;
}

/** 摘要提示词 */
const SUMMARY_PROMPT = `你是对话摘要器。将以下小说写作对话的历史消息压缩为 ${SUMMARY_MAX_CHARS} 字以内的摘要，保留：已确认的设定、人物状态、剧情进展、用户写作偏好。只输出摘要正文，不要解释。`;

/**
 * 压缩历史：早期消息（保留近期 KEEP_RECENT 条）生成摘要。
 * 返回 { summary, kept }：summary 为摘要文本（空串 = 无需压缩或失败），kept 为保留的近期原文。
 */
export async function compressHistory(
  messages: ChatMessage[],
  completionAdapter: CompletionAdapter,
): Promise<{ summary: string; kept: ChatMessage[] }> {
  const kept = messages.slice(-KEEP_RECENT);
  const early = messages.slice(0, Math.max(0, messages.length - KEEP_RECENT));
  if (early.length === 0) return { summary: "", kept };

  try {
    const result = await completionAdapter.complete({
      model: DEFAULT_MODEL,
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", content: early.map((m) => `${m.role}: ${m.content}`).join("\n\n") }],
    });
    const summary = result.text.trim();
    return {
      summary: summary ? `（历史摘要）${summary}` : "",
      kept,
    };
  } catch {
    // 摘要失败不阻断对话：降级为不压缩
    return { summary: "", kept };
  }
}
