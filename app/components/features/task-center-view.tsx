"use client";
// 任务中心（票 09 折回，2026-08-17 定案 B+C）：三列看板为主，点卡片展开驾驶舱式详情。
// 数据源：GET /api/v1/runtime/jobs（4s 轮询）；详情 GET /api/v1/runtime/jobs/[jobId]。
// 动作：重试 POST retry {stepId}（仅可恢复失败）；取消 POST cancel；结束 POST end（仅非终态）。
import { useCallback, useEffect, useState } from "react";
import { X, ArrowClockwise, Prohibit, ListChecks } from "@phosphor-icons/react";
import {
  answerFiveQuestions,
  canEnd,
  categorizeJob,
  formatEventLabel,
  retryTarget,
  sumTokens,
  type BoardColumn,
} from "@/lib/tasks/ui-model";
import type { TaskStatus } from "@/lib/tasks/status";

/* ---------- API 形状（drizzle 表行 JSON 序列化） ---------- */
interface JobRow {
  jobId: string;
  status: string;
  operation: string;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
interface StepRow {
  id: number;
  stepKey: string;
  ordinal: number;
  status: string;
  outputArtifactId: string | null;
  attemptCount: number;
}
interface AttemptRow {
  id: number;
  stepId: number;
  attemptNo: number;
  trigger: string;
  provider: string | null;
  model: string | null;
  status: string;
  errorClass: string | null;
  promptTokens: number;
  completionTokens: number;
}
interface EventRow {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
interface JobDetail {
  job: JobRow;
  steps: StepRow[];
  attempts: AttemptRow[];
  events: EventRow[];
}

const POLL_MS = 4000;

const OP_LABEL: Record<string, string> = {
  chapter_generation: "章节续写",
  deconstruction: "长篇拆解",
  import: "导入",
  ranking_scan: "榜单扫描",
  market_brief: "市场简报",
  cover_generation: "封面生成",
};

const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  planned: { label: "已规划", cls: "bg-zinc-400/10 text-zinc-400" },
  queued: { label: "排队中", cls: "bg-zinc-400/10 text-zinc-400" },
  running: { label: "进行中", cls: "bg-sky-400/10 text-sky-400" },
  waiting_retry: { label: "等待重试", cls: "bg-amber-400/10 text-amber-400" },
  succeeded: { label: "已完成", cls: "bg-emerald-400/10 text-emerald-400" },
  failed: { label: "失败", cls: "bg-red-400/10 text-red-400" },
  cancelled: { label: "已取消", cls: "bg-zinc-400/10 text-zinc-400" },
};

const TRIGGER_LABEL: Record<string, string> = {
  initial: "首次",
  auto_retry: "自动重试",
  manual_retry: "人工重试",
  recovery_reissue: "恢复补发",
};

const OUTCOME_LABEL: Record<string, string> = {
  succeeded: "成功",
  failed_recoverable: "可恢复",
  failed_terminal: "终态",
  state_degraded: "状态降级",
};

const COLUMN_META: Record<BoardColumn, { title: string; dot: string }> = {
  active: { title: "进行中", dot: "bg-sky-400" },
  failed: { title: "失败待处理", dot: "bg-red-400" },
  done: { title: "已完成", dot: "bg-emerald-400" },
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });

