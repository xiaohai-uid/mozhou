"use client";

// 书源搜索（UI 先行）：搜索框 + 书源结果列表 + 导入。
// 书源站对齐 OpenWrite 逆向盘点（shukuge / 22biqu / zxtyz）。
import { useState } from "react";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

const demoResults = [
  { source: "shukuge", name: "灰烬有籽", author: "佚名", site: "shukuge.com", status: "已读 3 章" },
  { source: "22biqu", name: "灰烬有籽（精校版）", author: "佚名", site: "22biqu.net", status: "连载" },
  { source: "zxtyz", name: "零界道种", author: "佚名", site: "zxtyz.com", status: "已读 1 章" },
];

const sourceLabels: Record<string, string> = {
  shukuge: "书古阁",
  "22biqu": "22 笔趣阁",
  zxtyz: "章溪书站",
};

export function SearchView() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">书源搜索</h1>
      <p className="mt-2 text-sm text-muted">从主流书源搜索并导入小说文本，用于参考与拆解</p>

      {/* 搜索框 */}
      <form
        className="mt-8 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) setSearched(true);
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-surface-2 bg-zinc-950 px-4 py-3 transition focus-within:border-accent">
          <MagnifyingGlass size={18} className="shrink-0 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入书名或关键词"
            aria-label="搜索关键词"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-faint"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim()}
          className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-white transition hover:bg-violet-500 active:translate-y-px disabled:opacity-40"
        >
          搜索
        </button>
      </form>

      {/* 结果 */}
      {searched && (
        <div className="mt-8 space-y-3">
          {demoResults.map((r) => (
            <div
              key={r.source}
              className="flex items-center justify-between gap-4 rounded-card border border-surface-2 bg-surface/50 px-6 py-4 transition hover:border-zinc-600"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
                    {sourceLabels[r.source]}
                  </span>
                  <h2 className="truncate text-sm font-medium text-zinc-100">{r.name}</h2>
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {r.author} · {r.site} · {r.status}
                </p>
              </div>
              <button className="flex shrink-0 items-center gap-1.5 rounded-full border border-surface-2 px-4 py-2 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white">
                <DownloadSimple size={14} aria-hidden />
                导入
              </button>
            </div>
          ))}
          <p className="pt-2 text-center text-xs text-faint">
            书源检索与导入功能开发中，当前为界面示意
          </p>
        </div>
      )}
    </main>
  );
}
