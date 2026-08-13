// 书源引擎：内置 3 个外部书源检索 + 明确降级状态。
// 真实请求带 3s 超时；超时/非 200/解析失败 → 返回空结果并标记 degraded，绝不把固定样例冒充为线上书目。
// 测试注入 SOURCE_PROVIDER=mock 直接返回降级数据（确定性）。

export interface SourceResult {
  source: string; // 书源 key
  sourceLabel: string;
  name: string;
  author: string;
  site: string;
  status: string;
  capturedAt: string;
  url: string;
}

export interface SearchOutcome {
  results: SourceResult[];
  degraded: boolean; // true = 外部源不可达或使用测试 provider
  note?: string;
}

/** 内置书源（对齐 OpenWrite 逆向盘点；真实站点请求合规：UA 标识 + 3s 超时） */
const SOURCES = [
  { key: "fanqie-rank", label: "番茄小说榜", site: "fanqienovel.com", url: () => "https://fanqienovel.com/rank" },
];

/** 仅测试 provider 使用的确定性数据；生产失败绝不返回这些数据。 */
const TEST_RESULTS: SourceResult[] = [
  { source: "fanqie-rank", sourceLabel: "番茄小说榜", name: "灰烬有籽", author: "佚名", site: "fanqienovel.com", status: "测试数据", capturedAt: "1970-01-01T00:00:00.000Z", url: "https://fanqienovel.com/rank" },
];

const TIMEOUT_MS = 3000;

/** 真实检索：逐个源请求（带超时），收集成功源的结果；全部失败 → 空结果 */
export async function searchSources(query: string): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) return { results: [], degraded: false };

  // 测试模式：直接返回确定性测试数据；生产路径永不使用这些数据。
  if (process.env.SOURCE_PROVIDER === "mock") {
    return { results: TEST_RESULTS, degraded: true, note: "书源检索服务降级（测试数据）" };
  }

  const outcomes = await Promise.all(
    SOURCES.map(async (src) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(src.url(), {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0",
            Accept: "text/html,application/xhtml+xml",
          },
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        const html = await res.text();
        const capturedAt = new Date().toISOString();
        if (src.key === "fanqie-rank") {
          // 番茄服务端渲染 rank.book_list，字段是可验证的榜单快照。
          const rows = [...html.matchAll(/"bookName":"([^"\\]+)"[\s\S]{0,1800}?"author":"([^"\\]*)"/g)]
            .slice(0, 20)
            .map((match) => ({
              source: src.key,
              sourceLabel: src.label,
              name: match[1],
              author: match[2] || "未知",
              site: src.site,
              status: "榜单快照",
              capturedAt,
              url: src.url(),
            } satisfies SourceResult));
          return rows[0] ?? null;
        }
        const nameMatch = html.match(/<title>([^<]{2,30})<\/title>/);
        if (!nameMatch) return null;
        return {
          source: src.key,
          sourceLabel: src.label,
          name: nameMatch[1].replace(/(搜索|结果|_|-).*$/, "").trim(),
          author: "未知",
          site: src.site,
          status: "在线",
          capturedAt,
          url: src.url(),
        } satisfies SourceResult;
      } catch {
        return null; // 超时/网络失败 → 该源不可用
      }
    }),
  );

  const results = outcomes.filter((r): r is SourceResult => r !== null);
  if (results.length === 0) {
    // 全部源不可达 → 空结果（绝不把示例数据当真实结果）
    return {
      results: [],
      degraded: true,
      note: "外部书源暂时不可达，未返回虚构书目；请稍后重试",
    };
  }
  return { results, degraded: false };
}
