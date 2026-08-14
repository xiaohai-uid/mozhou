// 联网搜索结果质量门：反爬/无关页（非 CJK、与 query 零重叠）视为上游异常。
// Bing 无 key HTML 端点常返回反爬壳或无关内容；质量门通过才允许 degraded=false。

/** CJK 统一表意文字（含扩展 A） */
const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

export interface QualityCandidate {
  title: string;
  snippet: string;
}

/** 单条质量：title 或 snippet 含 CJK */
export function isPassable(item: QualityCandidate): boolean {
  return hasCjk(item.title) || hasCjk(item.snippet);
}

/** 批量质量：全部条目 passable，且至少一条与 query 有 2-gram 重叠 */
export function isBatchRelevant(items: QualityCandidate[], query: string): boolean {
  if (items.length === 0) return false;
  if (!items.every(isPassable)) return false;
  const grams = new Set<string>();
  const q = query.replace(/\s+/g, "");
  for (let i = 0; i < q.length - 1; i += 1) grams.add(q.slice(i, i + 2));
  if (grams.size === 0) return true; // query 过短（<2 字）不做相关性判定
  return items.some((item) => {
    const hay = (item.title + item.snippet).replace(/\s+/g, "");
    return [...grams].some((g) => hay.includes(g));
  });
}
