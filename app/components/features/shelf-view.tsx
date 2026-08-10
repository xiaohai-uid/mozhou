"use client";

// 书源书架（UI）：导入的书管理——书架/阅读/章节。
import { useState } from "react";
import { BookBookmark, BookOpen } from "@phosphor-icons/react/dist/ssr";

const books = [
  { id: 1, name: "宿命之环", source: "书古阁", progress: "第 12 章 / 共 302 章", updated: "2 小时前" },
  { id: 2, name: "道诡异仙", source: "22 笔趣阁", progress: "第 45 章 / 共 516 章", updated: "昨天" },
];

export function ShelfView() {
  const [active, setActive] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);

  async function toggleBook(id: number) {
    if (active === id) {
      setActive(null);
      return;
    }
    // UI 先行：mock 章节拉取延迟；后端 /api/v1/shelf/[id]/chapters 实现后替换为真实 fetch
    setLoading(id);
    await new Promise((r) => setTimeout(r, 600));
    setLoading(null);
    setActive(id);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">书源书架</h1>
      <p className="mt-2 text-sm text-muted">
        从书源导入的小说，用于阅读参考与拆解分析
      </p>

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
                    {b.source} · {b.progress}
                  </p>
                </div>
              </div>
              <button
                onClick={() => void toggleBook(b.id)}
                disabled={loading !== null}
                className="flex shrink-0 items-center gap-1 rounded-full border border-surface-2 px-3.5 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white disabled:opacity-50"
              >
                <BookOpen size={13} aria-hidden />
                {loading === b.id ? "加载中…" : active === b.id ? "收起" : "阅读"}
              </button>
            </div>
            <p className="mt-4 text-xs text-faint">更新于 {b.updated}</p>

            {/* 章节列表 */}
            {active === b.id && (
              <ul className="mt-4 space-y-1 border-t border-surface-2 pt-3">
                {["第 11 章", "第 12 章（上次阅读）", "第 13 章", "第 14 章"].map((ch, i) => (
                  <li key={ch}>
                    <button
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                        i === 1
                          ? "bg-accent/10 text-zinc-100"
                          : "text-zinc-400 hover:bg-surface hover:text-zinc-200"
                      }`}
                    >
                      {ch}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-faint">
        书源抓取与章节存储接入中，当前为界面示意
      </p>
    </main>
  );
}
