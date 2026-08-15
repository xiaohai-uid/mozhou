// GenerationManifest：白名单脱敏（契约 §5）
import { describe, it, expect } from "vitest";
import { buildGenerationManifest } from "@/lib/runtime/generation-manifest";
import type { SkillRun } from "@/lib/runtime/types";

const appliedRun: SkillRun = {
  runId: "r-1",
  generationId: "g-1",
  skillKey: "story_grounding",
  status: "completed",
  inputRefs: [],
  outputRefs: [],
  promptSection: { kind: "owner_context", tokens: 12 },
  evidence: "applied",
  reason: null,
  executedAt: "2026-08-15T00:00:00.000Z",
};

const skippedRun: SkillRun = {
  runId: "r-2",
  generationId: "g-1",
  skillKey: "quality_gate",
  status: "skipped",
  inputRefs: [],
  outputRefs: [],
  promptSection: null,
  evidence: "not_applied",
  reason: "当前请求是剧情讨论，不生成正文",
  executedAt: "2026-08-15T00:00:00.000Z",
};

describe("buildGenerationManifest", () => {
  it("只记录 applied 的 SkillRun（脱敏子集）", () => {
    const m = buildGenerationManifest({
      generationId: "g-1",
      requestId: "g-1",
      model: "deepseek-v4-flash",
      sections: [{ kind: "owner_context", content: "[人物] 阿雀" }],
      messageRoles: ["user", "assistant"],
      runs: [appliedRun, skippedRun],
      currentUserPresent: true,
    });
    expect(m.skillRuns).toEqual([{ runId: "r-1", skillKey: "story_grounding", evidence: "applied" }]);
  });

  it("绝不记录正文/prompt：sections 只有 kind + tokens", () => {
    const m = buildGenerationManifest({
      generationId: "g-1",
      requestId: "g-1",
      model: "m",
      sections: [
        { kind: "owner_context", content: "秘密内容不应出现在 manifest 中" },
        { kind: "style", content: "风格内容" },
      ],
      messageRoles: ["user"],
      runs: [appliedRun],
      currentUserPresent: true,
    });
    const json = JSON.stringify(m);
    expect(json).not.toContain("秘密内容");
    expect(json).not.toContain("风格内容");
    expect(m.sections[0]).toEqual({ kind: "owner_context", tokens: 10 });
  });

  it("空区段被过滤；空 runs → skillRuns 空数组", () => {
    const m = buildGenerationManifest({
      generationId: "g",
      requestId: "g",
      model: "m",
      sections: [{ kind: "owner_context", content: "  " }],
      messageRoles: ["user"],
      runs: [],
      currentUserPresent: false,
    });
    expect(m.sections).toHaveLength(0);
    expect(m.skillRuns).toHaveLength(0);
    expect(m.currentUserPresent).toBe(false);
  });
});
