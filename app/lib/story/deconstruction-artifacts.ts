import type { DeconstructionArtifact, DeconstructionMode, DeconstructionResult } from "@/lib/schema";

export const REQUIRED_FIELDS: Record<number, string[]> = {
  0: ["premise", "chapterCount", "chapterIndex"],
  1: ["goldenChapters"],
  2: ["chapters"],
  3: ["mainline", "subplots", "units", "foreshadowing", "emotionCurve", "coverage"],
  4: ["characters", "worldview", "factions", "relationships"],
  5: ["readerNeeds", "emotionEngine", "writingTechniques", "replicableModules", "risks"],
  6: ["sentence", "rhythm", "dialogue", "emotion", "techniques"],
};

export function requiredStages(mode: DeconstructionMode): number[] {
  return mode === "long" ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 3, 4, 5, 6];
}

export function validateDeconstructionArtifacts(
  result: Partial<DeconstructionResult>,
  expectedMode: DeconstructionMode,
): string[] {
  const errors: string[] = [];
  if (result.mode !== expectedMode) errors.push(`mode 必须为 ${expectedMode}`);
  const stages = Array.isArray(result.stages) ? result.stages : [];
  const ids = stages.map((stage) => stage?.stage);
  if (new Set(ids).size !== ids.length) errors.push("stage id 不能重复");
  for (const stageId of requiredStages(expectedMode)) {
    const stage = stages.find((candidate) => candidate?.stage === stageId);
    if (!stage) {
      errors.push(`缺少 Stage ${stageId}`);
      continue;
    }
    const artifact = stage.artifact as Partial<DeconstructionArtifact> | undefined;
    if (!artifact || typeof artifact !== "object") {
      errors.push(`Stage ${stageId} artifact 无效`);
      continue;
    }
    if (typeof artifact.id !== "string" || !artifact.id) errors.push(`Stage ${stageId} 缺少 artifact.id`);
    if (typeof artifact.kind !== "string" || !artifact.kind) errors.push(`Stage ${stageId} 缺少 artifact.kind`);
    if (artifact.schemaVersion !== 1) errors.push(`Stage ${stageId} schemaVersion 必须为 1`);
    for (const field of REQUIRED_FIELDS[stageId] ?? []) {
      if (!(field in artifact) || artifact[field] === null || artifact[field] === undefined) {
        errors.push(`Stage ${stageId} 缺少 ${field}`);
      }
    }
    const stringFields = stageId === 0
      ? ["premise"]
      : stageId === 6
          ? ["sentence", "rhythm", "dialogue", "emotion"]
          : [];
    for (const field of stringFields) {
      if (typeof artifact[field] !== "string") errors.push(`Stage ${stageId} ${field} 必须为字符串`);
    }
    const arrayFields = stageId === 0
      ? ["chapterIndex"]
      : stageId === 1
        ? ["goldenChapters"]
        : stageId === 2
          ? ["chapters"]
          : stageId === 3
            ? ["subplots", "units", "foreshadowing", "emotionCurve"]
            : stageId === 4
              ? ["characters", "factions", "relationships"]
              : stageId === 5
                ? ["readerNeeds", "writingTechniques", "replicableModules", "risks"]
                : ["techniques"];
    for (const field of arrayFields) {
      if (!Array.isArray(artifact[field])) errors.push(`Stage ${stageId} ${field} 必须为数组`);
    }
    if (stageId === 0 && typeof artifact.chapterCount !== "number") {
      errors.push("Stage 0 chapterCount 必须为数字");
    }
    if (stageId === 3 && typeof artifact.coverage !== "number" && typeof artifact.coverage !== "string" && !Array.isArray(artifact.coverage)) {
      errors.push("Stage 3 coverage 必须为数字、字符串或字符串数组");
    }
    if (stageId === 3 && typeof artifact.mainline !== "string" && !Array.isArray(artifact.mainline)) {
      errors.push("Stage 3 mainline 必须为字符串或数组");
    }
    if (stageId === 3 && typeof artifact.emotionCurve !== "string" && !Array.isArray(artifact.emotionCurve)) {
      errors.push("Stage 3 emotionCurve 必须为字符串或数组");
    }
    if (stageId === 4 && !Array.isArray(artifact.worldview) && typeof artifact.worldview !== "object") {
      errors.push("Stage 4 worldview 必须为数组或对象");
    }
    if (stageId === 5 && typeof artifact.emotionEngine !== "string" && !Array.isArray(artifact.emotionEngine)) {
      errors.push("Stage 5 emotionEngine 必须为字符串或数组");
    }
  }
  if (!result.quality || typeof result.quality !== "object") {
    errors.push("quality 必须为对象");
  } else {
    if (typeof result.quality.chapterCount !== "number") errors.push("quality.chapterCount 必须为数字");
    if (!Array.isArray(result.quality.completedStages)) errors.push("quality.completedStages 必须为数组");
    if (!Array.isArray(result.quality.warnings) || !result.quality.warnings.every((item) => typeof item === "string")) {
      errors.push("quality.warnings 必须为字符串数组");
    }
  }
  return errors;
}

/** Downstream writing consumer reads stable artifact fields, never reparses free-form summaries. */
export function buildWritingReference(result: DeconstructionResult) {
  const stage = (id: number) => result.stages.find((item) => item.stage === id)?.artifact;
  const stage0 = stage(0);
  const stage2 = stage(2);
  const stage3 = stage(3);
  const stage4 = stage(4);
  const stage6 = stage(6);
  return {
    mode: result.mode,
    premise: typeof stage0?.premise === "string" ? stage0.premise : "",
    chapterSummaries: Array.isArray(stage2?.chapters) ? stage2.chapters : [],
    plotUnits: Array.isArray(stage3?.units) ? stage3.units : [],
    characters: Array.isArray(stage4?.characters) ? stage4.characters : [],
    style: stage6 ? {
      sentence: stage6.sentence,
      rhythm: stage6.rhythm,
      dialogue: stage6.dialogue,
      emotion: stage6.emotion,
      techniques: stage6.techniques,
    } : {},
  };
}
