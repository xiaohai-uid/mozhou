import type { DeconstructionArtifact, DeconstructionMode, DeconstructionResult } from "@/lib/schema";
import { validateDeconstructionArtifacts } from "@/lib/story/deconstruction-artifacts";

export type ProviderTransport = "success" | "timeout" | "network" | "rate_limit" | "provider_4xx" | "provider_5xx" | "protocol_error";
export type StructuredOutput = "valid" | "empty_output" | "invalid_json" | "schema_invalid" | "quality_invalid" | "repair_failed";
export type WorkflowStatus = "completed" | "failed_recoverable" | "failed_terminal";

export type ProviderCallResult =
  | { kind: "success"; raw: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; attempts?: number }
  | { kind: Exclude<ProviderTransport, "success">; raw?: string; status?: number; message?: string; attempts?: number };

export type DeconstructionPipelineResult = {
  workflow: WorkflowStatus;
  transport: ProviderTransport;
  structured: StructuredOutput | null;
  errorClass?:
    | "provider_timeout"
    | "provider_network"
    | "provider_rate_limit"
    | "provider_unavailable"
    | "provider_client_error"
    | "provider_protocol"
    | "invalid_json"
    | "artifact_schema_invalid"
    | "artifact_quality_failed"
    | "repair_failed";
  result?: DeconstructionResult;
  usage: { prompt_tokens: number; completion_tokens: number };
  providerAttempts: number;
  repairAttempts: number;
  validationErrors?: string[];
};

export function classifyProviderResponse(response: { status: number }): ProviderTransport {
  if (response.status === 408 || response.status === 504) return "timeout";
  if (response.status === 429) return "rate_limit";
  if (response.status >= 500 && response.status <= 599) return "provider_5xx";
  if (response.status >= 200 && response.status <= 299) return "success";
  if (response.status >= 400 && response.status <= 499) return "provider_4xx";
  return "protocol_error";
}

function classifyTransport(kind: Exclude<ProviderTransport, "success">): DeconstructionPipelineResult["errorClass"] {
  switch (kind) {
    case "timeout": return "provider_timeout";
    case "network": return "provider_network";
    case "rate_limit": return "provider_rate_limit";
    case "provider_5xx": return "provider_unavailable";
    case "provider_4xx": return "provider_client_error";
    case "protocol_error": return "provider_protocol";
  }
}

function usageOf(call: ProviderCallResult): { prompt_tokens: number; completion_tokens: number } {
  return call.kind === "success"
    ? { prompt_tokens: call.usage?.prompt_tokens ?? 0, completion_tokens: call.usage?.completion_tokens ?? 0 }
    : { prompt_tokens: 0, completion_tokens: 0 };
}

export function attemptsOf(call: ProviderCallResult): number {
  return Math.max(1, call.attempts ?? 1);
}

function failure(
  transport: ProviderTransport,
  structured: StructuredOutput | null,
  errorClass: DeconstructionPipelineResult["errorClass"],
  usage: { prompt_tokens: number; completion_tokens: number },
  attempts: { provider: number; repair: number },
  validationErrors?: string[],
): DeconstructionPipelineResult {
  const recoverable = transport !== "protocol_error" && transport !== "provider_4xx";
  return { workflow: recoverable ? "failed_recoverable" : "failed_terminal", transport, structured, errorClass, usage, providerAttempts: attempts.provider, repairAttempts: attempts.repair, validationErrors };
}

