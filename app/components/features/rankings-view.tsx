"use client";

import { useMemo, useRef, useState } from "react";
import { ToggleLeft, ToggleRight, Trophy } from "@phosphor-icons/react/dist/ssr";

// 网文扫榜（任务二-C 已真实化）：榜单数据走 /api/v1/rankings（超时优雅降级）。
// T4 趋势：并行 GET /api/v1/rankings/trends 渲染 V3 双横区（上升最快/新进榜）+ 行内 delta 徽标；
// POST /api/v1/rankings/scan 扫榜（429 冷却提示）；惰性 24h 自动扫榜（localStorage lastScanAt）。

const LAST_SCAN_KEY = "mozhou.rankings.lastScanAt";
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

interface RankingBoard {
  id: string;
  displayName: string;
  sourceKind: string;
  workLength: "long" | "short";
  rankingKind: string;
  listUrl: string;
  enabled: boolean;
}

interface RankingRow {
  bookId: string;
  rank: number;
  name: string;
  source: string;
  sourceUrl: string;
  detailUrl: string;
  titleResolution: string;
  capturedAt?: string;
  author?: string;
  readerCount?: number;
}

type TrendDelta = "up" | "down" | "flat" | "new" | "gone";

interface TrendRow {
  bookId: string;
  name: string;
  rank: number;
  prevRank: number | null;
  delta: TrendDelta;
  deltaValue: number;
}

interface GoneRow {
  bookId: string;
  name: string;
  rank: number;
}

interface TrendData {
  baseline: string | null;
  current: string;
  rows: TrendRow[];
  risers: TrendRow[];
  newEntries: TrendRow[];
  gone: GoneRow[];
}

type TrendState = "idle" | "loading" | "ok" | "no-snapshot" | "error";

function readLastScanMs(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SCAN_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLastScanMs(ms: number) {
  try {
    window.localStorage.setItem(LAST_SCAN_KEY, String(ms));
  } catch {
    /* 忽略存储不可用 */
  }
}

function formatHeat(n?: number): string {
  if (n == null) return "";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

/** 榜单行涨跌徽标（V3 视觉语言：↑绿 / ↓红 / —灰 / 新进蓝 / 跌出红灰）。 */
function DeltaBadge({ delta, prevRank, rank }: { delta: TrendDelta; prevRank: number | null; rank?: number }) {
  if (delta === "gone") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/8 px-2 py-0.5 text-[11px] font-semibold text-red-400/70">
        跌出
      </span>
    );
  }
  if (delta === "new") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-400">
        新进
      </span>
    );
  }
  if (delta === "up") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
        ↑{prevRank != null ? prevRank - (rank ?? 0) : 0}
        <span className="text-[10px] font-normal opacity-70">{prevRank}→{rank}名</span>
      </span>
    );
  }
  if (delta === "down") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
        ↓{rank != null && prevRank != null ? rank - prevRank : 0}
        <span className="text-[10px] font-normal opacity-70">{prevRank}→{rank}名</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
      —
    </span>
  );
}

