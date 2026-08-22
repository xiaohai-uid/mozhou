import { describe, expect, it } from "vitest";
import {
  canApplyChapterCandidate,
  normalizeCandidateStatus,
  resolveChapterCandidateContent,
  settleChapterCandidate,
  type CandidateStatus,
} from "@/lib/novels/chapter-candidate";

describe("chapter candidate lifecycle", () => {
  it.each<[CandidateStatus, CandidateStatus]>([
    ["done", "completed_candidate"],
    ["completed_candidate", "completed_candidate"],
    ["applied", "applied"],
    ["generating", "generating"],
    ["stopped", "stopped"],
    ["error", "error"],
  ])("normalizes persisted candidate status %s to %s", (stored, expected) => {
    expect(normalizeCandidateStatus({ status: stored, inserted: false })).toBe(expected);
  });

  it("settles successful, stopped, and failed providers into explicit persisted states", () => {
    expect(settleChapterCandidate({ providerSucceeded: true, stopped: false })).toEqual({
      status: "completed_candidate",
      errorMessage: null,
    });
    expect(settleChapterCandidate({ providerSucceeded: false, stopped: true })).toEqual({
      status: "stopped",
      errorMessage: null,
    });
    expect(settleChapterCandidate({ providerSucceeded: false, stopped: false, errorMessage: "upstream failed" })).toEqual({
      status: "error",
      errorMessage: "upstream failed",
    });
    expect(
      settleChapterCandidate({
        providerSucceeded: false,
        stopped: false,
        errorMessage: "免费模型不可用",
        errorCode: "FREE_UNAVAILABLE",
      }),
    ).toEqual({
      status: "error",
      errorMessage: "免费模型不可用",
      errorCode: "FREE_UNAVAILABLE",
    });
  });

  it("allows application for owner-scoped completed candidates regardless of content drift since generation", () => {
    // 基线过期不再拒绝（2026-08-22）：多候选顺序插入是核心工作流，
    // 内容漂移由 expectedContent 确认 + force + CAS 三层防护，基线守卫属重复设防。
    expect(
      canApplyChapterCandidate({
        candidateUserId: 7,
        requesterUserId: 7,
        status: "completed_candidate",
        content: "candidate",
      }),
    ).toEqual({ ok: true });

    expect(
      canApplyChapterCandidate({
        candidateUserId: 7,
        requesterUserId: 7,
        status: "stopped",
        content: "partial candidate",
      }),
    ).toEqual({ ok: false, reason: "status" });

    expect(
      canApplyChapterCandidate({
        candidateUserId: 8,
        requesterUserId: 7,
        status: "completed_candidate",
        content: "candidate",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      canApplyChapterCandidate({
        candidateUserId: 7,
        requesterUserId: 7,
        status: "generating",
        content: "candidate",
      }),
    ).toEqual({ ok: false, reason: "status" });
    expect(
      canApplyChapterCandidate({
        candidateUserId: 7,
        requesterUserId: 7,
        status: "completed_candidate",
        content: " ",
      }),
    ).toEqual({ ok: false, reason: "content" });
  });

  it("uses immutable candidate content for original confirmation and explicit text for edited confirmation", () => {
    expect(
      resolveChapterCandidateContent({
        mode: "original",
        originalContent: "原始候选",
        editedContent: "客户端伪造内容",
      }),
    ).toEqual({ ok: true, content: "原始候选" });
    expect(
      resolveChapterCandidateContent({
        mode: "edited",
        originalContent: "原始候选",
        editedContent: "编辑后的候选",
      }),
    ).toEqual({ ok: true, content: "编辑后的候选" });
    expect(
      resolveChapterCandidateContent({
        mode: "edited",
        originalContent: "原始候选",
      }),
    ).toEqual({ ok: false, reason: "content" });
  });
});
