import { describe, expect, it } from "vitest";
import {
  buildChapterReplayHistory,
  isReplayableChapterMessage,
  type ReplayableChapterMessage,
} from "@/lib/novels/chapter-replay";
import { normalizePersistedChapterMessageStatus } from "@/lib/novels/chapter-candidate";

function row(overrides: Partial<ReplayableChapterMessage>): ReplayableChapterMessage {
  return {
    id: 1,
    role: "user",
    content: "message",
    status: "done",
    ...overrides,
  };
}

describe("chapter replay policy", () => {
  it("replays a legacy completed assistant only after candidate normalization", () => {
    const status = normalizePersistedChapterMessageStatus({
      role: "assistant",
      status: "done",
      inserted: false,
    });

    expect(
      buildChapterReplayHistory(
        [row({ role: "assistant", content: "legacy response", status })],
        99,
      ),
    ).toEqual([{ role: "assistant", content: "legacy response" }]);
  });

  it("does not normalize a user history row into an assistant candidate", () => {
    expect(
      normalizePersistedChapterMessageStatus({
        role: "user",
        status: "done",
        inserted: false,
      }),
    ).toBe("done");
  });

  it.each([
    [row({ role: "user", status: "done" }), true],
    [row({ role: "assistant", status: "completed_candidate" }), true],
    [row({ role: "assistant", status: "applied" }), true],
    [row({ role: "assistant", status: "generating" }), false],
    [row({ role: "assistant", status: "stopped" }), false],
    [row({ role: "assistant", status: "error" }), false],
    [row({ role: "assistant", status: "discarded" }), false],
    [row({ role: "user", status: "error" }), false],
  ])("replays only persisted conversation facts (%o)", (message, expected) => {
    expect(isReplayableChapterMessage(message)).toBe(expected);
  });

  it("excludes the current user and current candidate without treating persistence rows as history", () => {
    const history = buildChapterReplayHistory(
      [
        row({ id: 1, role: "user", content: "old user" }),
        row({ id: 2, role: "assistant", status: "completed_candidate", content: "old candidate" }),
        row({ id: 3, role: "assistant", status: "applied", content: "applied" }),
        row({ id: 4, role: "assistant", status: "generating", content: "live" }),
        row({ id: 5, role: "user", content: "current user" }),
        row({ id: 6, role: "assistant", status: "completed_candidate", content: "current candidate" }),
      ],
      5,
      6,
    );

    expect(history).toEqual([
      { role: "user", content: "old user" },
      { role: "assistant", content: "old candidate" },
      { role: "assistant", content: "applied" },
    ]);
  });
});
