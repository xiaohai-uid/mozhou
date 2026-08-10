"use client";

// 联网搜索（UI）：写作时搜资料，结果列表 + 引用入文。
import { useState } from "react";
import { GlobeSimple, LinkSimple } from "@phosphor-icons/react/dist/ssr";

export function WebSearchView() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function doSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearched(false);
    // UI 先行：mock 检索延迟；后端 /api/v1/websearch 实现后替换为真实 fetch
    await new Promise((r) => setTimeout(r, 900));
    setSearching(false);
    setSearched(true);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">联网搜索</h1>
      <p className="mt-2 text-sm text-muted">
        写作时检索资料：设定考据、地名、民俗，结果可直接引用
      </p>

      <form
        className="mt-8 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void doSearch();
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-surface-2 bg-zinc-950 px-4 py-3 transition focus-within:border-accent">
          <GlobeSimple size={18} className="shrink-0 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索设定资料、民俗、地名…"
            aria-label="搜索词"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-faint"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="rounded-full bg-accent px-7 py-3 text-sm font-medium text-white transition hover:bg-violet-500 active:translate-y-px disabled:opacity-40"
        >
          {searching ? "搜索中…" : "搜索"}
        </button>
      </form>

      {/* 搜索中 */}
      {searching && (
        <div className="mt-8 flex items-center justify-center gap-3 rounded-card border border-surface-2 bg-surface/50 py-12">
          <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="text-sm text-muted">正在检索资料…</span>
        </div>
      )}

      {searched && (
        <div className="mt-8 space-y-3">
          {[
            { title: "「灰烬」在丧葬民俗中的含义", source: "民俗百科", snippet: "骨灰罐中留存火种，象征家族延续，多出现在南方宗族葬俗记载中…" },
            { title: "灯芯草：生长环境与取火用途", source: "植物志", snippet: "灯芯草髓部可制灯芯，湿时柔韧，干后易燃，是旧时民间照明的主要材料…" },
            { title: "零界：方言中「边界之外」的说法", source: "方言词典", snippet: "部分地区以「零界」指代村界之外、不可知的地带，常用于老人讲述的禁忌故事…" },
          ].map((r) => (
            <div key={r.title} className="rounded-card border border-surface-2 bg-surface/50 px-6 py-4 transition hover:border-zinc-600">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-zinc-100">{r.title}</h2>
                  <p className="mt-1 text-xs text-faint">{r.source}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{r.snippet}</p>
                </div>
                <button className="flex shrink-0 items-center gap-1.5 rounded-full border border-surface-2 px-3.5 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white">
                  <LinkSimple size={13} aria-hidden />
                  引用入文
                </button>
              </div>
            </div>
          ))}
          <p className="pt-2 text-center text-xs text-faint">检索服务接入中，当前为界面示意</p>
        </div>
      )}
    </main>
  );
}
