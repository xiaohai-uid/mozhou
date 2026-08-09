"use client";

// 项目管理（UI 先行）：作品列表 + 人物库 / 世界观 / 章节 三栏 + RAG 注入 / 审查 / 导出。
// 后端 RAG 注入待接；示例数据为真实《零界道种》（用户作品）。
import { useState } from "react";
import {
  BookOpenText,
  CloudArrowUp,
  FileArchive,
  FileText,
  GitBranch,
  Globe,
  Plus,
  ShieldCheck,
  UsersThree,
  Waveform,
} from "@phosphor-icons/react/dist/ssr";

const demoChapters = [
  { ch: "001", title: "灰烬有籽", status: "定稿" },
  { ch: "002", title: "灰里有苗", status: "定稿" },
  { ch: "003", title: "灰里藏灯", status: "定稿" },
  { ch: "004", title: "灰里开田", status: "定稿" },
];

export function ProjectsView() {
  const [bookName, setBookName] = useState("");
  const [hasBook, setHasBook] = useState(false);

  return (
    <main className="flex flex-1 gap-6 px-6 py-8 lg:px-10">
      {/* 作品列表 */}
      <aside className="flex w-64 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-zinc-200">我的作品</h1>
        </div>
        {hasBook && (
          <button className="rounded-xl border border-surface-2 bg-surface px-4 py-3 text-left transition hover:border-zinc-600">
            <span className="block text-sm font-medium text-zinc-100">零界道种</span>
            <span className="mt-0.5 block text-xs text-faint">卷一 · 连载中 · 4 章</span>
          </button>
        )}
        {/* 新建作品 */}
        <div className="mt-2 rounded-card border border-dashed border-surface-2 p-4">
          <p className="text-xs text-muted">创建新作品</p>
          <div className="mt-3 flex gap-2">
            <input
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              placeholder="书名"
              aria-label="书名"
              className="w-full min-w-0 rounded-xl border border-surface-2 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
            <button
              onClick={() => {
                if (bookName.trim()) setHasBook(true);
              }}
              disabled={!bookName.trim()}
              aria-label="创建"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              <Plus size={16} weight="bold" />
            </button>
          </div>
        </div>
      </aside>

      {/* 详情区 */}
      <section className="min-w-0 flex-1">
        {!hasBook ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-card border border-dashed border-surface-2 py-24 text-center">
            <BookOpenText size={30} weight="duotone" className="text-zinc-500" aria-hidden />
            <p className="text-sm text-muted">选择或创建一个作品，开始管理你笔下的世界</p>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold text-zinc-100">零界道种</h2>
              <span className="text-xs text-faint">卷一「灰烬有苗」 · 目标 100 万字</span>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-3">
              {/* 人物库 */}
              <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <UsersThree size={16} weight="duotone" className="text-accent" aria-hidden />
                  人物库
                </div>
                <ul className="mt-4 space-y-2.5">
                  {[
                    { name: "陆沉舟", note: "阿雀的兄长，沉默寡言" },
                    { name: "阿雀", note: "病弱，守着灰罐里的火苗" },
                  ].map((c) => (
                    <li key={c.name} className="rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                      <span className="text-sm font-medium text-zinc-100">{c.name}</span>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{c.note}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 世界观 */}
              <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <Globe size={16} weight="duotone" className="text-accent" aria-hidden />
                  世界观设定
                </div>
                <ul className="mt-4 space-y-2.5">
                  {[
                    { name: "零界", note: "火苗偏斜的方向，无人提及" },
                    { name: "灰烬镇", note: "故事起点，灰罐与灯芯" },
                  ].map((c) => (
                    <li key={c.name} className="rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                      <span className="text-sm font-medium text-zinc-100">{c.name}</span>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{c.note}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 章节 */}
              <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <GitBranch size={16} weight="duotone" className="text-accent" aria-hidden />
                  章节
                </div>
                <ul className="mt-4 space-y-2">
                  {demoChapters.map((c) => (
                    <li
                      key={c.ch}
                      className="flex items-center justify-between rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-2.5"
                    >
                      <span className="text-sm text-zinc-200">
                        <span className="mr-2 font-mono text-xs text-faint">{c.ch}</span>
                        {c.title}
                      </span>
                      <span className="rounded-full border border-surface-2 px-2 py-0.5 text-[10px] text-faint">
                        {c.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* RAG 注入配置（写作时自动检索资料进上下文） */}
            <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Waveform size={16} weight="duotone" className="text-accent" aria-hidden />
                RAG 注入配置
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">
                写作对话时自动检索以下资料注入上下文，保持设定一致性
              </p>
              <ul className="mt-4 space-y-2">
                {[
                  { name: "人物库", desc: "陆沉舟 / 阿雀 等 12 条", on: true },
                  { name: "世界观设定", desc: "零界 / 灰烬镇 等 8 条", on: true },
                  { name: "章节摘要", desc: "001-004 章摘要", on: false },
                ].map((c) => (
                  <li key={c.name} className="flex items-center justify-between rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                    <div>
                      <span className="text-sm font-medium text-zinc-100">{c.name}</span>
                      <p className="mt-0.5 text-xs text-muted">{c.desc}</p>
                    </div>
                    <button
                      aria-label={`${c.name}注入开关`}
                      aria-pressed={c.on}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${
                        c.on ? "bg-accent/15 text-accent" : "border border-surface-2 text-faint"
                      }`}
                    >
                      {c.on ? "注入中" : "未注入"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* 审查记录 */}
            <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <ShieldCheck size={16} weight="duotone" className="text-accent" aria-hidden />
                审查记录
              </div>
              <ul className="mt-4 space-y-2">
                {[
                  { ch: "ch004", issue: "未覆盖必含词「守塔」", level: "medium", when: "刚刚" },
                  { ch: "ch003", issue: "角色一致性：阿雀语气偏离", level: "low", when: "2 小时前" },
                  { ch: "ch003", issue: "泄密扫描通过（S-001/003/005 未曝光）", level: "ok", when: "2 小时前" },
                ].map((c) => (
                  <li key={c.when + c.ch} className="flex items-center justify-between gap-3 rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-xs text-faint">{c.ch}</span>
                      <span className="truncate text-sm text-zinc-300">{c.issue}</span>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] ${
                        c.level === "ok"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : c.level === "low"
                            ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {c.level === "ok" ? "通过" : c.level === "low" ? "低" : "中"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-faint">审查引擎接入中，当前为界面示意</p>
            </div>

            {/* 导出与备份 */}
            <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <CloudArrowUp size={16} weight="duotone" className="text-accent" aria-hidden />
                导出与备份
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {[
                  { icon: FileText, name: "全书 TXT", desc: "纯文本导出，章节按序拼接" },
                  { icon: FileArchive, name: "作品包 JSON", desc: "含设定/摘要/章节的完整包" },
                  { icon: CloudArrowUp, name: "云同步备份", desc: "推送到已配置的 WebDAV" },
                ].map((c) => (
                  <button
                    key={c.name}
                    className="flex flex-col items-start gap-1 rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3.5 text-left transition hover:border-zinc-600"
                  >
                    <c.icon size={16} weight="duotone" className="text-zinc-400" aria-hidden />
                    <span className="text-sm font-medium text-zinc-200">{c.name}</span>
                    <span className="text-[11px] leading-4 text-faint">{c.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
