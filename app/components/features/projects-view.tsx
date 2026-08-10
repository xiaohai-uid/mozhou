"use client";

// 项目管理（05 工单已接入）：作品列表 + 人物库 / 世界观 / 章节 三栏 + RAG 注入 / 审查 / 导出。
// 列表/创建/详情/新增/删除走真实 API（/api/v1/novels*）；RAG/审查/导出仍为界面示意（06/09 工单接入）。
// V1.1 Journey ⑦：章节项可点开进入章节编辑器（当前为 Mock Preview 页）。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpenText,
  CloudArrowUp,
  FileArchive,
  FileText,
  GitBranch,
  Globe,
  Plus,
  ShieldCheck,
  Trash,
  UsersThree,
  Waveform,
} from "@phosphor-icons/react/dist/ssr";

interface NovelSummary {
  id: number;
  name: string;
  meta: string;
  ragEnabled: boolean;
}

interface Chapter {
  id: number;
  ch: string;
  title: string;
  status: "draft" | "final";
}

interface Entry {
  id: number;
  name: string;
  note: string | null;
}

interface NovelDetail {
  novel: NovelSummary;
  chapters: Chapter[];
  characters: Entry[];
  worldviews: Entry[];
}

export function ProjectsView() {
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [bookName, setBookName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ragSaving, setRagSaving] = useState(false);

  /** RAG 总开关：PATCH 持久化后刷新详情（06 收尾） */
  async function toggleRag() {
    if (!activeId || !detail || ragSaving) return;
    setRagSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/novels/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragEnabled: !detail.novel.ragEnabled }),
      });
      if (!res.ok) throw new Error("保存失败");
      await loadDetail(activeId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRagSaving(false);
    }
  }

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/v1/novels");
    if (!res.ok) return;
    const data = (await res.json()) as { novels: NovelSummary[] };
    setNovels(data.novels);
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/v1/novels/${id}`);
    if (!res.ok) return;
    setDetail((await res.json()) as NovelDetail);
  }, []);

  useEffect(() => {
    // 挂载时异步加载（fetch 后 setState）；豁免 react-hooks/set-state-in-effect 对数据获取的误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshList();
  }, [refreshList]);

  async function createBook() {
    const name = bookName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/novels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { novel?: NovelSummary; error?: string };
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      setBookName("");
      await refreshList();
      setActiveId(data.novel!.id);
      await loadDetail(data.novel!.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function selectNovel(id: number) {
    setActiveId(id);
    await loadDetail(id);
  }

  async function addChapter() {
    if (!activeId) return;
    const title = window.prompt("章节标题");
    if (!title?.trim()) return;
    const res = await fetch(`/api/v1/novels/${activeId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    if (!res.ok) return;
    await loadDetail(activeId);
  }

  async function deleteChapter(chapterId: number) {
    if (!activeId) return;
    if (!window.confirm("删除该章节？")) return;
    await fetch(`/api/v1/novels/${activeId}/chapters?chapterId=${chapterId}`, {
      method: "DELETE",
    });
    await loadDetail(activeId);
  }

  async function addEntry(kind: "character" | "worldview") {
    if (!activeId) return;
    const name = window.prompt(kind === "character" ? "人物名称" : "设定名称");
    if (!name?.trim()) return;
    const note = window.prompt("备注（可留空）") ?? undefined;
    const res = await fetch(
      `/api/v1/novels/${activeId}/entries?kind=${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), note }),
      },
    );
    if (!res.ok) return;
    await loadDetail(activeId);
  }

  async function deleteEntry(kind: "character" | "worldview", entryId: number) {
    if (!activeId) return;
    if (!window.confirm("删除该条目？")) return;
    await fetch(
      `/api/v1/novels/${activeId}/entries?kind=${kind}&entryId=${entryId}`,
      { method: "DELETE" },
    );
    await loadDetail(activeId);
  }

  async function deleteNovel(id: number) {
    if (!window.confirm(`删除《${novels.find((n) => n.id === id)?.name}》？章节与设定将一并删除`)) {
      return;
    }
    const res = await fetch(`/api/v1/novels/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    if (activeId === id) {
      setActiveId(null);
      setDetail(null);
    }
    await refreshList();
  }

  return (
    <main className="flex flex-1 gap-6 px-6 py-8 lg:px-10">
      {/* 作品列表 */}
      <aside className="flex w-64 shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-zinc-200">我的作品</h1>
          <span className="text-xs text-faint">{novels.length}</span>
        </div>
        <div className="flex flex-col gap-1">
          {novels.map((n) => (
            <button
              key={n.id}
              onClick={() => void selectNovel(n.id)}
              className={`group relative rounded-xl border px-4 py-3 text-left transition ${
                activeId === n.id
                  ? "border-accent/50 bg-accent/10"
                  : "border-surface-2 bg-surface hover:border-zinc-600"
              }`}
            >
              <span className="block text-sm font-medium text-zinc-100">{n.name}</span>
              <span className="mt-0.5 block text-xs text-faint">{n.meta}</span>
              <span
                role="button"
                aria-label={`删除 ${n.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteNovel(n.id);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-400"
              >
                <Trash size={15} aria-hidden />
              </span>
            </button>
          ))}
        </div>
        {/* 新建作品 */}
        <div className="mt-2 rounded-card border border-dashed border-surface-2 p-4">
          <p className="text-xs text-muted">创建新作品</p>
          <div className="mt-3 flex gap-2">
            <input
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createBook();
              }}
              placeholder="书名"
              aria-label="书名"
              className="w-full min-w-0 rounded-xl border border-surface-2 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
            <button
              onClick={() => void createBook()}
              disabled={!bookName.trim() || creating}
              aria-label="创建"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              <Plus size={16} weight="bold" />
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>
      </aside>

      {/* 详情区 */}
      <section className="min-w-0 flex-1">
        {!detail ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-card border border-dashed border-surface-2 py-24 text-center">
            <BookOpenText size={30} weight="duotone" className="text-zinc-500" aria-hidden />
            <p className="text-sm text-muted">选择或创建一个作品，开始管理你笔下的世界</p>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-semibold text-zinc-100">{detail.novel.name}</h2>
              <span className="text-xs text-faint">{detail.novel.meta}</span>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-3">
              {/* 人物库 */}
              <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <UsersThree size={16} weight="duotone" className="text-accent" aria-hidden />
                    人物库
                  </div>
                  <button
                    onClick={() => void addEntry("character")}
                    aria-label="新增人物"
                    className="flex size-7 items-center justify-center rounded-full border border-surface-2 text-faint transition hover:border-zinc-600 hover:text-zinc-200"
                  >
                    <Plus size={13} weight="bold" />
                  </button>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {detail.characters.map((c) => (
                    <li key={c.id} className="group relative rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                      <span className="text-sm font-medium text-zinc-100">{c.name}</span>
                      {c.note && (
                        <p className="mt-0.5 text-xs leading-5 text-muted">{c.note}</p>
                      )}
                      <button
                        onClick={() => void deleteEntry("character", c.id)}
                        aria-label={`删除 ${c.name}`}
                        className="absolute right-2.5 top-2.5 text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                      >
                        <Trash size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                  {detail.characters.length === 0 && (
                    <li className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-center text-xs text-faint">
                      还没有人物，点击右上角添加
                    </li>
                  )}
                </ul>
              </div>

              {/* 世界观 */}
              <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <Globe size={16} weight="duotone" className="text-accent" aria-hidden />
                    世界观设定
                  </div>
                  <button
                    onClick={() => void addEntry("worldview")}
                    aria-label="新增设定"
                    className="flex size-7 items-center justify-center rounded-full border border-surface-2 text-faint transition hover:border-zinc-600 hover:text-zinc-200"
                  >
                    <Plus size={13} weight="bold" />
                  </button>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {detail.worldviews.map((c) => (
                    <li key={c.id} className="group relative rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                      <span className="text-sm font-medium text-zinc-100">{c.name}</span>
                      {c.note && (
                        <p className="mt-0.5 text-xs leading-5 text-muted">{c.note}</p>
                      )}
                      <button
                        onClick={() => void deleteEntry("worldview", c.id)}
                        aria-label={`删除 ${c.name}`}
                        className="absolute right-2.5 top-2.5 text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                      >
                        <Trash size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                  {detail.worldviews.length === 0 && (
                    <li className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-center text-xs text-faint">
                      还没有设定，点击右上角添加
                    </li>
                  )}
                </ul>
              </div>

              {/* 章节 */}
              <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <GitBranch size={16} weight="duotone" className="text-accent" aria-hidden />
                    章节
                  </div>
                  <button
                    onClick={() => void addChapter()}
                    aria-label="新建章节"
                    className="flex size-7 items-center justify-center rounded-full border border-surface-2 text-faint transition hover:border-zinc-600 hover:text-zinc-200"
                  >
                    <Plus size={13} weight="bold" />
                  </button>
                </div>
                <ul className="mt-4 space-y-2">
                  {detail.chapters.map((c) => (
                    <li
                      key={c.id}
                      className="group flex items-center justify-between rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-2.5"
                    >
                      {/* V1.1 Journey ⑦：点章节名打开章节编辑器（工单 16 起接真实正文） */}
                      <Link
                        href={`/chapter/${c.id}?novelId=${detail.novel.id}&novel=${encodeURIComponent(detail.novel.name)}&ch=${c.ch}&title=${encodeURIComponent(c.title)}`}
                        title="打开章节"
                        className="flex min-w-0 items-center gap-2 transition hover:text-accent"
                      >
                        <span className="font-mono text-xs text-faint">{c.ch}</span>
                        <span className="truncate text-sm text-zinc-200">{c.title}</span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full border border-surface-2 px-2 py-0.5 text-[10px] text-faint">
                          {c.status === "final" ? "定稿" : "草稿"}
                        </span>
                        <button
                          onClick={() => void deleteChapter(c.id)}
                          aria-label={`删除 ${c.title}`}
                          className="text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                        >
                          <Trash size={14} aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))}
                  {detail.chapters.length === 0 && (
                    <li className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-center text-xs text-faint">
                      还没有章节，点击右上角新建
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* RAG 注入配置（06 收尾：主开关真实绑定 ragEnabled，PATCH 持久化） */}
            <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                  <Waveform size={16} weight="duotone" className="text-accent" aria-hidden />
                  RAG 注入配置
                </div>
                <button
                  onClick={() => void toggleRag()}
                  disabled={ragSaving}
                  aria-label="RAG 注入总开关"
                  aria-pressed={detail.novel.ragEnabled}
                  className={`rounded-full px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                    detail.novel.ragEnabled
                      ? "bg-accent/15 text-accent"
                      : "border border-surface-2 text-faint"
                  }`}
                >
                  {ragSaving ? "保存中…" : detail.novel.ragEnabled ? "注入中" : "已关闭"}
                </button>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">
                写作对话时自动检索以下资料注入上下文，保持设定一致性
                {!detail.novel.ragEnabled && "（当前已关闭，对话不再注入本作品设定）"}
              </p>
              <ul className="mt-4 space-y-2">
                {[
                  { name: "人物库", desc: `${detail.characters.length} 条` },
                  { name: "世界观设定", desc: `${detail.worldviews.length} 条` },
                  { name: "章节摘要", desc: `${detail.chapters.length} 章` },
                ].map((c) => (
                  <li key={c.name} className="flex items-center justify-between rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                    <div>
                      <span className="text-sm font-medium text-zinc-100">{c.name}</span>
                      <p className="mt-0.5 text-xs text-muted">{c.desc}</p>
                    </div>
                    <span className="text-xs text-faint">跟随总开关</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 审查记录（09 工单接入；当前界面示意） */}
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
              <p className="mt-3 text-[11px] text-faint">审查引擎接入中（09 工单），当前为界面示意</p>
            </div>

            {/* 导出与备份（08 工单接入；当前界面示意） */}
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
