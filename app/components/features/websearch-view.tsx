"use client";

// 联网搜索（任务二-C 真实化 + 工单 21）：真实检索（超时优雅降级）+ 多选引用入文（回流写作对话）。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, GlobeSimple } from "@phosphor-icons/react/dist/ssr";

interface WebResult {
  title: string;
  source: string;
  snippet: string;
  url: string;
}

export function WebSearchView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<WebResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 工单 21：多选结果（按 title 去重）
  const [selected, setSelected] = useState<string[]>([]);

  async function doSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearched(false);
    setError(null);
    setSelected([]);
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

  function toggleSelect(title: string) {
    setSelected((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
  }

  /** 工单 21：引用入文——多选结果存回流通道 → 写作对话（R2 消息插入语义，契约 23） */
  function citeSelected() {
    const items = results.filter((r) => selected.includes(r.title));
    if (items.length === 0) return;
    sessionStorage.setItem(
      "mozhou_pending_websearch",
      JSON.stringify({ items, at: Date.now() }),
    );
    router.push("/chat");
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
              {note ?? "联网检索服务暂时不可用，未返回虚构结果"}
            </div>
          )}
          {/* 工单 21：多选 → 引用入文（回流写作对话） */}
          {results.length > 0 && (
            <div className="flex items-center justify-between rounded-card border border-surface-2 bg-surface/50 px-5 py-3">
              <span className="text-xs text-faint">
                {selected.length > 0 ? `已选 ${selected.length} 条` : "勾选结果后引用到写作对话"}
              </span>
              <button
                onClick={citeSelected}
                disabled={selected.length === 0}
                className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                <Check size={13} weight="bold" aria-hidden />
                引用入文（{selected.length}）
              </button>
            </div>
          )}
          {results.map((r) => (
            <div
              key={r.title}
              role="button"
              tabIndex={0}
              onClick={() => toggleSelect(r.title)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelect(r.title);
                }
              }}
              className={`cursor-pointer rounded-card border px-6 py-4 transition ${
                selected.includes(r.title)
                  ? "border-accent/50 bg-accent/5"
                  : "border-surface-2 bg-surface/50 hover:border-zinc-600"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-zinc-100">{r.title}</h2>
                  <p className="mt-1 text-xs text-faint">{r.source}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{r.snippet}</p>
                </div>
                <span
                  aria-hidden
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition ${
                    selected.includes(r.title)
                      ? "border-accent bg-accent text-white"
                      : "border-surface-2 text-transparent"
                  }`}
                >
                  <Check size={12} weight="bold" />
                </span>
              </div>
            </div>
          ))}
          {results.length === 0 && (
            <div className="rounded-card border border-dashed border-surface-2 px-6 py-10 text-center">
              <p className="text-sm text-muted">没有可验证的联网结果</p>
              <p className="mt-2 text-xs leading-5 text-faint">服务降级时不会展示虚构资料，请稍后重试或使用可核验来源。</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
