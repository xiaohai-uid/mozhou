import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  buildPayloadObservation,
  getCapturedChatRequests,
  getLastPayloadObservation,
  resetPayloadObservations,
} from "@/lib/chat/payload";
import { makeChatProvider } from "@/lib/chat/stream-provider";
import { createLlmTransportFromEnv } from "@/lib/chat/llm-transport";

describe("final chat payload observability", () => {
  const originalCapture = process.env.CHAT_CAPTURE;
  const originalProvider = process.env.CHAT_PROVIDER;

  beforeEach(() => {
    process.env.CHAT_CAPTURE = "1";
    process.env.CHAT_PROVIDER = "mock";
    resetPayloadObservations();
  });

  afterEach(() => {
    resetPayloadObservations();
    if (originalCapture === undefined) delete process.env.CHAT_CAPTURE;
    else process.env.CHAT_CAPTURE = originalCapture;
    if (originalProvider === undefined) delete process.env.CHAT_PROVIDER;
    else process.env.CHAT_PROVIDER = originalProvider;
  });

  it("derives sections, current user, and final history count from the final request", () => {
    const observation = buildPayloadObservation({
      model: "test-model",
      system: "【base_identity】\nidentity\n\n【not_a_section_secret】\ncontext body\n\n【skill】\nskill body",
      messages: [
        { role: "assistant", content: "history" },
        { role: "user", content: "current user" },
      ],
      observation: {
        route: "chat",
        mode: "independent",
        historyCountBefore: 99,
        historyCountAfter: 0,
        compressionApplied: false,
        ragEntryCount: 0,
        stylePresent: false,
        skillCount: 0,
        novelScopePresent: false,
        chapterScopePresent: false,
        ownerScopeResolved: true,
        currentUserIndices: [1],
        systemSections: ["caller_supplied_section"],
      },
    });

    expect(observation).toMatchObject({
      system_sections: ["base_identity", "skill"],
      message_roles: ["assistant", "user"],
      history_count_after: 2,
      current_user_present: true,
      current_user_occurrences: 1,
    });
    expect(JSON.stringify(observation)).not.toContain("not_a_section_secret");
  });

  it("counts only valid current-user markers from the final request", () => {
    const observation = buildPayloadObservation({
      model: "test-model",
      messages: [
        { role: "user", content: "history user" },
        { role: "assistant", content: "history assistant" },
        { role: "user", content: "current user" },
      ],
      observation: {
        route: "chat",
        mode: "independent",
        historyCountBefore: 2,
        historyCountAfter: 3,
        compressionApplied: false,
        ragEntryCount: 0,
        stylePresent: false,
        skillCount: 0,
        novelScopePresent: false,
        chapterScopePresent: false,
        ownerScopeResolved: true,
        currentUserIndices: [2, 2, 99],
        systemSections: [],
      },
    });

    expect(observation.current_user_occurrences).toBe(1);
    expect(observation.current_user_present).toBe(true);
  });

  it("captures the exact final system and messages before provider consumption", async () => {
    const provider = makeChatProvider({
      model: "test-model",
      system: "system sentinel",
      messages: [
        { role: "assistant", content: "history" },
        { role: "user", content: "current user" },
      ],
      observation: {
        route: "chat",
        mode: "independent",
        historyCountBefore: 2,
        historyCountAfter: 2,
        compressionApplied: false,
        ragEntryCount: 0,
        stylePresent: false,
        skillCount: 0,
        novelScopePresent: false,
        chapterScopePresent: false,
        ownerScopeResolved: true,
        currentUserIndices: [1],
        systemSections: ["injected_context"],
      },
    }, createLlmTransportFromEnv());

    for await (const _delta of provider.stream()) {
      // 消费整个流，确保捕获发生在真实 provider 调用路径中。
    }

    expect(getCapturedChatRequests()).toMatchObject([
      {
        model: "test-model",
        system: "system sentinel",
        messages: [
          { role: "assistant", content: "history" },
          { role: "user", content: "current user" },
        ],
      },
    ]);
  });

  it("records the known empty-context state without inventing a behavior fix", async () => {
    const provider = makeChatProvider({
      model: "test-model",
      system: "",
      messages: [],
      observation: {
        route: "chapter-chat",
        mode: "chapter",
        historyCountBefore: 0,
        historyCountAfter: 0,
        compressionApplied: false,
        ragEntryCount: 0,
        stylePresent: false,
        skillCount: 0,
        novelScopePresent: true,
        chapterScopePresent: true,
        ownerScopeResolved: true,
        currentUserIndices: [],
        systemSections: [],
      },
    }, createLlmTransportFromEnv());

    for await (const _delta of provider.stream()) {
      // Keep the test at the provider seam rather than asserting mock text.
    }

    expect(getLastPayloadObservation()).toMatchObject({
      payload_schema_version: "v1",
      system_present: false,
      message_count: 0,
      message_roles: [],
      current_user_present: false,
      current_user_occurrences: 0,
      route: "chapter-chat",
      mode: "chapter",
    });
  });

  it("keeps production observation free of prompt and message content", async () => {
    const provider = makeChatProvider({
      model: "test-model",
      system: "secret prompt sentinel",
      messages: [{ role: "user", content: "secret body sentinel" }],
      observation: {
        route: "chat",
        mode: "independent",
        historyCountBefore: 1,
        historyCountAfter: 1,
        compressionApplied: false,
        ragEntryCount: 1,
        stylePresent: true,
        skillCount: 1,
        novelScopePresent: true,
        chapterScopePresent: false,
        ownerScopeResolved: true,
        currentUserIndices: [0],
        systemSections: ["injected_context"],
      },
    }, createLlmTransportFromEnv());
    for await (const _delta of provider.stream()) {
      // no-op
    }

    const observation = JSON.stringify(getLastPayloadObservation());
    expect(observation).not.toContain("secret prompt sentinel");
    expect(observation).not.toContain("secret body sentinel");
    expect(getLastPayloadObservation()).toMatchObject({
      rag_entry_count: 1,
      style_present: true,
      skill_count: 1,
    });
  });

  it("does not let a failing observer interrupt provider streaming", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalLog = process.env.CHAT_OBSERVER_LOG;
    const originalInfo = console.info;
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    process.env.CHAT_OBSERVER_LOG = "1";
    console.info = () => {
      throw new Error("observer sink unavailable");
    };

    try {
      const provider = makeChatProvider({
        model: "test-model",
        system: "safe system",
        messages: [{ role: "user", content: "safe message" }],
        observation: {
          route: "chat",
          mode: "independent",
          historyCountBefore: 1,
          historyCountAfter: 1,
          compressionApplied: false,
          ragEntryCount: 0,
          stylePresent: false,
          skillCount: 0,
          novelScopePresent: false,
          chapterScopePresent: false,
          ownerScopeResolved: true,
          currentUserIndices: [0],
          systemSections: ["injected_context"],
        },
      }, createLlmTransportFromEnv());
      const deltas = [];
      for await (const delta of provider.stream()) deltas.push(delta);
      expect(deltas.some((delta) => "text" in delta)).toBe(true);
      expect(getCapturedChatRequests()).toHaveLength(0);
    } finally {
      console.info = originalInfo;
      if (originalNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = originalNodeEnv;
      if (originalLog === undefined) delete process.env.CHAT_OBSERVER_LOG;
      else process.env.CHAT_OBSERVER_LOG = originalLog;
    }
  });
});
