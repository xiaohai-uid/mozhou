"use client";

// 小说拆解（UI 先行）：输入书名/上传 → 章节选择 → 拆解结果。
// 交互对齐 OpenWrite 实测（弹窗式：搜索/上传 → 选章节 → AI 生成大纲）。
import { useState } from "react";
import { FileText, MagnifyingGlass, TreeStructure } from "@phosphor-icons/react/dist/ssr";

const demoChapters = [
  { ch: "001", title: "灰烬有籽", words: "3120 字" },
  { ch: "002", title: "灰里有苗", words: "2980 字" },
  { ch: "003", title: "灰里藏灯", words: "3050 字" },
];

export function DeconstructView() {
  const [tab, setTab] = useState<"search" | "upload">("search");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [done, setDone] = useState(false);

  function analyze() {
    setAnalyzing(true);
    setDone(false);
    setTimeout(() => {
      setAnalyzing(false);
      setDone(true);
    }, 1800);
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
              setDone(false);
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
      {picked && !done && (
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
            onClick={analyze}
            disabled={!selected || analyzing}
            className="mt-6 w-full rounded-full bg-accent py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {analyzing ? "拆解中…" : "开始拆解"}
          </button>
        </div>
      )}

      {/* 结果 */}
      {done && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <TreeStructure size={18} weight="duotone" className="text-accent" aria-hidden />
            <h2 className="text-sm font-semibold text-zinc-100">
              第 {selected} 章拆解
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { name: "结构", lines: ["开场：灰罐火苗偏斜", "中段：阿雀醒来对话", "收束：铁灰飞鸟掠过"] },
              { name: "剧情", lines: ["伏笔：火苗朝零界偏斜", "人物：陆沉舟夜间外出", "推进：灯芯与药引"] },
              { name: "节奏", lines: ["短句密（对话段）", "缓（景物描写）", "悬（结尾鸟飞向零界）"] },
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
          <p className="text-center text-xs text-faint">拆解引擎开发中，当前为界面示意</p>
        </div>
      )}
    </main>
  );
}
