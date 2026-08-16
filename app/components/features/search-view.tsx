"use client";

// 书源搜索（08 工单已真实化）：真实检索（外部源 + 容错降级）+ 导入书架。
import { useState } from "react";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

interface SourceResult {
  source: string;
  sourceLabel: string;
  name: string;
  author: string;
  site: string;
  status: string;
  bookId: string;
}

const sourceLabels: Record<string, string> = {
  qidian: "起点中文网",
  fanqie: "番茄小说",
  qimao: "七猫小说",
  jjwxc: "晋江文学城",
};

export function SearchView() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  async function doSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearched(false);
    setError(null);
    try {
      const res = await fetch("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as {
        results?: SourceResult[];
        degraded?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "搜索失败");
      setResults(data.results ?? []);
      setDegraded(data.degraded ?? false);
      setSearched(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function importBook(r: SourceResult) {
    if (importing) return;
    const resultKey = `${r.source}:${r.bookId}`;
    setImporting(resultKey);
    try {
      const res = await fetch("/api/v1/shelf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.name,
          source: r.sourceLabel,
          author: r.author,
          site: r.site,
          status: r.status,
        }),
      });
      if (!res.ok) throw new Error("导入失败");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">书源搜索</h1>
      <p className="mt-2 text-sm text-muted">从正规平台搜索并收录书目信息，用于后续参考与拆解</p>

      {/* 搜索框 */}
      <form
        className="mt-8 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void doSearch();
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
          <span className="text-sm text-muted">正在检索书源…</span>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* 结果 */}
      {searched && !searching && (
        <div className="mt-8 space-y-3">
          {degraded && (
            <div className="flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-400">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-yellow-400" aria-hidden />
              外部书源暂时不可达，未返回虚构书目
            </div>
          )}
          {results.map((r) => (
            <div
              key={`${r.source}:${r.bookId}`}
              className="flex items-center justify-between gap-4 rounded-card border border-surface-2 bg-surface/50 px-6 py-4 transition hover:border-zinc-600"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
                    {sourceLabels[r.source] ?? r.sourceLabel}
                  </span>
                  <h2 className="truncate text-sm font-medium text-zinc-100">{r.name}</h2>
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {r.author} · {r.site} · {r.status}
                </p>
              </div>
              <button
                onClick={() => void importBook(r)}
                disabled={importing !== null}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-surface-2 px-4 py-2 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white disabled:opacity-50"
              >
                <DownloadSimple size={14} aria-hidden />
                {importing === `${r.source}:${r.bookId}` ? "导入中…" : "导入"}
              </button>
            </div>
          ))}
          {results.length === 0 && (
            <div className="rounded-card border border-dashed border-surface-2 px-6 py-10 text-center">
              <p className="text-sm text-muted">没有可验证的书源结果</p>
              <p className="mt-2 text-xs leading-5 text-faint">书源不可达时不会展示虚构书目，请稍后重试。</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
