// RAG 设定检索（06 工单，关键词检索真实化）。
// 无 embedding 渠道（one-api 无 embedding 模型），降级为共现字符相关性检索：
// 拉取用户全部人物库/世界观条目，按与 query 的共现字符数排序取 top-k。
// 有 embedding 渠道后升级为 pgvector 语义检索（06b）。
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { characterEntries, novels, worldviewEntries } from "@/lib/schema";

export interface RagEntry {
  kind: "character" | "worldview";
  name: string;
  note: string | null;
}

/** 高频虚词停用字：共现检索时排除，避免「的/了/是」等造成误命中 */
const STOP_CHARS = new Set(
  "的了是在我你他她它这那有不和与也就都而及着过吗呢吧啊哦哈得被把让从向对于之其或但却更最很太又再才刚已将正",
);

/** 排序纯函数（可单测）：按与 query 的共现字符数降序，0 共现的条目排最后 */
export function rankEntries(entries: RagEntry[], query: string): RagEntry[] {
  const qChars = new Set(
    [...query.replace(/\s+/g, "")].filter((ch) => !STOP_CHARS.has(ch)),
  );
  const scored = entries.map((e) => {
    const text = `${e.name}${e.note ?? ""}`;
    let score = 0;
    for (const ch of text) if (qChars.has(ch)) score++;
    return { e, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.e);
}

/** 检索设定条目（可限定作品；novelId 为 null 时检索用户全部作品），取 top-k（无共现则返回空） */
export async function retrieveContext(
  userId: number,
  query: string,
  opts: { topK?: number; novelId?: number | null } = {},
): Promise<RagEntry[]> {
  const topK = opts.topK ?? 5;
  let ownerCond = eq(novels.userId, userId);
  if (opts.novelId != null) {
    // 归属校验：novelId 必须属于该用户（防越权检索他人作品设定）
    const [owned] = await db
      .select({ id: novels.id, ragEnabled: novels.ragEnabled })
      .from(novels)
      .where(and(eq(novels.id, opts.novelId), eq(novels.userId, userId)));
    if (!owned) return [];
    // RAG 开关（06 收尾）：作品关闭注入时返回空
    if (!owned.ragEnabled) return [];
    ownerCond = eq(novels.id, opts.novelId);
  }
  const [chars, wvs] = await Promise.all([
    db
      .select({ name: characterEntries.name, note: characterEntries.note })
      .from(characterEntries)
      .innerJoin(novels, eq(characterEntries.novelId, novels.id))
      .where(ownerCond),
    db
      .select({ name: worldviewEntries.name, note: worldviewEntries.note })
      .from(worldviewEntries)
      .innerJoin(novels, eq(worldviewEntries.novelId, novels.id))
      .where(ownerCond),
  ]);
  const entries: RagEntry[] = [
    ...chars.map((r) => ({ kind: "character" as const, name: r.name, note: r.note })),
    ...wvs.map((r) => ({ kind: "worldview" as const, name: r.name, note: r.note })),
  ];
  return rankEntries(entries, query)
    .filter((e) => {
      // 只保留与 query 有共现的条目（停用字不计）
      const qChars = new Set(
        [...query.replace(/\s+/g, "")].filter((ch) => !STOP_CHARS.has(ch)),
      );
      return [...`${e.name}${e.note ?? ""}`].some((ch) => qChars.has(ch));
    })
    .slice(0, topK);
}
