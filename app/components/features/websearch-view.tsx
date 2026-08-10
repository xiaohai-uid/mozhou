"use client";

// 联网搜索（任务二-C 已真实化）：真实检索（超时优雅降级）+ 结果列表 + 引用入文。
import { useState } from "react";
import { GlobeSimple, LinkSimple } from "@phosphor-icons/react/dist/ssr";

interface WebResult {
  title: string;
  source: string;
  snippet: string;
  url: string;
}

export function WebSearchView() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<WebResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearched(false);
    setError(null);
    try {
      const res = await fetch("/api/v1/websearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as {
        results?: WebResult[];
        degraded?: boolean;
        note?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "检索失败");
      setResults(data.results ?? []);
      setDegraded(data.degraded ?? false);
      setNote(data.note ?? null);
      setSearched(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
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

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}

      {searched && !searching && (
        <div className="mt-8 space-y-3">
          {degraded && (
            <div className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-400">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-yellow-400" aria-hidden />
              {note ?? "联网检索服务暂时不可用，已降级为示例数据"}
            </div>
          )}
          {results.map((r) => (
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
        </div>
      )}
    </main>
  );
}
