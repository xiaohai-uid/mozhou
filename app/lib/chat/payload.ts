import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRoute = "chat" | "chapter-chat";
export type ChatMode = "independent" | "chapter";

/**
 * 进入 provider 前的结构化请求。它描述最终要发送的 payload，
 * 但不会改变现有 prompt 或 message 的组装语义。
 */
export interface PreparedChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  observation: ChatObservationScope;
}

/** 只包含可用于结构化观测的 scope/context 元数据。 */
export interface ChatObservationScope {
  /** V1.3：技能运行时 generationId 锚点；manifest 与 PayloadObservation 共享同一 request_id。 */
  requestId?: string;
  route: ChatRoute;
  mode: ChatMode;
  historyCountBefore: number;
  historyCountAfter: number;
  compressionApplied: boolean;
  ragEntryCount: number;
  stylePresent: boolean;
  skillCount: number;
  novelScopePresent: boolean;
  chapterScopePresent: boolean;
  ownerScopeResolved: boolean;
  /** provider messages 中属于当前这轮请求的索引；不包含正文内容。 */
  currentUserIndices: number[];
  /** 当前 system 是聚合字符串，因此目前只能观察到一个注入区段。 */
  systemSections: string[];
}

export interface PayloadObservation {
  payload_schema_version: "v1";
  request_id: string;
  route: ChatRoute;
  mode: ChatMode;
  model: string;
  system_present: boolean;
  system_sections: string[];
  message_count: number;
  message_roles: ChatMessage["role"][];
  history_count_before: number;
  history_count_after: number;
  current_user_present: boolean;
  current_user_occurrences: number;
  compression_applied: boolean;
  rag_entry_count: number;
  style_present: boolean;
  skill_count: number;
  novel_scope_present: boolean;
  chapter_scope_present: boolean;
  owner_scope_resolved: boolean;
}

export interface CapturedChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  observation: PayloadObservation;
};

const capturedRequests: CapturedChatRequest[] = [];
let lastObservation: PayloadObservation | undefined;
const OBSERVABLE_SYSTEM_SECTIONS = new Set([
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
]);

/**
 * Capturing 只允许 NODE_ENV=test 且由测试显式打开。
 */
export function isPayloadCaptureEnabled(): boolean {
  return (
    process.env.CHAT_CAPTURE === "1" &&
    process.env.NODE_ENV === "test"
  );
}

/** 将最终请求转换成生产可记录的白名单结构，绝不包含正文或 prompt。 */
export function buildPayloadObservation(request: PreparedChatRequest): PayloadObservation {
  const messages = request.messages;
  const currentUserOccurrences = new Set(request.observation.currentUserIndices).size
    ? [...new Set(request.observation.currentUserIndices)].filter(
        (index) => Number.isInteger(index) && index >= 0 && index < messages.length && messages[index]?.role === "user",
      ).length
    : 0;
  const systemPresent = Boolean(request.system);
  const systemSections = systemPresent
    ? [...request.system!.matchAll(/^【([^】\r\n]+)】$/gm)]
      .map((match) => match[1]!)
      .filter((section) => OBSERVABLE_SYSTEM_SECTIONS.has(section))
    : [];

  return {
    payload_schema_version: "v1",
    request_id: request.observation.requestId ?? randomUUID(),
    route: request.observation.route,
    mode: request.observation.mode,
    model: request.model,
    system_present: systemPresent,
    system_sections: systemSections,
    message_count: messages.length,
    message_roles: messages.map((message) => message.role),
    history_count_before: request.observation.historyCountBefore,
    history_count_after: messages.length,
    current_user_present: currentUserOccurrences > 0,
    current_user_occurrences: currentUserOccurrences,
    compression_applied: request.observation.compressionApplied,
    rag_entry_count: request.observation.ragEntryCount,
    style_present: request.observation.stylePresent,
    skill_count: request.observation.skillCount,
    novel_scope_present: request.observation.novelScopePresent,
    chapter_scope_present: request.observation.chapterScopePresent,
    owner_scope_resolved: request.observation.ownerScopeResolved,
  };
}

/**
 * 记录脱敏结构。任何观测异常都必须被吞掉，不能改变 SSE 或 provider 语义。
 */
export function observePreparedChatRequest(request: PreparedChatRequest): void {
  try {
    const observation = buildPayloadObservation(request);
    if (isPayloadCaptureEnabled()) lastObservation = observation;

    const observerFile = process.env.CHAT_OBSERVER_FILE;
    if (observerFile) appendFileSync(observerFile, `${JSON.stringify(observation)}\n`, "utf8");

    // 测试默认不污染输出；生产或显式打开日志时写入结构化日志。
    if (
      process.env.NODE_ENV !== "test" &&
      (process.env.NODE_ENV === "production" || process.env.CHAT_OBSERVER_LOG === "1")
    ) {
      console.info(JSON.stringify({ event: "chat_payload_observed", ...observation }));
    }
  } catch {
    // Observability is best-effort and must never block the request.
  }
}

/** Capturing Provider 使用：保存测试环境中的最终 system/messages。 */
export function capturePreparedChatRequest(request: PreparedChatRequest): void {
  if (!isPayloadCaptureEnabled()) return;
  try {
    const captured: CapturedChatRequest = {
      model: request.model,
      system: request.system,
      messages: request.messages.map((message) => ({ ...message })),
      observation: buildPayloadObservation(request),
    };
    capturedRequests.push(captured);

  } catch {
    // 测试捕获失败也不能改变被测 provider 的行为。
  }
}

export function getCapturedChatRequests(): CapturedChatRequest[] {
  return capturedRequests.map((request) => ({
    ...request,
    messages: request.messages.map((message) => ({ ...message })),
    observation: { ...request.observation, message_roles: [...request.observation.message_roles] },
  }));
}

export function getLastPayloadObservation(): PayloadObservation | undefined {
  return lastObservation ? { ...lastObservation, message_roles: [...lastObservation.message_roles] } : undefined;
}

export function resetPayloadObservations(): void {
  capturedRequests.length = 0;
  lastObservation = undefined;
}
