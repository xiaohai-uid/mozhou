import { describe, expect, it } from "vitest";
import { validateDeconstructionArtifacts } from "@/lib/story/deconstruction-artifacts";
import type { DeconstructionResult } from "@/lib/schema";

const valid: Partial<DeconstructionResult> = {
  mode: "short" as const,
  stages: [
    { stage: 0, name: "概要", status: "completed", artifact: { id: "s0", kind: "overview", schemaVersion: 1, premise: "p", chapterCount: 1, chapterIndex: [] } },
    { stage: 2, name: "摘要", status: "completed", artifact: { id: "s2", kind: "chapters", schemaVersion: 1, chapters: [] } },
    { stage: 3, name: "剧情", status: "completed", artifact: { id: "s3", kind: "plot", schemaVersion: 1, mainline: "m", subplots: [], units: [], foreshadowing: [], emotionCurve: [], coverage: 1 } },
    { stage: 4, name: "设定", status: "completed", artifact: { id: "s4", kind: "world", schemaVersion: 1, characters: [], worldview: [], factions: [], relationships: [] } },
    { stage: 5, name: "汇总", status: "completed", artifact: { id: "s5", kind: "aggregate", schemaVersion: 1, readerNeeds: [], emotionEngine: "e", writingTechniques: [], replicableModules: [], risks: [] } },
    { stage: 6, name: "文风", status: "completed", artifact: { id: "s6", kind: "style", schemaVersion: 1, sentence: "s", rhythm: "r", dialogue: "d", emotion: "e", techniques: [] } },
  ],
  quality: { sourceLength: 200, chapterCount: 1, completedStages: [0, 2, 3, 4, 5, 6], warnings: [] },
};

describe("deconstruction artifact contract", () => {
  it("accepts a complete short result", () => {
    expect(validateDeconstructionArtifacts(valid, "short")).toEqual([]);
  });

  it("rejects missing stable identity and wrong field types", () => {
    const broken = structuredClone(valid);
    broken.stages![0].artifact.id = 0 as never;
    broken.stages![3].artifact.characters = "not-an-array" as never;
    expect(validateDeconstructionArtifacts(broken, "short").join("\n")).toContain("artifact.id");
    expect(validateDeconstructionArtifacts(broken, "short").join("\n")).toContain("characters 必须为数组");
  });

  it("rejects incomplete quality metadata and non-completed stages", () => {
    const broken = structuredClone(valid);
    broken.quality!.sourceLength = 0;
    broken.quality!.completedStages = [0];
    broken.stages![0].status = "running" as never;
    const errors = validateDeconstructionArtifacts(broken, "short").join("\n");
    expect(errors).toContain("quality.sourceLength");
    expect(errors).toContain("quality.completedStages");
    expect(errors).toContain("status 必须为 completed");
  });
});
