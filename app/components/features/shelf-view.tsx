"use client";

// 书源书架（任务一已接真实后端）：从 /api/v1/shelf 加载导入的书。
// 章节列表仍为 UI 占位（章节抓取归书源引擎后续切片）。
import { useCallback, useEffect, useState } from "react";
import { BookBookmark, BookOpen } from "@phosphor-icons/react/dist/ssr";

interface ShelfBook {
  id: number;
  name: string;
  source: string;
  author: string;
  site: string;
  status: string;
}

export function ShelfView() {
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [expanding, setExpanding] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/shelf");
      if (!res.ok) throw new Error("书架加载失败");
      const data = (await res.json()) as { books: ShelfBook[] };
      setBooks(data.books);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    // 挂载时异步加载书架（fetch 后 setState）；豁免规则误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function toggleBook(id: number) {
    if (active === id) {
      setActive(null);
      return;
    }
    // 章节展开：模拟加载（真实章节抓取归书源引擎后续切片）
    setExpanding(id);
    await new Promise((r) => setTimeout(r, 500));
    setExpanding(null);
    setActive(id);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">书源书架</h1>
      <p className="mt-2 text-sm text-muted">
        从书源导入的小说，用于阅读参考与拆解分析
      </p>

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}

      {loadingList ? (
        <div className="mt-8 flex items-center justify-center gap-3 rounded-card border border-surface-2 bg-surface/50 py-16">
          <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="text-sm text-muted">正在加载书架…</span>
        </div>
      ) : books.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center gap-4 rounded-card border border-dashed border-surface-2 py-20 text-center">
          <BookBookmark size={30} weight="duotone" className="text-zinc-500" aria-hidden />
          <p className="text-sm text-muted">书架还是空的</p>
          <p className="text-xs text-zinc-600">去书源搜索导入第一本书</p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {books.map((b) => (
            <div
              key={b.id}
              className="rounded-card border border-surface-2 bg-surface/50 p-6 transition hover:border-zinc-600"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <BookBookmark size={22} weight="duotone" className="shrink-0 text-accent" aria-hidden />
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">{b.name}</h2>
                    <p className="mt-0.5 text-xs text-faint">
                      {b.source} · {b.site}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void toggleBook(b.id)}
                  disabled={expanding !== null}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-surface-2 px-3.5 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white disabled:opacity-50"
                >
                  <BookOpen size={13} aria-hidden />
                  {expanding === b.id ? "加载中…" : active === b.id ? "收起" : "阅读"}
                </button>
              </div>
              {b.author && (
                <p className="mt-4 text-xs text-faint">作者 {b.author}</p>
              )}
              {b.status && (
                <p className="mt-1 text-xs text-faint">状态 {b.status}</p>
              )}

              {/* 章节列表（占位：真实章节抓取归书源引擎后续切片） */}
              {active === b.id && (
                <ul className="mt-4 space-y-1 border-t border-surface-2 pt-3">
                  {["第 1 章", "第 2 章", "第 3 章"].map((ch) => (
                    <li key={ch}>
                      <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-200">
                        {ch}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
