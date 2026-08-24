/**
 * 调用级成本账本（spec §6.2 Q3；票 08）。
 * usage_ledger：attempt 级、append-only（重试累计不覆盖）；无价格 → unpriced，不显示 0 元；
 * usage_events 保持为账户页聚合源不动；未归因用量（无 attempt 关联的既有行）保留。
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageLedger } from "@/lib/schema";
import type { ProviderOwner, ProviderSourceClass } from "@/lib/ai/provider-boundary";

export type UsageLedgerStatus = "succeeded" | "failed" | "cancelled";
export type UsageStatus = "reported" | "unknown";

export interface RecordUsageInput {
  userId: number;
  requestId?: string | null;
  taskId?: string | null;
  generationId: string | null;
  attemptId: number | null;
  sourceClass?: ProviderSourceClass;
  provider: string | null;
  model: string | null;
  credentialOwner?: ProviderOwner;
  billingOwner?: ProviderOwner;
  route?: string;
  status?: UsageLedgerStatus;
  promptTokens?: number | null;
  completionTokens?: number | null;
  usageStatus?: UsageStatus;
  /** 可选单价信息；本期无定价表 → 全部 unpriced。 */
  costAmount?: number | null;
  currency?: string | null;
}

type UsageLedgerExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 写一行账（append-only）：重试产生新行，绝不 UPDATE 旧行。
 *
 * 同一个 attempt 可能同时由停止接口和原始 SSE 请求收束。attempt 级
 * advisory lock 让这两个终态写入串行化；后到者读回已有行，避免一轮
 * inference 被重复计费，同时保留不同 attempt 的追加语义。
 */
export async function recordAttemptUsage(input: RecordUsageInput) {
  const write = async (tx: UsageLedgerExecutor | typeof db) => {
    if (input.attemptId != null) {
      await tx.execute(sql`select pg_advisory_xact_lock(${input.attemptId})`);
      const [existing] = await tx
        .select()
        .from(usageLedger)
        .where(eq(usageLedger.attemptId, input.attemptId))
        .limit(1);
      if (existing) return existing;
    }

    const [row] = await tx
      .insert(usageLedger)
      .values({
        userId: input.userId,
        requestId: input.requestId ?? null,
        taskId: input.taskId ?? null,
        generationId: input.generationId,
        attemptId: input.attemptId,
        sourceClass: input.sourceClass ?? "PUBLIC_FREE",
        provider: input.provider,
        model: input.model,
        credentialOwner: input.credentialOwner ?? "platform",
        billingOwner: input.billingOwner ?? "provider",
        route: input.route ?? "legacy",
        status: input.status ?? "succeeded",
        usageStatus: input.usageStatus ?? (input.promptTokens != null && input.completionTokens != null ? "reported" : "unknown"),
        promptTokens: input.usageStatus === "unknown" ? null : (input.promptTokens ?? null),
        completionTokens: input.usageStatus === "unknown" ? null : (input.completionTokens ?? null),
        // drizzle numeric 映射为 string
        costAmount: input.costAmount == null ? null : String(input.costAmount),
        currency: input.currency ?? null,
        // 无定价表：如实标记 unpriced（不猜价、不显示 0 元）
        costStatus: input.costAmount == null ? "unpriced" : "priced",
      })
      .returning();
    return row ?? null;
  };

  if (input.attemptId == null) return write(db);
  return db.transaction((tx) => write(tx));
}

/** 按生成查账（审计回放）。 */
export async function listLedgerByGeneration(generationId: string) {
  return db
    .select()
    .from(usageLedger)
    .where(eq(usageLedger.generationId, generationId))
    .orderBy(usageLedger.id);
}

/** 按用户查账（分页）。 */
export async function listLedgerByUser(userId: number, limit = 100, offset = 0) {
  return db
    .select()
    .from(usageLedger)
    .where(eq(usageLedger.userId, userId))
    .orderBy(desc(usageLedger.id))
    .limit(limit)
    .offset(offset);
}

export interface LedgerStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCalls: number;
  pricedCalls: number;
  unpricedCalls: number;
  totalCost: number | null;
}

/** 聚合统计：priced/unpriced 分别计数；无价格时 totalCost 为 null（不是 0）。 */
export async function ledgerStats(userId: number): Promise<LedgerStats> {
  const [row] = await db
    .select({
      totalPromptTokens: sql<number>`COALESCE(SUM(prompt_tokens), 0)`,
      totalCompletionTokens: sql<number>`COALESCE(SUM(completion_tokens), 0)`,
      totalCalls: sql<number>`COUNT(*)`,
      pricedCalls: sql<number>`COUNT(*) FILTER (WHERE cost_status = 'priced')`,
      unpricedCalls: sql<number>`COUNT(*) FILTER (WHERE cost_status = 'unpriced')`,
      totalCost: sql<number | null>`SUM(cost_amount)`,
    })
    .from(usageLedger)
    .where(eq(usageLedger.userId, userId));
  return {
    totalPromptTokens: Number(row?.totalPromptTokens ?? 0),
    totalCompletionTokens: Number(row?.totalCompletionTokens ?? 0),
    totalCalls: Number(row?.totalCalls ?? 0),
    pricedCalls: Number(row?.pricedCalls ?? 0),
    unpricedCalls: Number(row?.unpricedCalls ?? 0),
    totalCost: row?.totalCost == null ? null : Number(row.totalCost),
  };
}
