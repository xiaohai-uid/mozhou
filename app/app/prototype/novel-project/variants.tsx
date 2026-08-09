"use client";

// PROTOTYPE — 三个结构性变体（工单 05 项目页信息架构）
import { useState } from "react";
import { NOVEL, Pill, GhostButton, type Entry } from "./data";

/** A — 三栏工作台：左章节树 | 中正文编辑 | 右设定面板（人物/世界观 tabs） */
export function VariantA() {
  const [activeChapter, setActiveChapter] = useState(1);
  const [tab, setTab] = useState<"人物" | "世界观">("人物");
  const chapter = NOVEL.chapters.find((c) => c.id === activeChapter)!;
  const entries = tab === "人物" ? NOVEL.characters : NOVEL.worldview;

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* 左：章节树 */}
      <aside className="flex w-52 shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium tracking-wide text-zinc-500">
            章节
          </span>
          <GhostButton>＋ 新建</GhostButton>
        </div>
        {NOVEL.chapters.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveChapter(c.id)}
            className={`rounded-md px-3 py-2 text-left text-sm transition ${
              c.id === activeChapter
                ? "bg-violet-600/20 text-violet-300"
                : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            <div className="truncate">{c.title}</div>
            <div className="mt-0.5 text-xs text-zinc-600">
              {c.words.toLocaleString()} 字
            </div>
          </button>
        ))}
        <div className="mt-auto flex items-center gap-1 px-1 text-xs text-zinc-600">
          <button className="hover:text-zinc-400">↑</button>
          <button className="hover:text-zinc-400">↓</button>
          <span className="ml-1">拖拽排序</span>
        </div>
      </aside>

      {/* 中：正文编辑 */}
      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-zinc-800 bg-zinc-900/40">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <h2 className="text-sm font-medium text-zinc-200">{chapter.title}</h2>
          <div className="flex items-center gap-2">
            <Pill>{chapter.words.toLocaleString()} 字</Pill>
            <GhostButton>保存</GhostButton>
          </div>
        </header>
        <textarea
          defaultValue={`${chapter.summary}\n\n（正文编辑区——写作时这里是主要战场）`}
          className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-7 text-zinc-200 outline-none"
        />
      </section>

      {/* 右：设定面板 */}
      <aside className="flex w-60 shrink-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/40">
        <div className="flex border-b border-zinc-800 text-sm">
          {(["人物", "世界观"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 transition ${
                tab === t
                  ? "border-b-2 border-violet-500 text-violet-300"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {entries.map((e: Entry) => (
            <div key={e.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-200">{e.name}</span>
                <button className="text-xs text-zinc-600 hover:text-violet-400">
                  编辑
                </button>
              </div>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-500">
                {e.content}
              </p>
            </div>
          ))}
          <GhostButton>＋ 新增{tab === "人物" ? "人物" : "设定"}</GhostButton>
        </div>
      </aside>
    </div>
  );
}

/** B — 分段导航：项目头 + 内容区整页 tabs（简介/章节/人物/世界观） */
export function VariantB() {
  const [tab, setTab] = useState<"简介" | "章节" | "人物" | "世界观">("章节");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 项目头 */}
      <header className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zinc-100">{NOVEL.title}</h1>
            <Pill>{NOVEL.genre}</Pill>
          </div>
          <GhostButton>编辑项目信息</GhostButton>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
          {NOVEL.synopsis}
        </p>
      </header>

      {/* 分段 tabs */}
      <nav className="flex gap-1 border-b border-zinc-800 text-sm">
        {(["简介", "章节", "人物", "世界观"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 transition ${
              tab === t
                ? "border-b-2 border-violet-500 text-violet-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
            {t === "章节" && (
              <span className="ml-1.5 text-xs text-zinc-600">
                {NOVEL.chapters.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* 内容区：整页切换 */}
      <section className="min-h-0 flex-1 overflow-y-auto">
        {tab === "简介" && (
          <div className="max-w-2xl rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-sm font-medium text-zinc-300">故事简介</h3>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{NOVEL.synopsis}</p>
            <h3 className="mt-6 text-sm font-medium text-zinc-300">写作进度</h3>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full w-1/3 rounded-full bg-violet-500" />
              </div>
              <span className="text-xs text-zinc-500">
                {NOVEL.chapters.reduce((s, c) => s + c.words, 0).toLocaleString()} / 计划 10 万字
              </span>
            </div>
          </div>
        )}
        {tab === "章节" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {NOVEL.chapters.map((c) => (
              <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">
                    {c.title}
                  </span>
                  <Pill>{c.words.toLocaleString()} 字</Pill>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                  {c.summary}
                </p>
                <div className="mt-3 flex gap-2 text-xs">
                  <button className="text-zinc-500 hover:text-violet-400">编辑</button>
                  <button className="text-zinc-500 hover:text-violet-400">↑</button>
                  <button className="text-zinc-500 hover:text-violet-400">↓</button>
                  <button className="ml-auto text-zinc-600 hover:text-red-400">删除</button>
                </div>
              </div>
            ))}
            <button className="rounded-lg border border-dashed border-zinc-700 p-4 text-sm text-zinc-500 transition hover:border-violet-500 hover:text-violet-300">
              ＋ 新建章节
            </button>
          </div>
        )}
        {(tab === "人物" || tab === "世界观") && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(tab === "人物" ? NOVEL.characters : NOVEL.worldview).map((e) => (
              <div key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">{e.name}</span>
                  <Pill>{e.type}</Pill>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{e.content}</p>
                <div className="mt-3 flex gap-2 text-xs">
                  <button className="text-zinc-500 hover:text-violet-400">编辑</button>
                  <button className="ml-auto text-zinc-600 hover:text-red-400">删除</button>
                </div>
              </div>
            ))}
            <button className="rounded-lg border border-dashed border-zinc-700 p-4 text-sm text-zinc-500 transition hover:border-violet-500 hover:text-violet-300">
              ＋ 新增{tab === "人物" ? "人物" : "设定"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** C — 大纲 + 抽屉：窄大纲树 + 宽正文，设定收纳在右侧抽屉（专注写作） */
export function VariantC() {
  const [activeChapter, setActiveChapter] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [group, setGroup] = useState<"人物" | "世界观">("人物");
  const chapter = NOVEL.chapters.find((c) => c.id === activeChapter)!;
  const entries = group === "人物" ? NOVEL.characters : NOVEL.worldview;

  return (
    <div className="flex h-full min-h-0">
      {/* 大纲树（窄） */}
      <aside className="flex w-40 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/30">
        <div className="px-3 py-3 text-xs font-medium tracking-wide text-zinc-500">
          {NOVEL.title}
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
          {NOVEL.chapters.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveChapter(c.id)}
              className={`block w-full truncate rounded px-2 py-1.5 text-left text-xs transition ${
                c.id === activeChapter
                  ? "bg-violet-600/20 text-violet-300"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {c.title}
            </button>
          ))}
          <button className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-600 hover:text-violet-400">
            ＋ 新章节
          </button>
        </nav>
        <div className="border-t border-zinc-800 p-2">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-500 hover:text-violet-300"
          >
            {drawerOpen ? "▸ 收起设定" : "◂ 设定库（9）"}
          </button>
        </div>
      </aside>

      {/* 主编辑区（宽，最小 chrome） */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-3">
          <span className="text-sm text-zinc-400">{chapter.title}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-600">
              {chapter.words.toLocaleString()} 字
            </span>
            <button className="text-xs text-violet-400">保存</button>
          </div>
        </header>
        <textarea
          defaultValue={`${chapter.summary}\n\n（正文——把干扰减到最少，这里只有文字和光标）`}
          className="min-h-0 flex-1 resize-none bg-transparent px-6 text-[15px] leading-8 text-zinc-200 outline-none"
        />
      </section>

      {/* 设定抽屉 */}
      {drawerOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/60">
          <div className="flex border-b border-zinc-800 text-xs">
            {(["人物", "世界观"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`flex-1 py-2.5 transition ${
                  group === g
                    ? "border-b-2 border-violet-500 text-violet-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            {entries.map((e) => (
              <div key={e.id} className="rounded border border-zinc-800 bg-zinc-950 p-2">
                <div className="text-xs font-medium text-zinc-200">{e.name}</div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                  {e.content}
                </p>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
