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

export class ChapterChatError extends Error {
  constructor(
    message: string,
    readonly code: ChapterChatErrorCode = "AiGenerationFailed",
  ) {
    super(message);
    this.name = "ChapterChatError";
  }
}
