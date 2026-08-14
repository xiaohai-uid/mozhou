"use client";

// 小说拆解：书名搜索只提供书目元数据；真正拆解必须使用用户上传/拥有的正文。
// 上传正文后进入真实 LLM 三段式拆解（结构/剧情/节奏），不使用固定演示章节。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MagnifyingGlass, TreeStructure } from "@phosphor-icons/react/dist/ssr";

interface DeconstructResult {
  structure: string[];
  plot: string[];
  rhythm: string[];
  mode: "long" | "short";
  stages: Array<{ stage: number; name: string; status: string; artifact: Record<string, unknown> }>;
  quality: { sourceLength: number; chapterCount: number; completedStages: number[]; warnings: string[] };
}

interface LocalChapter {
  ch: string;
  title: string;
  words: string;
  text: string;
}

interface SourceResult {
  source: string;
  sourceLabel: string;
  name: string;
  author: string;
  site: string;
  status: string;
  capturedAt?: string;
  url?: string;
}

interface SavedRun {
  id: number;
  title: string;
  sourceLength: number;
  status: string;
  result?: DeconstructResult | null;
  errorMessage?: string | null;
  lastErrorClass?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
}

export function DeconstructView() {
  const router = useRouter();
  const [tab, setTab] = useState<"search" | "upload">("search");
  const [mode, setMode] = useState<"long" | "short">("short");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chapters, setChapters] = useState<LocalChapter[]>([]);
  const [sourceResults, setSourceResults] = useState<SourceResult[]>([]);
  const [sourceSearching, setSourceSearching] = useState(false);
  const [sourceDegraded, setSourceDegraded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeconstructResult | null>(null);
  const [resultTitle, setResultTitle] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const analysisRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    void fetch("/api/v1/deconstruct/runs")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { runs?: SavedRun[] } | null) => {
        if (data?.runs) setSavedRuns(data.runs);
      })
      .catch(() => undefined);
  }, []);

  async function analyze() {
    const chapter = chapters.find((c) => c.ch === selected);
    if (!chapter || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    const requestKey = analysisRequestKeyRef.current ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    analysisRequestKeyRef.current = requestKey;
    try {
      const res = await fetch("/api/v1/deconstruct/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chapter.text, title: chapter.title, requestKey, mode }),
      });
      const data = (await res.json()) as {
        result?: DeconstructResult;
        runId?: number;
        title?: string;
        error?: string;
        errorClass?: string;
        workflow?: string;
      };
      if (!res.ok) {
        if (data.runId) {
          setRunId(data.runId);
          setSavedRuns((previous) => [
            {
              id: data.runId!,
              title: data.title ?? chapter.title,
              sourceLength: chapter.text.length,
              status: "failed",
              errorMessage: data.error ?? "拆解失败",
              lastErrorClass: data.errorClass,
            },
            ...previous.filter((run) => run.id !== data.runId),
          ]);
        }
        throw new Error(`${data.error ?? "拆解失败"}${data.errorClass ? `（${data.errorClass}）` : ""}`);
      }
      setResult(data.result ?? null);
      setResultTitle(data.title ?? chapter.title);
      setRunId(data.runId ?? null);
      if (data.runId) {
        setSavedRuns((previous) => [
          { id: data.runId!, title: data.title ?? chapter.title, sourceLength: chapter.text.length, status: "completed", result: data.result },
          ...previous.filter((run) => run.id !== data.runId),
        ]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function searchSources() {
    const value = query.trim();
    if (!value || sourceSearching) return;
    setSourceSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: SourceResult[];
        degraded?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "搜索失败");
      setSourceResults(data.results ?? []);
      setSourceDegraded(data.degraded ?? false);
      setPicked(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSourceSearching(false);
    }
  }

  function loadTextFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    void file.text().then((text) => {
      const value = text.trim();
      if (value.length < 200) {
        throw new Error("文本太短，至少需要 200 个字符才能拆解");
      }
      const title = file.name.replace(/\.txt$/i, "") || "上传章节";
      setChapters([{ ch: "001", title, words: `${value.length} 字`, text: value }]);
      analysisRequestKeyRef.current = null;
      setSelected("001");
      setPicked(true);
    }).catch((err: unknown) => setError((err as Error).message));
  }

  async function importAsNovel() {
    const chapter = chapters.find((c) => c.ch === selected);
    if (!chapter || importing) return;
    setImporting(true);
    setError(null);
    const requestKey = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await fetch("/api/v1/novels/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: resultTitle ?? chapter.title, content: chapter.text, requestKey }),
      });
      const data = (await res.json()) as {
        novel?: { id: number; name: string };
        chapter?: { id: number; ch: string; title: string };
        error?: string;
      };
      if (!res.ok || !data.novel || !data.chapter) throw new Error(data.error ?? "导入作品失败");
      router.push(
        `/chapter/${data.chapter.id}?novelId=${data.novel.id}&novel=${encodeURIComponent(data.novel.name)}&ch=${data.chapter.ch}&title=${encodeURIComponent(data.chapter.title)}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">小说拆解</h1>
      <p className="mt-2 text-sm text-muted">输入书名或上传文本，拆解结构、剧情与节奏</p>

      {/* 输入方式切换 */}
      <div className="mt-8 flex gap-2">
        {(
          [
            { key: "search", label: "搜索书名" },
            { key: "upload", label: "上传文本" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setPicked(false);
              setSelected(null);
              setChapters([]);
              setSourceResults([]);
              setSourceDegraded(false);
              setResult(null);
              setRunId(null);
              analysisRequestKeyRef.current = null;
              setError(null);
            }}
            className={`rounded-full px-5 py-2 text-sm transition ${
              tab === t.key
                ? "bg-accent text-white"
                : "border border-surface-2 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 输入区 */}
      {!picked && (
        <div className="mt-6">
          {tab === "search" ? (
            <form
              className="flex gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void searchSources();
              }}
            >
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-surface-2 bg-zinc-950 px-4 py-3 transition focus-within:border-accent">
                <MagnifyingGlass size={18} className="shrink-0 text-faint" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="输入书名"
                  aria-label="书名"
                  className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-faint"
                />
              </div>
              <button
                type="submit"
                disabled={!query.trim()}
                className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                {sourceSearching ? "搜索中…" : "搜索书目"}
              </button>
            </form>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed border-surface-2 px-8 py-12 text-center transition hover:border-zinc-600">
              <FileText size={26} weight="duotone" className="text-zinc-400" aria-hidden />
              <span className="text-sm text-zinc-200">点击选择或拖入 .txt 文本</span>
              <input
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => loadTextFile(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
      )}

      {picked && tab === "search" && (
        <div className="mt-6 space-y-3">
          {sourceDegraded && (
            <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-400">
              书源不可达，下面的书目仅为降级提示，不能直接作为拆解正文。
            </p>
          )}
          <div className="rounded-card border border-surface-2 bg-surface/50 px-5 py-4">
            <p className="text-sm text-zinc-200">已找到 {sourceResults.length} 条书目元数据</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              书目搜索不会自动抓取或复制正文。请上传你拥有使用权的 .txt 正文，再开始拆解。
            </p>
            <label className="mt-3 inline-flex cursor-pointer rounded-full border border-accent/50 px-4 py-2 text-xs text-accent transition hover:bg-accent/10">
              上传可拆解正文
              <input
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => loadTextFile(e.target.files?.[0])}
              />
            </label>
          </div>
        </div>
      )}

      {/* 章节选择 */}
      {picked && !result && !analyzing && (
        <div className="mt-6">
          <div className="mb-4 rounded-xl border border-surface-2 bg-surface/50 p-4">
            <p className="text-xs font-medium text-zinc-200">拆解管道</p>
            <div className="mt-3 flex gap-2">
              {(["short", "long"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${mode === value ? "bg-accent text-white" : "border border-surface-2 text-muted hover:text-zinc-200"}`}
                >
                  {value === "short" ? "短篇 Stage 0/2–6" : "长篇 Stage 0–6"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-faint">
              长篇包含黄金三章；短篇走独立的短篇结构、情绪与反转管道。结果会保存为可恢复的阶段产物。
            </p>
          </div>
          <h2 className="text-sm font-semibold text-zinc-200">选择要拆解的章节</h2>
          <ul className="mt-4 space-y-2">
            {chapters.map((c) => (
              <li key={c.ch}>
                <button
                  onClick={() => setSelected(c.ch)}
                  className={`flex w-full items-center justify-between rounded-xl border px-5 py-3 text-left transition ${
                    selected === c.ch
                      ? "border-accent/60 bg-accent/10"
                      : "border-surface-2 bg-surface/50 hover:border-zinc-600"
                  }`}
                >
                  <span className="text-sm text-zinc-200">
                    <span className="mr-2 font-mono text-xs text-faint">{c.ch}</span>
                    {c.title}
                  </span>
                  <span className="text-xs text-faint">{c.words}</span>
                </button>
              </li>
            ))}
          </ul>
          {chapters.length === 0 && (
            <p className="rounded-xl border border-dashed border-surface-2 px-4 py-4 text-center text-xs text-faint">
              还没有可拆解的正文，请先上传 .txt 文件。
            </p>
          )}
          <button
            onClick={() => void analyze()}
            disabled={!selected || analyzing}
            className="mt-6 w-full rounded-full bg-accent py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {analyzing ? "拆解中…" : "开始拆解"}
          </button>
          <button
            onClick={() => void importAsNovel()}
            disabled={!selected || importing || analyzing}
            className="mt-2 w-full rounded-full border border-accent/50 py-3 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-40"
          >
            {importing ? "导入中…" : "直接导入为新作品并开始写作"}
          </button>
        </div>
      )}

      {/* 拆解中 */}
      {analyzing && (
        <div className="mt-6 flex items-center justify-center gap-3 rounded-card border border-surface-2 bg-surface/50 py-12">
          <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="text-sm text-muted">AI 正在拆解章节…</span>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}

      {savedRuns.length > 0 && !result && (
        <div className="mt-6 rounded-card border border-surface-2 bg-surface/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">可恢复的拆解结果</h2>
          <ul className="mt-3 space-y-2">
          {savedRuns.slice(0, 8).map((run) => (
            <li key={run.id} className="flex items-center justify-between gap-3 rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-200">{run.title}</p>
                <p className="mt-1 text-[10px] text-faint">#{run.id} · {run.sourceLength} 字 · {run.status === "completed" ? "已完成" : run.status === "failed" ? `失败${run.lastErrorClass ? ` · ${run.lastErrorClass}` : ""}` : run.status}</p>
                {run.status === "failed" && run.errorMessage && <p className="mt-1 text-[10px] text-red-300">{run.errorMessage}</p>}
              </div>
                {run.status === "completed" && run.result && (
                  <button
                    type="button"
                    onClick={() => {
                      setResult(run.result ?? null);
                      setResultTitle(run.title);
                      setRunId(run.id);
                    }}
                    className="shrink-0 rounded-full border border-accent/50 px-3 py-1 text-[11px] text-accent hover:bg-accent/10"
                  >
                    查看结果
                  </button>
                )}
                {run.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => {
                      setError("失败运行已保留；为保护正文隐私，请重新上传同一正文后再执行。");
                      setResult(null);
                      analysisRequestKeyRef.current = null;
                      setTab("upload");
                      setPicked(false);
                      setSelected(null);
                      setChapters([]);
                    }}
                    className="shrink-0 rounded-full border border-yellow-500/50 px-3 py-1 text-[11px] text-yellow-300 hover:bg-yellow-500/10"
                  >
                    重新执行
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 结果 */}
      {result && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <TreeStructure size={18} weight="duotone" className="text-accent" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-100">
                第 {selected} 章拆解{resultTitle ? ` · ${resultTitle}` : ""}
              </h2>
              {runId && <span className="text-[10px] text-faint">已保存运行 #{runId}</span>}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { name: "结构", lines: result.structure },
              { name: "剧情", lines: result.plot },
              { name: "节奏", lines: result.rhythm },
            ].map((b) => (
              <div key={b.name} className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-faint">
                  {b.name}
                </h3>
                <ul className="mt-3 space-y-2">
                  {b.lines.map((line) => (
                    <li key={line} className="text-xs leading-5 text-zinc-300">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-faint">阶段化产物</h3>
              <span className="text-[10px] text-faint">
                {result.mode === "long" ? "长篇 Stage 0–6" : "短篇 Stage 0/2–6"} · {result.quality.chapterCount || "—"} 章
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              {result.stages.map((stage) => (
                <div key={stage.stage} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <p className="text-[10px] text-emerald-300">Stage {stage.stage} · 已完成</p>
                  <p className="mt-1 text-xs text-zinc-300">{stage.name}</p>
                </div>
              ))}
            </div>
            {result.quality.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-[11px] text-yellow-400">
                {result.quality.warnings.map((warning) => <li key={warning}>⚠ {warning}</li>)}
              </ul>
            )}
          </div>
          {/* R1/R2 回流：发送到写作对话（拆解结果→消息插入类） */}
          <button
            onClick={() => {
              const blocks = [
                { name: "结构", lines: result.structure },
                { name: "剧情", lines: result.plot },
                { name: "节奏", lines: result.rhythm },
              ];
              sessionStorage.setItem(
                "mozhou_pending_deconstruct",
                JSON.stringify({
                  chapter: selected,
                  blocks,
                  at: Date.now(),
                }),
              );
              router.push("/chat");
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-accent/50 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/10"
          >
            <TreeStructure size={15} weight="duotone" aria-hidden />
            发送到写作对话
          </button>
        </div>
      )}
    </main>
  );
}
