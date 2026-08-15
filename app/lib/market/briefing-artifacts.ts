/**
 * MarketBrief 版本化产物（工单 05，契约 §8/Delta 5）：
 * 扫榜快照 → 版本化简报（runtime_artifacts kind=market_brief，带来源/日期）→ 绑定作品 → audience_genre 消费。
 * 替代 T9 直拼 marketRef（不保兼容原则，已移除）。
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { artifactBindings, novels, runtimeArtifacts } from "@/lib/schema";
import { persistRuntimeArtifact } from "@/lib/runtime/artifacts";
import { fetchRecentSnapshots, buildBriefingResponse } from "./service";
import type { MarketSummary } from "./summary";

export interface MarketBriefingData {
  version: string;
  dayCount: number;
  summary: MarketSummary;
  rendered: string;
}

/** 从最近 7 天快照创建简报；无数据返回 null（不伪造）。 */
export async function createMarketBriefing(): Promise<{ artifactId: string; version: string } | null> {
  const rows = await fetchRecentSnapshots(7);
  const briefing = buildBriefingResponse(rows, new Date().toISOString(), new Date().toISOString());
  if (briefing.status !== 200) return null;
  const [last] = await db
    .select({ version: runtimeArtifacts.version })
    .from(runtimeArtifacts)
    .where(eq(runtimeArtifacts.kind, "market_brief"))
    .orderBy(desc(runtimeArtifacts.id))
    .limit(1);
  const version = `v${(last ? Number(last.version.replace(/^v/, "")) : 0) + 1}`;
  const data: MarketBriefingData = {
    version,
    dayCount: briefing.summary.dayCount,
    summary: briefing.summary,
    rendered: briefing.rendered,
  };
  const artifactId = await persistRuntimeArtifact({
    kind: "market_brief",
    version,
    scope: "global",
    scopeId: null,
    source: "ranking-snapshot",
    data,
  });
  return { artifactId, version };
}

/** 绑定到作品（归属校验：novel 必须属于该用户；简报为全局产物）。 */
export async function bindMarketBriefing(input: {
  userId: number;
  novelId: number;
  artifactId: string;
}): Promise<boolean> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, input.novelId), eq(novels.userId, input.userId)));
  if (!novel) return false;
  const [artifact] = await db
    .select({ id: runtimeArtifacts.id })
    .from(runtimeArtifacts)
    .where(and(eq(runtimeArtifacts.artifactId, input.artifactId), eq(runtimeArtifacts.kind, "market_brief")));
  if (!artifact) return false;
  await db
    .insert(artifactBindings)
    .values({ novelId: input.novelId, artifactId: input.artifactId, role: "market_brief" })
    .onConflictDoNothing({ target: [artifactBindings.novelId, artifactBindings.artifactId] });
  return true;
}

/** 作品绑定的简报列表（新→旧）。 */
export async function listBoundBriefings(novelId: number) {
  return db
    .select({ artifact: runtimeArtifacts })
    .from(artifactBindings)
    .innerJoin(runtimeArtifacts, eq(runtimeArtifacts.artifactId, artifactBindings.artifactId))
    .where(and(eq(artifactBindings.novelId, novelId), eq(artifactBindings.role, "market_brief")))
    .orderBy(desc(runtimeArtifacts.createdAt));
}

/** audience_genre 前置条件：是否有已绑定简报。 */
export async function hasBoundBriefing(novelId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: artifactBindings.id })
    .from(artifactBindings)
    .where(and(eq(artifactBindings.novelId, novelId), eq(artifactBindings.role, "market_brief")))
    .limit(1);
  return Boolean(row);
}
