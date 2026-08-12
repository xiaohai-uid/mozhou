import type { ChatMessage } from "@/lib/chat/payload";

export type ReplayableChapterStatus =
  | "done"
  | "generating"
  | "completed_candidate"
  | "stopped"
  | "error"
  | "applied"
  | "discarded";

export interface ReplayableChapterMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  status: ReplayableChapterStatus;
}

/** Persistent candidate rows are not themselves conversation history. */
export function isReplayableChapterMessage(message: ReplayableChapterMessage): boolean {
  return (
    (message.role === "user" && message.status === "done") ||
    (message.role === "assistant" &&
      (message.status === "completed_candidate" || message.status === "applied"))
  );
}

/**
 * Builds only historical provider messages. `writing-context` appends the
 * current user message, so it cannot be duplicated by persisted rows.
 */
export function buildChapterReplayHistory(
  rows: ReplayableChapterMessage[],
  currentUserMessageId: number,
  currentCandidateId?: number,
): ChatMessage[] {
  return rows
    .filter(
      (message) =>
        message.id !== currentUserMessageId &&
        message.id !== currentCandidateId &&
        isReplayableChapterMessage(message),
    )
    .map((message) => ({ role: message.role, content: message.content }));
}
