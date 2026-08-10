// 书源引擎（08 工单）：内置 3 个书源检索 + 网络容错降级。
// 真实请求带 3s 超时；超时/非 200/解析失败 → 自动降级返回 mock 数据并标记 degraded（绝不抛异常）。
// 测试注入 SOURCE_PROVIDER=mock 直接返回降级数据（确定性）。

export interface SourceResult {
  source: string; // 书源 key
  sourceLabel: string;
  name: string;
  author: string;
  site: string;
  status: string;
}

export interface SearchOutcome {
  results: SourceResult[];
  degraded: boolean; // true = 外部源不可达，已降级 mock
  note?: string;
}

/** 内置书源（对齐 OpenWrite 逆向盘点；真实站点请求合规：UA 标识 + 3s 超时） */
const SOURCES = [
  { key: "shukuge", label: "书古阁", site: "shukuge.com", url: (q: string) => `https://www.shukuge.com/s?q=${encodeURIComponent(q)}` },
  { key: "22biqu", label: "22 笔趣阁", site: "22biqu.net", url: (q: string) => `https://www.22biqu.net/search?q=${encodeURIComponent(q)}` },
  { key: "zxtyz", label: "章溪书站", site: "zxtyz.com", url: (q: string) => `https://www.zxtyz.com/search?q=${encodeURIComponent(q)}` },
];

/** 降级 mock 数据（外部源不可达时返回，保证 UI 可演示） */
const FALLBACK_RESULTS: SourceResult[] = [
  { source: "shukuge", sourceLabel: "书古阁", name: "灰烬有籽", author: "佚名", site: "shukuge.com", status: "已读 3 章" },
  { source: "22biqu", sourceLabel: "22 笔趣阁", name: "灰烬有籽（精校版）", author: "佚名", site: "22biqu.net", status: "连载" },
  { source: "zxtyz", sourceLabel: "章溪书站", name: "零界道种", author: "佚名", site: "zxtyz.com", status: "已读 1 章" },
];

const TIMEOUT_MS = 3000;

/** 真实检索：逐个源请求（带超时），收集成功源的结果；全部失败 → 降级 mock */
export async function searchSources(query: string): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) return { results: [], degraded: false };

  // 测试模式：直接返回降级数据
  if (process.env.SOURCE_PROVIDER === "mock") {
    return { results: FALLBACK_RESULTS, degraded: true, note: "书源检索服务降级（mock 数据）" };
  }

  const outcomes = await Promise.all(
    SOURCES.map(async (src) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(src.url(q), {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MoZhou/1.0",
            Accept: "text/html,application/xhtml+xml",
          },
        });
        clearTimeout(timer);
        if (!res.ok) return null;
        const html = await res.text();
        // 简化解析：从 HTML 提取书名候选（真实规则解析器归后续切片）
        const nameMatch = html.match(/<title>([^<]{2,30})<\/title>/);
        if (!nameMatch) return null;
        return {
          source: src.key,
          sourceLabel: src.label,
          name: nameMatch[1].replace(/(搜索|结果|_|-).*$/, "").trim(),
          author: "未知",
          site: src.site,
          status: "在线",
        } satisfies SourceResult;
      } catch {
        return null; // 超时/网络失败 → 该源降级
      }
    }),
  );

  const results = outcomes.filter((r): r is SourceResult => r !== null);
  if (results.length === 0) {
    // 全部源不可达 → 降级 mock（绝不抛异常）
    return {
      results: FALLBACK_RESULTS,
      degraded: true,
      note: "外部书源暂时不可达，已降级为本地示例数据",
    };
  }
  return { results, degraded: false };
}
