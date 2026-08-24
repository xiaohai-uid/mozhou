import type { TaskErrorClass } from "@/lib/tasks/status";

export type ChapterChatErrorCode =
  | "FREE_UNAVAILABLE"
  | "AiNoApiKey"
  | "AiRateLimited"
  | "AiServerError"
  | "AiTimeout"
  | "AiNetworkError"
  | "AiInvalidResponse"
  | "AiCancelled"
  | "AiGenerationFailed";

type ErrorShape = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
};

function errorShape(value: unknown): ErrorShape {
  if (value && typeof value === "object") return value as ErrorShape;
  return { message: typeof value === "string" ? value : "" };
}

/** Convert provider/transport failures into the stable chapter SSE error vocabulary. */
export function classifyChapterChatError(value: unknown): ChapterChatErrorCode {
  const shape = errorShape(value);
  const code = typeof shape.code === "string" ? shape.code : "";
  const status = typeof shape.status === "number" ? shape.status : undefined;
  const message = typeof shape.message === "string" ? shape.message : "";
  const text = `${code} ${message}`.toLowerCase();

  if (code === "FREE_UNAVAILABLE") return "FREE_UNAVAILABLE";
  if (code === "AiCancelled" || text.includes("cancel")) return "AiCancelled";
  if (status === 401 || status === 403 || text.includes("no api key") || text.includes("unauthorized")) {
    return "AiNoApiKey";
  }
  if (status === 429 || text.includes("rate limit") || text.includes("rate_limited") || text.includes("限流")) {
    return "AiRateLimited";
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("超时")) return "AiTimeout";
  if (status !== undefined && status >= 500) return "AiServerError";
  if (text.includes("invalid completion") || text.includes("no completion") || text.includes("invalid response")) {
    return "AiInvalidResponse";
  }
  if (text.includes("network") || text.includes("fetch failed") || text.includes("econnrefused") || text.includes("socket")) {
    return "AiNetworkError";
  }
  return "AiGenerationFailed";
}

/** Map the stable chapter-stream code into the task runtime's audit taxonomy. */
export function classifyTaskError(value: unknown): TaskErrorClass {
  const shape = errorShape(value);
  const code = typeof shape.code === "string" ? shape.code : "";

  switch (code) {
    case "FREE_UNAVAILABLE":
    case "AiServerError":
      return "provider_unavailable";
    case "AiNetworkError":
      return "provider_network";
    case "AiRateLimited":
      return "provider_rate_limit";
    case "AiTimeout":
      return "provider_timeout";
    case "AiNoApiKey":
      return "provider_client_error";
    case "AiInvalidResponse":
      return "provider_protocol";
    case "AiCancelled":
      return "user_cancelled";
  }

  const text = typeof shape.message === "string" ? shape.message.toLowerCase() : "";
  if (text.includes("429") || text.includes("rate") || text.includes("限流")) return "provider_rate_limit";
  if (text.includes("timeout") || text.includes("超时")) return "provider_timeout";
  if (text.includes("401") || text.includes("403") || text.includes("404")) return "provider_client_error";
  return "provider_network";
}

export class ChapterChatError extends Error {
  constructor(
    message: string,
    readonly code: ChapterChatErrorCode = "AiGenerationFailed",
  ) {
    super(message);
    this.name = "ChapterChatError";
  }
}
