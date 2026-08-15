/**
 * 持久化运行时产物（runtime_artifacts）：可查证据（check_report 等）。
 * 契约 §8：artifactId 全局唯一；provenance 必带 source + capturedAt。
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runtimeArtifacts } from "@/lib/schema";
import type { ArtifactKind } from "./types";

export interface PersistRuntimeArtifactInput {
  kind: ArtifactKind;
  version?: string;
  scope: "novel" | "chapter" | "session" | "global";
  scopeId: number | null;
  source: string;
  data: unknown;
}

export async function persistRuntimeArtifact(input: PersistRuntimeArtifactInput): Promise<string> {
  const artifactId = randomUUID();
  const capturedAt = new Date().toISOString();
  await db.insert(runtimeArtifacts).values({
    artifactId,
    kind: input.kind,
    version: input.version ?? "v1",
    scope: input.scope,
    scopeId: input.scopeId,
    provenance: { source: input.source, capturedAt },
    tokenBudget: 0,
    data: input.data as never,
  });
  return artifactId;
}

export async function getRuntimeArtifact(artifactId: string) {
  const [row] = await db
    .select()
    .from(runtimeArtifacts)
    .where(eq(runtimeArtifacts.artifactId, artifactId));
  return row ?? null;
}
