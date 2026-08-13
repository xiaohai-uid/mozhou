import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRoute = "chat" | "chapter-chat";
export type ChatMode = "independent" | "chapter";

/** Provider 实际消费的 HTTP payload；与语义层 PreparedChatRequest 分离。 */
export interface ProviderWirePayload {
  model: string;
  stream: boolean;
  messages: ChatMessage[];
  temperature?: number;
}

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
  system_char_count: number;
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
  wirePayload: ProviderWirePayload;
  observation: PayloadObservation;
};

const capturedRequests: CapturedChatRequest[] = [];
let lastObservation: PayloadObservation | undefined;

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
export function buildPayloadObservation(
  request: PreparedChatRequest,
  wirePayload: ProviderWirePayload,
): PayloadObservation {
  const semanticMessages = request.messages;
  const wireMessages = wirePayload.messages;
  const systemPresent = wireMessages[0]?.role === "system";
  const wireEnvelopeLength = systemPresent ? 1 : 0;
  const wireMessagesWithoutSystem = wireMessages.slice(wireEnvelopeLength);
  const systemEnvelopeMatchesSemanticRequest = systemPresent === Boolean(request.system);
  const wireMatchesSemanticMessages =
    wireMessagesWithoutSystem.length === semanticMessages.length &&
    wireMessagesWithoutSystem.every((message, index) => {
      const semanticMessage = semanticMessages[index];
      return (
        semanticMessage !== undefined &&
        message.role === semanticMessage.role &&
        message.content === semanticMessage.content
      );
    });
  const semanticCurrentUserPresent = semanticMessages.at(-1)?.role === "user";
  const wireCurrentUserPresent = wireMessagesWithoutSystem.at(-1)?.role === "user";
  const currentUserPresent =
    systemEnvelopeMatchesSemanticRequest &&
    wireMatchesSemanticMessages &&
    semanticCurrentUserPresent &&
    wireCurrentUserPresent;
  const currentUserOccurrences = currentUserPresent ? 1 : 0;

  return {
    payload_schema_version: "v1",
    request_id: randomUUID(),
    route: request.observation.route,
    mode: request.observation.mode,
    model: wirePayload.model,
    system_present: systemPresent,
    system_sections: systemPresent ? request.observation.systemSections : [],
    system_char_count: request.system?.length ?? 0,
    message_count: wireMessagesWithoutSystem.length,
    message_roles: wireMessagesWithoutSystem.map((message) => message.role),
    history_count_before: request.observation.historyCountBefore,
    history_count_after: request.observation.historyCountAfter,
    current_user_present: currentUserPresent,
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

/** 在 provider wire payload 已生成后记录最终结构。 */
export function observePreparedChatRequestWithWire(
  request: PreparedChatRequest,
  wirePayload: ProviderWirePayload,
): void {
  try {
    const observation = buildPayloadObservation(request, wirePayload);
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
export function capturePreparedChatRequest(
  request: PreparedChatRequest,
  wirePayload: ProviderWirePayload,
): void {
  if (!isPayloadCaptureEnabled()) return;
  try {
    const captured: CapturedChatRequest = {
      model: request.model,
      system: request.system,
      messages: request.messages.map((message) => ({ ...message })),
      wirePayload: {
        ...wirePayload,
        messages: wirePayload.messages.map((message) => ({ ...message })),
      },
      observation: buildPayloadObservation(request, wirePayload),
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
    wirePayload: { ...request.wirePayload, messages: request.wirePayload.messages.map((message) => ({ ...message })) },
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
