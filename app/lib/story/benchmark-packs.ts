/**
 * BenchmarkPack（工单 06）：拆解产物 → 版本化方法包（私有 MVP，公开模板市场二期）。
 * 内容 = buildWritingReference 的抽象投影（结构/情绪/节奏/功能位/文风方法），
 * 不含原作品正文（deconstruction_runs 只存摘要哈希与长度）；保留来源与「仅作方法参考」边界。
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { artifactBindings, deconstructionRuns, novels, runtimeArtifacts } from "@/lib/schema";
import { persistRuntimeArtifact } from "@/lib/runtime/artifacts";
import { buildWritingReference } from "./deconstruction-artifacts";

export interface BenchmarkPackData {
  version: string;
  sourceRunId: number;
  reference: ReturnType<typeof buildWritingReference>;
}

/** 从拆解运行创建方法包并绑定到作品（归属校验双方）；未完成/越权 → null。 */
export async function createBenchmarkPack(input: {
  userId: number;
  novelId: number;
  runId: number;
}): Promise<{ artifactId: string; version: string } | null> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, input.novelId), eq(novels.userId, input.userId)));
  if (!novel) return null;
  const [run] = await db
    .select({ result: deconstructionRuns.result, status: deconstructionRuns.status })
    .from(deconstructionRuns)
    .where(and(eq(deconstructionRuns.id, input.runId), eq(deconstructionRuns.userId, input.userId)));
  if (!run || run.status !== "completed" || !run.result) return null;
  const [last] = await db
    .select({ version: runtimeArtifacts.version })
    .from(runtimeArtifacts)
    .where(eq(runtimeArtifacts.kind, "benchmark_pack"))
    .orderBy(desc(runtimeArtifacts.id))
    .limit(1);
  const version = `v${(last ? Number(last.version.replace(/^v/, "")) : 0) + 1}`;
  const data: BenchmarkPackData = {
    version,
    sourceRunId: input.runId,
    reference: buildWritingReference(run.result),
  };
  const artifactId = await persistRuntimeArtifact({
    kind: "benchmark_pack",
    version,
    scope: "novel",
    scopeId: input.novelId,
    source: `deconstruct-run:${input.runId}`,
    data,
  });
  await db
    .insert(artifactBindings)
    .values({ novelId: input.novelId, artifactId, role: "benchmark_pack" })
    .onConflictDoNothing({ target: [artifactBindings.novelId, artifactBindings.artifactId] });
  return { artifactId, version };
}

/** 作品绑定的方法包列表（新→旧）。 */
export async function listBenchmarkPacks(novelId: number) {
  return db
    .select({ artifact: runtimeArtifacts })
    .from(artifactBindings)
    .innerJoin(runtimeArtifacts, eq(runtimeArtifacts.artifactId, artifactBindings.artifactId))
    .where(and(eq(artifactBindings.novelId, novelId), eq(artifactBindings.role, "benchmark_pack")))
    .orderBy(desc(runtimeArtifacts.createdAt));
}

/** 最新绑定方法包（默认技能消费）。 */
export async function getBoundBenchmarkPack(novelId: number) {
  const rows = await listBenchmarkPacks(novelId);
  return rows[0]?.artifact ?? null;
}
