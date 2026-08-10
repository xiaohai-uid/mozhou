"use client";

// 网文扫榜（任务二-C 已真实化）：榜单数据走 /api/v1/rankings（超时优雅降级）。
import { useState } from "react";
import { ToggleLeft, ToggleRight, Trophy } from "@phosphor-icons/react/dist/ssr";

interface RankingBoard {
  name: string;
  site: string;
}

interface RankingRow {
  rank: number;
  name: string;
  heat: string;
}

export function RankingsView() {
  const [enabled, setEnabled] = useState(false);
  const [boards, setBoards] = useState<RankingBoard[]>([]);
  const [board, setBoard] = useState("");
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function fetchRankings() {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/rankings");
      if (!res.ok) throw new Error("榜单加载失败");
      const data = (await res.json()) as {
        boards?: RankingBoard[];
        rows?: RankingRow[];
        degraded?: boolean;
        note?: string;
      };
      if (data.boards && data.boards.length > 0 && !board) {
        setBoards(data.boards);
        setBoard(data.boards[0].name);
      }
      setRows(data.rows ?? []);
      setDegraded(data.degraded ?? false);
      setNote(data.note ?? null);
    } catch {
      setDegraded(true);
      setNote("榜单加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function toggleEnabled() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    await fetchRankings();
    setEnabled(true);
  }

  async function switchBoard(name: string) {
    if (name === board || loading) return;
    setBoard(name);
    await fetchRankings();
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
            <>
              {degraded && (
                <div className="flex items-center gap-2 border-b border-surface-2 bg-yellow-500/5 px-6 py-2.5 text-xs text-yellow-400">
                  <span className="inline-block size-1.5 shrink-0 rounded-full bg-yellow-400" aria-hidden />
                  {note ?? "榜单源不可达，已降级为示例数据"}
                </div>
              )}
              <ul className="divide-y divide-surface-2">
                {rows.map((r) => (
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
            </>
            )}
          </div>
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