export function TaskCenterView() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/runtime/jobs?limit=100");
      if (res.status === 401) {
        setListError("未登录，请刷新页面重新登录");
        return;
      }
      if (!res.ok) {
        setListError(`任务列表加载失败（${res.status}）`);
        return;
      }
      const body = (await res.json()) as { jobs: JobRow[] };
      setJobs(body.jobs);
      setListError(null);
    } catch {
      // 轮询中的瞬时网络错误：保留旧数据，不打断
    }
  }, []);

  const refreshDetail = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/v1/runtime/jobs/${jobId}`);
      if (!res.ok) return;
      setDetail((await res.json()) as JobDetail);
    } catch {
      // 保留旧详情
    }
  }, []);

  useEffect(() => {
    const initialRefresh = setTimeout(() => {
      void refreshList();
    }, 0);
    const t = setInterval(() => {
      void refreshList();
      if (selected) void refreshDetail(selected);
    }, POLL_MS);
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(t);
    };
  }, [refreshList, refreshDetail, selected]);

  useEffect(() => {
    const loadDetail = setTimeout(() => {
      if (!selected) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      setActionMsg(null);
      void refreshDetail(selected).finally(() => setDetailLoading(false));
    }, 0);
    return () => clearTimeout(loadDetail);
  }, [selected, refreshDetail]);

  const runAction = async (path: string, body?: unknown) => {
    if (!selected || busy) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/v1/runtime/jobs/${selected}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setActionMsg({ ok: false, text: err?.error ?? `操作失败（${res.status}）` });
        return;
      }
      await Promise.all([refreshList(), refreshDetail(selected)]);
      setActionMsg({ ok: true, text: "已执行，列表已刷新" });
    } catch {
      setActionMsg({ ok: false, text: "网络错误，操作未完成" });
    } finally {
      setBusy(false);
    }
  };

  const columns: Record<BoardColumn, JobRow[]> = {
    active: [],
    failed: [],
    done: [],
  };
  for (const j of jobs ?? []) {
    columns[categorizeJob(j.status as TaskStatus)].push(j);
  }

  const detailFive = detail
    ? answerFiveQuestions(detail.job, detail.steps, detail.attempts)
    : null;
  const retryStepId = detail ? retryTarget(detail.job, detail.steps) : null;
  const endable = detail ? canEnd(detail.job.status as TaskStatus) : false;
  const detailStatus = detail?.job.status as TaskStatus | undefined;
  const cancelable = detailStatus === "queued" || detailStatus === "running";
  const detailTokens = detail ? sumTokens(detail.attempts) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ListChecks size={20} weight="duotone" className="text-accent" aria-hidden />
          <h1 className="text-lg font-semibold text-zinc-100">任务中心</h1>
          <span className="text-xs text-faint">每 4 秒自动刷新</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {jobs === null ? (
            <span className="text-faint">加载中…</span>
          ) : (
            <>
              <span className="flex items-center gap-1.5 rounded-full bg-sky-400/10 px-2.5 py-1 text-sky-400">
                <i className="size-1.5 rounded-full bg-sky-400" aria-hidden /> 进行中 {columns.active.length}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-red-400/10 px-2.5 py-1 text-red-400">
                <i className="size-1.5 rounded-full bg-red-400" aria-hidden /> 失败 {columns.failed.length}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-400">
                <i className="size-1.5 rounded-full bg-emerald-400" aria-hidden /> 完成 {columns.done.length}
              </span>
            </>
          )}
        </div>
      </header>

      {listError && (
        <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {listError}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-3">
        {(Object.keys(COLUMN_META) as BoardColumn[]).map((col) => (
          <section key={col} className="flex min-h-0 flex-col rounded-2xl border border-surface-2 bg-surface/60">
            <header className="flex items-center gap-2 px-4 py-3">
              <i className={`size-2 rounded-full ${COLUMN_META[col].dot}`} aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-200">{COLUMN_META[col].title}</h2>
              <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-faint">
                {columns[col].length}
              </span>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
              {jobs !== null && columns[col].length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-faint">
                  {col === "active" && jobs.length === 0 ? "还没有任务" : "暂无"}
                </p>
              )}
              {columns[col].map((j) => {
                const meta = STATUS_META[j.status as TaskStatus] ?? STATUS_META.planned;
                return (
                  <button
                    key={j.jobId}
                    type="button"
                    onClick={() => setSelected(selected === j.jobId ? null : j.jobId)}
                    className={"w-full rounded-xl border border-surface-2 bg-surface px-3 py-2.5 text-left transition hover:border-accent/40 " + (selected === j.jobId ? "border-accent/60 bg-accent/5" : "")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                      <span className="text-[10px] tabular-nums text-faint">{fmtTime(j.updatedAt)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-sm text-zinc-100">{OP_LABEL[j.operation] ?? j.operation}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
                      {j.jobId.slice(0, 8)}
                      {j.errorClass ? ` · ${j.errorClass}` : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {selected && (
        <>
          <button
            type="button"
            aria-label="关闭详情"
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setSelected(null)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-surface-2 bg-surface-3 shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-surface-2 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-zinc-100">
                    {detail ? OP_LABEL[detail.job.operation] ?? detail.job.operation : "加载中…"}
                  </h2>
                  {detailStatus && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${(STATUS_META[detailStatus] ?? STATUS_META.planned).cls}`}>
                      {(STATUS_META[detailStatus] ?? STATUS_META.planned).label}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-faint">{selected}</p>
                {detail?.job.errorMessage && (
                  <p className="mt-1 text-xs text-red-300">{detail.job.errorMessage}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="关闭"
                className="shrink-0 rounded-lg p-1.5 text-faint transition hover:bg-surface-2 hover:text-zinc-100"
              >
                <X size={16} aria-hidden />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {!detail || detailLoading ? (
                <p className="py-10 text-center text-xs text-faint">加载详情…</p>
              ) : (
                <>
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">五问仪表</h3>
                    <div className="grid grid-cols-5 gap-1.5 text-center">
                      {[
                        { k: "状态", v: STATUS_META[detailFive!.status]?.label ?? detailFive!.status },
                        { k: "尝试", v: detailFive!.lastAttempt ? `#${detailFive!.lastAttempt.attemptNo}` : "—" },
                        { k: "可恢复", v: OUTCOME_LABEL[detailFive!.outcomeClass] ?? detailFive!.outcomeClass },
                        { k: "消耗", v: detailTokens ? `${detailTokens.prompt + detailTokens.completion} tok` : "—" },
                        { k: "产物", v: detailFive!.artifactAvailable ? "可用" : "—" },
                      ].map((cell) => (
                        <div key={cell.k} className="rounded-lg border border-surface-2 bg-surface px-1 py-2">
                          <div className="text-[10px] text-faint">{cell.k}</div>
                          <div className="mt-1 truncate text-[11px] font-medium text-zinc-100" title={cell.v}>{cell.v}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {(retryStepId !== null || endable || cancelable) && (
                    <section className="mt-4 flex gap-2">
                      {retryStepId !== null && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction("/retry", { stepId: retryStepId })}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
                        >
                          <ArrowClockwise size={15} weight="bold" aria-hidden /> 重试
                        </button>
                      )}
                      {cancelable && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction("/cancel")}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-400/30 px-3 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-300/60 disabled:opacity-50"
                        >
                          <Prohibit size={15} weight="bold" aria-hidden /> 取消任务
                        </button>
                      )}
                      {endable && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction("/end", { reason: "人工结束" })}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-surface-2 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
                        >
                          <Prohibit size={15} weight="bold" aria-hidden /> 结束任务
                        </button>
                      )}
                    </section>
                  )}
                  {actionMsg && (
                    <p className={"mt-2 rounded-lg px-3 py-1.5 text-xs " + (actionMsg.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300")}>
                      {actionMsg.text}
                    </p>
                  )}

                  <section className="mt-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
                      尝试记录（{detail.attempts.length}）
                    </h3>
                    {detail.attempts.length === 0 ? (
                      <p className="text-xs text-faint">暂无尝试记录</p>
                    ) : (
                      <div className="space-y-1.5">
                        {detail.attempts.map((a) => (
                          <div key={a.id} className="rounded-lg border border-surface-2 bg-surface px-3 py-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-zinc-200">
                                #{a.attemptNo} · {TRIGGER_LABEL[a.trigger] ?? a.trigger}
                              </span>
                              <span className="text-faint">
                                {a.promptTokens + a.completionTokens} tok
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[11px]">
                              <span className={a.status === "succeeded" ? "text-emerald-400" : a.status === "running" ? "text-sky-400" : "text-red-400"}>
                                {a.status}
                              </span>
                              {a.errorClass && <span className="text-faint">{a.errorClass}</span>}
                              {a.model && <span className="ml-auto truncate text-faint">{a.model}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="mt-5 pb-6">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
                      事件时间线（{detail.events.length}）
                    </h3>
                    {detail.events.length === 0 ? (
                      <p className="text-xs text-faint">暂无事件</p>
                    ) : (
                      <ol className="space-y-1">
                        {detail.events.map((ev) => (
                          <li key={ev.seq} className="flex items-baseline gap-2 rounded-lg px-2 py-1 text-xs hover:bg-surface">
                            <span className="shrink-0 font-mono text-[10px] text-faint">#{ev.seq}</span>
                            <span className="min-w-0 flex-1 truncate text-zinc-200" title={ev.eventType}>
                              {formatEventLabel(ev)}
                            </span>
                            {typeof ev.payload.tokens === "number" && (
                              <span className="shrink-0 text-[10px] text-faint">{ev.payload.tokens} tok</span>
                            )}
                            <span className="shrink-0 text-[10px] tabular-nums text-faint">{fmtTime(ev.createdAt)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
