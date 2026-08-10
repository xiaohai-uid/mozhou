// 会员与用量服务（11 工单）：用量事件记账 + 聚合查询 + 会员功能 gating
import { and, eq, gte, sql, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents, users } from "@/lib/schema";

/** 免费额度（对齐 UI：Token 500K/月，抽卡 20 次/月） */
export const FREE_QUOTA = {
  token: 500_000,
  draw: 20,
} as const;

export interface QuotaUsage {
  token: { used: number; total: number };
  draw: { used: number; total: number };
}

/** 记一笔用量（chat 每轮 / distill / deconstruct / draw 调用后） */
export async function recordUsage(
  userId: number,
  nodeType: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  await db.insert(usageEvents).values({
    userId,
    nodeType,
    promptTokens,
    completionTokens,
  });
}

/** 本月用量聚合（Token 全节点累计；抽卡次数按 nodeType=抽卡模式 计数） */
export async function getQuotaUsage(userId: number): Promise<QuotaUsage> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [tokenRow] = await db
    .select({
      prompt: sql<string>`coalesce(sum(${usageEvents.promptTokens}), 0)::text`,
      completion: sql<string>`coalesce(sum(${usageEvents.completionTokens}), 0)::text`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, monthStart)),
    );
  const [drawRow] = await db
    .select({ cnt: sql<string>`count(*)::text` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.nodeType, "抽卡模式"),
        gte(usageEvents.createdAt, monthStart),
      ),
    );

  const used = Number(tokenRow?.prompt ?? 0) + Number(tokenRow?.completion ?? 0);
  return {
    token: { used, total: FREE_QUOTA.token },
    draw: { used: Number(drawRow?.cnt ?? 0), total: FREE_QUOTA.draw },
  };
}

/** 会员功能 gating：free 用户超抽卡额度 → 402；token 超额度 → 429 */
export async function assertQuota(
  userId: number,
  nodeType: "draw" | "llm",
): Promise<{ error: string; status: 402 | 429 } | null> {
  const quota = await getQuotaUsage(userId);
  if (nodeType === "draw" && quota.draw.used >= quota.draw.total) {
    return {
      error: `本月抽卡次数已用完（${quota.draw.used}/${quota.draw.total}），升级会员解锁更多`,
      status: 402,
    };
  }
  if (nodeType === "llm" && quota.token.used >= quota.token.total) {
    return {
      error: `本月 Token 额度已用完（${quota.token.used}/${quota.token.total}），升级会员解锁更多`,
      status: 429,
    };
  }
  return null;
}

/** 账户概览（/api/v1/account）：tier + 用量 */
export async function getAccountOverview(userId: number, email: string) {
  const [user] = await db
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.id, userId));
  const quota = await getQuotaUsage(userId);
  return {
    email,
    plan: user?.tier ?? "free",
    quota: {
      token: {
        used: quota.token.used,
        total: quota.token.total,
        pct: Math.min(100, Math.round((quota.token.used / quota.token.total) * 100)),
      },
      draw: {
        used: quota.draw.used,
        total: quota.draw.total,
        pct: Math.min(100, Math.round((quota.draw.used / quota.draw.total) * 100)),
      },
    },
  };
}
