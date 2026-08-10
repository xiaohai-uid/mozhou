"use client";

// 网文扫榜（UI）：扫榜开关 + 多榜浏览（对齐 OpenWrite 逆向的 8 案例）。
import { useState } from "react";
import { ToggleLeft, ToggleRight, Trophy } from "@phosphor-icons/react/dist/ssr";

const boards = [
  { name: "畅销榜 Top10", site: "番茄小说" },
  { name: "月票榜", site: "起点中文网" },
  { name: "新书榜", site: "番茄小说" },
  { name: "完结榜", site: "起点中文网" },
];

const demoRows = [
  { rank: 1, name: "宿命之环", heat: "9.8 万人在读" },
  { rank: 2, name: "道诡异仙", heat: "8.7 万人在读" },
  { rank: 3, name: "深海余烬", heat: "7.9 万人在读" },
  { rank: 4, name: "玄鉴仙族", heat: "6.4 万人在读" },
  { rank: 5, name: "夜的命名术", heat: "5.8 万人在读" },
];

export function RankingsView() {
  const [enabled, setEnabled] = useState(false);
  const [board, setBoard] = useState(boards[0].name);
  const [loading, setLoading] = useState(false);

  async function toggleEnabled() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    // UI 先行：mock 扫榜启动延迟；后端 /api/v1/rankings 实现后替换为真实 fetch
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    setLoading(false);
    setEnabled(true);
  }

  async function switchBoard(name: string) {
    if (name === board || loading) return;
    setLoading(true);
    // UI 先行：mock 榜源切换延迟
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    setBoard(name);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Trophy size={22} weight="duotone" className="text-accent" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">网文扫榜</h1>
          </div>
          <p className="mt-2 text-sm text-muted">跟踪热门作品与市场风向，扫榜结果可写入参考库</p>
        </div>
        <button
          onClick={() => void toggleEnabled()}
          aria-label={enabled ? "关闭扫榜" : "开启扫榜"}
          className={enabled ? "text-accent" : "text-faint"}
        >
          {loading ? (
            <span className="inline-block size-4 animate-pulse rounded-full bg-accent" aria-hidden />
          ) : enabled ? (
            <ToggleRight size={32} weight="fill" />
          ) : (
            <ToggleLeft size={32} weight="fill" />
          )}
        </button>
      </div>

      {enabled && (
        <>
          {/* 榜源切换 */}
          <div className="mt-8 flex flex-wrap gap-2">
            {boards.map((b) => (
              <button
                key={b.name}
                onClick={() => void switchBoard(b.name)}
                disabled={loading}
                className={`rounded-full px-4 py-2 text-sm transition disabled:opacity-50 ${
                  board === b.name
                    ? "bg-accent text-white"
                    : "border border-surface-2 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {b.name}
                <span className={`ml-1.5 text-[10px] ${board === b.name ? "text-white/70" : "text-faint"}`}>
                  {b.site}
                </span>
              </button>
            ))}
          </div>

          {/* 榜单 */}
          <div className="mt-6 rounded-card border border-surface-2 bg-surface/50">
            <div className="border-b border-surface-2 px-6 py-3.5">
              <h2 className="text-sm font-semibold text-zinc-200">
                {board}
                {loading && <span className="ml-2 text-xs font-normal text-faint">加载中…</span>}
              </h2>
            </div>
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-12">
                <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
                <span className="text-sm text-muted">正在拉取榜单…</span>
              </div>
            ) : (
            <ul className="divide-y divide-surface-2">
              {demoRows.map((r) => (
                <li key={r.rank} className="flex items-center gap-4 px-6 py-3.5">
                  <span
                    className={`w-6 text-center font-mono text-sm ${
                      r.rank <= 3 ? "font-semibold text-accent" : "text-faint"
                    }`}
                  >
                    {String(r.rank).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm text-zinc-200">{r.name}</span>
                  <span className="text-xs text-faint">{r.heat}</span>
                </li>
              ))}
            </ul>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-faint">
            榜单数据源接入中，当前为界面示意
          </p>
        </>
      )}

      {!enabled && (
        <div className="mt-10 rounded-card border border-dashed border-surface-2 px-8 py-16 text-center">
          <Trophy size={26} weight="duotone" className="mx-auto text-zinc-500" aria-hidden />
          <p className="mt-4 text-sm text-muted">打开扫榜开关，开始跟踪热门作品</p>
        </div>
      )}
    </main>
  );
}
