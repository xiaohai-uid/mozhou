// User-facing AI error mapping (P0-C).
// Stable chapter error codes are converted here to safe Chinese copy.
// Provider internals / raw exception strings must never leak to end users.

export type UserFacingAiErrorKind =
  | "network"
  | "timeout"
  | "free_unavailable"
  | "rate_limited"
  | "no_api_key"
  | "server_error"
  | "invalid_response"
  | "protocol_error"
  | "cancelled"
  | "content_changed"
  | "chapter_not_found"
  | "unknown";

export type UserFacingAiError = {
  kind: UserFacingAiErrorKind;
  title: string;
  guidance: string;
  retryable: boolean;
};

export function toUserFacingAiError(
  code: string | null | undefined,
): UserFacingAiError {
  switch (code) {
    case "AiNoApiKey":
      return {
        kind: "no_api_key",
        title: "还没有配置 AI",
        guidance: "先选择模型并配置可用渠道。",
        retryable: false,
      };
    case "AiRateLimited":
    case "RATE_LIMITED":
      return {
        kind: "rate_limited",
        title: "请求太频繁",
        guidance: "模型暂时繁忙，稍后重试或切换模型。",
        retryable: true,
      };
    case "AiServerError":
      return {
        kind: "server_error",
        title: "模型暂时繁忙",
        guidance: "稍后重试或切换模型。",
        retryable: true,
      };
    case "AiTimeout":
      return {
        kind: "timeout",
        title: "AI 响应超时",
        guidance: "可以重新尝试。",
        retryable: true,
      };
    case "AiNetworkError":
      return {
        kind: "network",
        title: "网络连接失败",
        guidance: "请检查网络后重试。",
        retryable: true,
      };
    case "AiInvalidResponse":
      return {
        kind: "invalid_response",
        title: "AI 返回了无法理解的内容",
        guidance: "请重试，或切换模型。",
        retryable: true,
      };
    case "FREE_UNAVAILABLE":
      return {
        kind: "free_unavailable",
        title: "当前免费 AI 暂时不可用",
        guidance: "你仍可以自己继续写作，稍后再试。",
        retryable: true,
      };
    case "PROTOCOL_ERROR":
      return {
        kind: "protocol_error",
        title: "AI 响应不完整",
        guidance: "本次生成没有收到完整结果，请重试。",
        retryable: true,
      };
    case "AiCancelled":
      return {
        kind: "cancelled",
        title: "已取消生成",
        guidance: "生成已停止，你可以继续写作。",
        retryable: false,
      };
    case "ContentChanged":
      return {
        kind: "content_changed",
        title: "正文已经变化",
        guidance: "这条回复基于旧正文，请重新生成。",
        retryable: true,
      };
    case "ChapterNotFound":
      return {
        kind: "chapter_not_found",
        title: "章节不存在",
        guidance: "返回作品列表重新选择。",
        retryable: false,
      };
    default:
      return {
        kind: "unknown",
        title: "操作没有成功",
        guidance: "请稍后重试。",
        retryable: true,
      };
  }
}