function parseStructured(raw: string, mode: DeconstructionMode, sourceLength: number):
  | { kind: "valid"; result: DeconstructionResult }
  | { kind: "empty_output" }
  | { kind: "invalid_json" }
  | { kind: "schema_invalid"; quality: "schema" | "quality"; errors: string[] } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (cleaned.length === 0) return { kind: "empty_output" };
  if (start === -1 || end <= start) return { kind: "invalid_json" };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { kind: "invalid_json" };
  }
  // Some OpenAI-compatible providers wrap a requested JSON object in a single
  // `answer` envelope. Normalize only this deterministic envelope; the inner
  // object still goes through the complete stage/artifact validator below.
  if (!Array.isArray(obj.stages) && obj.answer && typeof obj.answer === "object" && !Array.isArray(obj.answer)) {
    obj = obj.answer as Record<string, unknown>;
  }
  const rawStages = Array.isArray(obj.stages) ? obj.stages : [];
  const stages = rawStages.map((stage) => {
    const candidate = stage && typeof stage === "object" ? stage as Record<string, unknown> : {};
    return {
      stage: typeof candidate.stage === "number" && Number.isInteger(candidate.stage) ? candidate.stage : -1,
      name: typeof candidate.name === "string" ? candidate.name : `Stage ${String(candidate.stage ?? "?")}`,
      status: "completed" as const,
      artifact: candidate.artifact && typeof candidate.artifact === "object"
        ? candidate.artifact as DeconstructionArtifact
        : {} as DeconstructionArtifact,
    };
  }).filter((stage) => stage.stage >= 0);
  const stageArtifact = (id: number) => stages.find((stage) => stage.stage === id)?.artifact as Record<string, unknown> | undefined;
  const stage0 = stageArtifact(0);
  const stage3 = stageArtifact(3);
  const stage6 = stageArtifact(6);
  const qualityObject = obj.quality && typeof obj.quality === "object" ? obj.quality as Record<string, unknown> : null;
  const result = {
    // Legacy projections are deterministic views of validated stage artifacts;
    // they never substitute for stage validation or accept provider prose.
    structure: Array.isArray(obj.structure) ? obj.structure : typeof stage0?.premise === "string" ? [stage0.premise] : [],
    plot: Array.isArray(obj.plot) ? obj.plot : typeof stage3?.mainline === "string" ? [stage3.mainline] : [],
    rhythm: Array.isArray(obj.rhythm) ? obj.rhythm : typeof stage6?.rhythm === "string" ? [stage6.rhythm] : [],
    mode,
    stages,
    quality: qualityObject
      ? {
          sourceLength,
          chapterCount: typeof qualityObject.chapterCount === "number"
            ? qualityObject.chapterCount
            : NaN,
            completedStages: Array.isArray(qualityObject.completedStages)
            ? qualityObject.completedStages
            : stages.map((stage) => stage.stage),
          warnings: Array.isArray(qualityObject.warnings)
            ? (qualityObject.warnings as unknown[]).filter((item: unknown): item is string => typeof item === "string").slice(0, 20)
            : [],
        }
      : undefined,
  } as Partial<DeconstructionResult>;
  const errors = validateDeconstructionArtifacts(result, mode);
  if (!Array.isArray(result.structure) || !result.structure.every((item) => typeof item === "string")) errors.push("structure 必须为字符串数组");
  if (!Array.isArray(result.plot) || !result.plot.every((item) => typeof item === "string")) errors.push("plot 必须为字符串数组");
  if (!Array.isArray(result.rhythm) || !result.rhythm.every((item) => typeof item === "string")) errors.push("rhythm 必须为字符串数组");
  if (errors.length > 0) {
    const qualityError = errors.some((error) => error.startsWith("quality"));
    return { kind: "schema_invalid", quality: qualityError ? "quality" : "schema", errors: errors.slice(0, 12) };
  }
  return { kind: "valid", result: result as DeconstructionResult };
}

export async function runStructuredDeconstruction(input: {
  mode: DeconstructionMode;
  sourceLength: number;
  request: (options: { repair: boolean }) => Promise<ProviderCallResult>;
}): Promise<DeconstructionPipelineResult> {
  const initial = await input.request({ repair: false });
  if (initial.kind !== "success") {
    return failure(initial.kind, null, classifyTransport(initial.kind), usageOf(initial), { provider: attemptsOf(initial), repair: 0 });
  }
  const providerAttempts = attemptsOf(initial);
  const initialUsage = usageOf(initial);
  const parsed = parseStructured(initial.raw, input.mode, input.sourceLength);
  if (parsed.kind === "valid") return { workflow: "completed", transport: "success", structured: "valid", result: parsed.result, usage: initialUsage, providerAttempts, repairAttempts: 0 };

  const repair = await input.request({ repair: true });
  const totalUsage = {
    prompt_tokens: initialUsage.prompt_tokens + usageOf(repair).prompt_tokens,
    completion_tokens: initialUsage.completion_tokens + usageOf(repair).completion_tokens,
  };
  const repairAttempts = attemptsOf(repair);
  if (repair.kind !== "success") {
    return failure(repair.kind, "repair_failed", classifyTransport(repair.kind), totalUsage, { provider: providerAttempts, repair: repairAttempts });
  }
  const repaired = parseStructured(repair.raw, input.mode, input.sourceLength);
  if (repaired.kind !== "valid") {
    return failure("success", "repair_failed", repaired.kind === "schema_invalid" && repaired.quality === "quality" ? "artifact_quality_failed" : "repair_failed", totalUsage, { provider: providerAttempts, repair: repairAttempts }, repaired.kind === "schema_invalid" ? repaired.errors : [repaired.kind]);
  }
  return { workflow: "completed", transport: "success", structured: "valid", result: repaired.result, usage: totalUsage, providerAttempts, repairAttempts };
}