export function RankingsView() {
  const [enabled, setEnabled] = useState(false);
  const [boards, setBoards] = useState<RankingBoard[]>([]);
  const [board, setBoard] = useState("");
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // 趋势
  const [trend, setTrend] = useState<TrendData | null>(null);
  const [trendState, setTrendState] = useState<TrendState>("idle");

  // 扫榜
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ kind: "cooldown" | "done" | "error"; text: string } | null>(null);
  const autoScanTried = useRef(false);

  // bookId -> delta（供榜单行徽标）
  const deltaByBook = useMemo(() => {
    const m = new Map<string, TrendRow>();
    if (trend) {
      for (const r of trend.rows) m.set(r.bookId, r);
    }
    return m;
  }, [trend]);

  async function fetchTrends(boardId: string) {
    setTrendState("loading");
    setTrend(null);
    try {
      const res = await fetch(`/api/v1/rankings/trends?board=${encodeURIComponent(boardId)}`);
      if (res.status === 404) {
        setTrendState("no-snapshot");
        return;
      }
      if (!res.ok) {
        setTrendState("error");
        return;
      }
      const data = (await res.json()) as {
        baseline?: string | null;
        current?: string;
        rows?: TrendRow[];
        risers?: TrendRow[];
        newEntries?: TrendRow[];
        gone?: GoneRow[];
      };
      setTrend({
        baseline: data.baseline ?? null,
        current: data.current ?? "",
        rows: data.rows ?? [],
        risers: data.risers ?? [],
        newEntries: data.newEntries ?? [],
        gone: data.gone ?? [],
      });
      setTrendState("ok");
    } catch {
      setTrendState("error");
    }
  }

  async function fetchRankings(targetBoard?: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/rankings${targetBoard ? `?board=${encodeURIComponent(targetBoard)}` : ""}`);
      if (!res.ok) throw new Error("榜单加载失败");
      const data = (await res.json()) as {
        boards?: RankingBoard[];
        rows?: RankingRow[];
        degraded?: boolean;
        note?: string;
        capturedAt?: string;
      };
      if (data.boards && data.boards.length > 0) {
        setBoards(data.boards);
        const nextBoard = board || targetBoard || data.boards[0].id;
        if (!board || !targetBoard) setBoard(nextBoard);
      }
      setRows(data.rows ?? []);
      setDegraded(data.degraded ?? false);
      setNote(data.note ?? null);
      // 后端 recent capturedAt 可作为 lastScanAt 下限，避免重复触发
      if (data.capturedAt && readLastScanMs() == null) {
        const t = new Date(data.capturedAt).getTime();
        if (!Number.isNaN(t)) writeLastScanMs(t);
      }
    } catch {
      setDegraded(true);
      setNote("榜单加载失败");
    } finally {
      setLoading(false);
    }
  }

  /** 切换榜源：并行拉取榜单 + 趋势。 */
  async function switchBoard(id: string) {
    if (id === board || loading) return;
    setBoard(id);
    await Promise.all([fetchRankings(id), fetchTrends(id)]);
  }

  /** 触发一次扫榜。auto 为惰性自动触发（静默成功）。 */
  async function runScan(auto = false) {
    if (scanning) return;
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch("/api/v1/rankings/scan", { method: "POST" });
      if (res.status === 429) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
        setScanMsg({
          kind: "cooldown",
          text: data.error ?? `扫榜过于频繁，请 ${data.retryAfter ?? 60} 秒后再试`,
        });
        return;
      }
      if (!res.ok) {
        setScanMsg({ kind: "error", text: "扫榜失败，请稍后再试" });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { capturedAt?: string; rowsInserted?: number };
      // 平账：成功写入 lastScanAt，避免再次惰性触发
      writeLastScanMs(Date.now());
      if (!auto) {
        const seconds = (data.rowsInserted ?? 0) > 0 ? `已写入 ${data.rowsInserted} 条记录` : "本轮无新增记录";
        setScanMsg({ kind: "done", text: `扫榜完成，${seconds}` });
      }
      if (board) {
        await Promise.all([fetchRankings(board), fetchTrends(board)]);
      } else {
        await fetchRankings();
      }
    } catch {
      if (!auto) setScanMsg({ kind: "error", text: "扫榜失败，请稍后再试" });
    } finally {
      setScanning(false);
    }
  }

  /** 惰性触发：距上次扫榜 >=24h 且当前榜 rows 为空 → 自动扫榜一次（每次打开最多一次）。 */
  async function maybeAutoScan() {
    if (autoScanTried.current) return;
    autoScanTried.current = true;
    if (rows.length > 0) return; // 已有数据，无需自动扫
    const last = readLastScanMs();
    if (last != null && Date.now() - last < SCAN_INTERVAL_MS) return; // 24h 内扫过
    await runScan(true);
  }

  async function toggleEnabled() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    await fetchRankings();
    const nextBoard = board || (boards.length > 0 ? boards[0].id : "");
    if (nextBoard) {
      setTrendState("loading");
      await fetchTrends(nextBoard);
      await maybeAutoScan();
    }
    setEnabled(true);
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => void runScan(false)}
            disabled={scanning || loading}
            className="inline-flex items-center gap-2 rounded-full border border-surface-2 bg-surface px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-accent/50 hover:text-white disabled:opacity-50"
          >
            {scanning ? (
              <>
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-surface-2 border-t-accent" aria-hidden />
                扫榜中…
              </>
            ) : (
              "扫榜"
            )}
          </button>
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
      </div>

      {enabled && (
        <>
          {/* 榜源切换 */}
          <div className="mt-8 flex flex-wrap gap-2">
            {boards.map((b) => (
              <button
                key={b.id}
                onClick={() => void switchBoard(b.id)}
                disabled={loading}
                className={`rounded-full px-4 py-2 text-sm transition disabled:opacity-50 ${
                  board === b.id
                    ? "bg-accent text-white"
                    : "border border-surface-2 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {b.displayName}
              </button>
            ))}
          </div>

          {/* V3 双横区：上升最快 / 新进榜 */}
          {trendState === "ok" && trend && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <section className="rounded-card border border-surface-2 bg-surface p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    上升最快
                  </span>
                  TOP 5
                </h3>
                <ul className="divide-y divide-surface-2">
                  {trend.risers.length === 0 && <li className="py-2 text-xs text-faint">今日无上升榜目</li>}
                  {trend.risers.slice(0, 5).map((r, i) => (
                    <li key={r.bookId} className="flex items-center gap-2.5 py-2 text-[13px]">
                      <span className="w-3.5 text-center text-[11px] text-faint">{i + 1}</span>
                      <span className="flex-1 truncate font-medium text-zinc-200">{r.name}</span>
                      <span className="shrink-0 text-[11px] text-faint">
                        <span className="font-semibold text-emerald-400">↑{r.deltaValue}</span> · {r.prevRank}→{r.rank}名
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="rounded-card border border-surface-2 bg-surface p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
                  <span className="rounded-full bg-blue-400/10 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                    新进榜
                  </span>
                  TOP 5
                </h3>
                <ul className="divide-y divide-surface-2">
                  {trend.newEntries.length === 0 && <li className="py-2 text-xs text-faint">今日无新进榜书目</li>}
                  {trend.newEntries.slice(0, 5).map((r, i) => {
                    const joined = rows.find((rr) => rr.bookId === r.bookId);
                    return (
                      <li key={r.bookId} className="flex items-center gap-2.5 py-2 text-[13px]">
                        <span className="w-3.5 text-center text-[11px] text-faint">{i + 1}</span>
                        <span className="flex-1 truncate font-medium text-zinc-200">{r.name}</span>
                        {joined?.readerCount != null ? (
                          <span className="shrink-0 text-[11px] text-faint">{formatHeat(joined.readerCount)} 在读</span>
                        ) : (
                          <span className="shrink-0 text-[11px] text-faint">第{r.rank}名</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          )}

          {/* 榜单 */}
          <div className="mt-6 rounded-card border border-surface-2 bg-surface/50">
            <div className="border-b border-surface-2 px-6 py-3.5">
              <h2 className="text-sm font-semibold text-zinc-200">
                {boards.find((item) => item.id === board)?.displayName ?? board}
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
                    {note ?? "榜单源不可达，未返回虚构榜单"}
                  </div>
                )}
                {trendState === "no-snapshot" && (
                  <div className="flex items-center gap-2 border-b border-surface-2 px-6 py-2.5 text-xs text-faint">
                    <span className="inline-block size-1.5 shrink-0 rounded-full bg-zinc-500" aria-hidden />
                    暂无历史快照，点击「扫榜」后 24 小时可见趋势。
                  </div>
                )}
                <ul className="divide-y divide-surface-2">
                  {rows.map((r) => {
                    const d = deltaByBook.get(r.bookId);
                    return (
                      <li key={r.bookId} className="flex items-center gap-4 px-6 py-3.5">
                        <span
                          className={`w-6 text-center font-mono text-sm ${
                            r.rank <= 3 ? "font-semibold text-accent" : "text-faint"
                          }`}
                        >
                          {String(r.rank).padStart(2, "0")}
                        </span>
                        <span className="flex-1">
                          <span className="block truncate text-sm text-zinc-200">{r.name}</span>
                          {r.readerCount != null && (
                            <span className="mt-0.5 block text-[11px] text-faint">{formatHeat(r.readerCount)} 在读</span>
                          )}
                        </span>
                        {d ? (
                          <DeltaBadge delta={d.delta} prevRank={d.prevRank} rank={r.rank} />
                        ) : (
                          <span className="invisible rounded-full px-2 py-0.5 text-[11px]">—</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {trend && trend.gone.length > 0 && (
                  <>
                    <div className="border-t border-surface-2 px-6 pt-2 text-[11px] text-faint">跌出榜单</div>
                    <ul className="divide-y divide-surface-2">
                      {trend.gone.map((g) => (
                        <li key={g.bookId} className="flex items-center gap-4 px-6 py-3 opacity-55">
                          <span className="w-6 text-center font-mono text-sm text-faint">—</span>
                          <span className="flex-1 truncate text-sm text-zinc-300">{g.name}</span>
                          <DeltaBadge delta="gone" prevRank={null} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {rows.length === 0 && (
                  <div className="px-6 py-10 text-center text-xs text-faint">
                    没有可验证的榜单数据；点击「扫榜」抓取后展示。
                  </div>
                )}
                {rows.length > 0 && (
                  <div className="border-t border-surface-2 px-6 py-2 text-[11px] text-faint">
                    来源：{rows[0].source} · 抓取：
                    {rows[0].capturedAt ? new Date(rows[0].capturedAt).toLocaleString("zh-CN") : "—"}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 扫榜反馈 */}
          {scanMsg && (
            <div
              className={`mt-4 rounded-card border px-4 py-2.5 text-xs ${
                scanMsg.kind === "cooldown"
                  ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-400"
                  : scanMsg.kind === "error"
                    ? "border-red-500/30 bg-red-500/5 text-red-400"
                    : "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
              }`}
            >
              {scanMsg.text}
            </div>
          )}
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
