export type ChapterStreamEvent =
  | { type: "start"; phase?: string; [key: string]: unknown }
  | { type: "phase"; phase?: string; [key: string]: unknown }
  | { type: "delta"; text?: string; [key: string]: unknown }
  | { type: "done"; messageId?: number; [key: string]: unknown }
  | { type: "error"; code?: string; message?: string; [key: string]: unknown };

export type ChapterStreamTerminal = "success" | "error" | "protocol_error";

/** Parse one complete SSE event. A malformed or non-object payload is a protocol error. */
export function parseChapterSseEvent(block: string): ChapterStreamEvent {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length !== 1 || !dataLines[0]) {
    throw new Error("PROTOCOL_ERROR: SSE event must contain one data payload");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines[0]);
  } catch {
    throw new Error("PROTOCOL_ERROR: SSE data is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
    throw new Error("PROTOCOL_ERROR: SSE event type is missing");
  }
  const type = (parsed as { type: string }).type;
  if (!["start", "phase", "delta", "done", "error"].includes(type)) {
    throw new Error(`PROTOCOL_ERROR: unknown SSE event type ${type}`);
  }
  return parsed as ChapterStreamEvent;
}

/** A 200 response is not success until exactly one terminal event is observed. */
export function classifyChapterStream(events: ChapterStreamEvent[]): ChapterStreamTerminal {
  const terminals = events.filter((event) => event.type === "done" || event.type === "error");
  if (terminals.length !== 1) return "protocol_error";
  return terminals[0]!.type === "done" ? "success" : "error";
}
