"use client";

// 小说拆解（09 工单已真实化）：输入书名/上传 → 章节选择 → 真实 LLM 三段式拆解（结构/剧情/节奏）。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MagnifyingGlass, TreeStructure } from "@phosphor-icons/react/dist/ssr";

interface DeconstructResult {
  structure: string[];
  plot: string[];
  rhythm: string[];
}

/** 各章节拆解用文本（demo；真实场景由书源/上传提供，08 工单接通） */
const demoChapters = [
  { ch: "001", title: "灰烬有籽", words: "3120 字", text: "灰烬镇。灯童与陆沉舟立约：你守田，我守灯。灰里开田，第一铲下去，土是活的。阿雀守着灰罐里的火苗，火苗偏斜，指向零界。肃界卫盘查回程，守塔人未曾露面。田师说，田是它的。灰烬镇的人们在夜里听见铁灰飞鸟掠过，谁也没有抬头。" },
  { ch: "002", title: "灰里有苗", words: "2980 字", text: "第二日，田里冒出青苗。陆沉舟蹲在田埂上，指腹摩过叶尖的灰。阿雀坐在门槛，火苗在她眼底跳。肃界卫清晨经过，问苗从何来。陆沉舟说，灰里生的。他们知道，灰烬镇不该有绿色。" },
  { ch: "003", title: "灰里藏灯", words: "3050 字", text: "夜里，灯童听见罐中有声。火苗不再偏斜，直直指向天空。陆沉舟解开灯芯，里面卷着一枚铁片，刻着零界的字样。阿雀咳嗽着醒来，说梦见了海。灰烬镇没有海，但铁片上的字，像潮水。" },
];

export function DeconstructView() {
  const router = useRouter();
  const [tab, setTab] = useState<"search" | "upload">("search");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeconstructResult | null>(null);
  const [resultTitle, setResultTitle] = useState<string | null>(null);

  async function analyze() {
    const chapter = demoChapters.find((c) => c.ch === selected);
    if (!chapter || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/deconstruct/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chapter.text, title: chapter.title }),
      });
      const data = (await res.json()) as {
        result?: DeconstructResult;
        title?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "拆解失败");
      setResult(data.result ?? null);
      setResultTitle(data.title ?? chapter.title);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
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
              setResult(null);
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
                if (query.trim()) setPicked(true);
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
                下一步
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
                onChange={() => setPicked(true)}
              />
            </label>
          )}
        </div>
      )}

      {/* 章节选择 */}
      {picked && !result && !analyzing && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-200">选择要拆解的章节</h2>
          <ul className="mt-4 space-y-2">
            {demoChapters.map((c) => (
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
          <button
            onClick={() => void analyze()}
            disabled={!selected || analyzing}
            className="mt-6 w-full rounded-full bg-accent py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {analyzing ? "拆解中…" : "开始拆解"}
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

      {/* 结果 */}
      {result && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <TreeStructure size={18} weight="duotone" className="text-accent" aria-hidden />
            <h2 className="text-sm font-semibold text-zinc-100">
              第 {selected} 章拆解{resultTitle ? ` · ${resultTitle}` : ""}
            </h2>
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
