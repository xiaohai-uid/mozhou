"use client";

// 项目管理：作品、设定、章节、RAG 开关、机检、导出与同步入口。
// 作品和章节数据来自真实 API；所有写入动作都展示失败原因，不用示例数据冒充生产结果。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  description: string | null;
  meta: string;
  ragEnabled: boolean;
}

interface Chapter {
  id: number;
  ch: string;
  title: string;
  revision: number;
  status: "draft" | "final";
  content?: string;
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

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface TrackingSnapshot {
  tracking: {
    stateRevision: number;
    state: {
      statusCard: { settledChapters: number; currentChapter: string | null };
      characterStates: Array<{ name: string; state: string }>;
      promises: Array<{ id?: string; text: string; status: "open" | "resolved" }>;
      timeline: Array<{ text: string; chapter: string }>;
      readerKnowledge: Array<{ text: string }>;
    };
  };
  records: Array<{ chapterId: number; chapterRevision: number; wordCount: number; checks: CheckResult[] }>;
  reviews: Array<{ chapterId: number; chapterRevision: number; checks: CheckResult[]; createdAt: string }>;
}

interface TrackingDraft {
  result: string;
  characters: string;
  promises: string;
  readerKnowledge: string;
}

export function ProjectsView() {
  const router = useRouter();
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookDescription, setBookDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ragSaving, setRagSaving] = useState(false);
  const [reviewingChapterId, setReviewingChapterId] = useState<number | null>(null);
  const [reviewResults, setReviewResults] = useState<Record<number, CheckResult[]>>({});
  const [tracking, setTracking] = useState<TrackingSnapshot | null>(null);
  const [trackingDrafts, setTrackingDrafts] = useState<Record<number, TrackingDraft>>({});
  const [editingTrackingId, setEditingTrackingId] = useState<number | null>(null);
  const bootstrapRequestKeyRef = useRef<string | null>(null);

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
    const requestKey =
      bootstrapRequestKeyRef.current ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    bootstrapRequestKeyRef.current = requestKey;
    try {
      const res = await fetch("/api/v1/novels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: bookDescription.trim() || undefined,
          requestKey,
        }),
      });
      const data = (await res.json()) as {
        novel?: { id: number; name: string };
        chapter?: { id: number; ch: string; title: string };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      setBookName("");
      setBookDescription("");
      bootstrapRequestKeyRef.current = null;
      router.push(
        `/chapter/${data.chapter!.id}?novelId=${data.novel!.id}&novel=${encodeURIComponent(data.novel!.name)}&ch=${data.chapter!.ch}&title=${encodeURIComponent(data.chapter!.title)}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function selectNovel(id: number) {
    setActiveId(id);
    await loadDetail(id);
    const trackingResponse = await fetch(`/api/v1/novels/${id}/tracking`);
    if (trackingResponse.ok) setTracking((await trackingResponse.json()) as TrackingSnapshot);
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

  async function startExistingWriting() {
    if (!activeId) return;
    setError(null);
    const res = await fetch(`/api/v1/novels/${activeId}/start-writing`, { method: "POST" });
    const data = (await res.json()) as {
      novel?: { id: number; name: string };
      chapter?: { id: number; ch: string; title: string };
      error?: string;
    };
    if (!res.ok || !data.chapter || !data.novel) {
      setError(data.error ?? "无法进入写作");
      return;
    }
    router.push(
      `/chapter/${data.chapter.id}?novelId=${data.novel.id}&novel=${encodeURIComponent(data.novel.name)}&ch=${data.chapter.ch}&title=${encodeURIComponent(data.chapter.title)}`,
    );
  }

  async function deleteChapter(chapterId: number) {
    if (!activeId) return;
    if (!window.confirm("删除该章节？")) return;
    const res = await fetch(`/api/v1/novels/${activeId}/chapters?chapterId=${chapterId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "删除章节失败");
      return;
    }
    await loadDetail(activeId);
  }

  async function runChapterReview(chapter: Chapter) {
    if (!activeId || reviewingChapterId !== null) return;
    setReviewingChapterId(chapter.id);
    setError(null);
    try {
      const res = await fetch("/api/v1/tools/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chapter.content ?? "",
          mustCover: [],
          knownEntities: [
            ...detail!.characters.map((entry) => entry.name),
            ...detail!.worldviews.map((entry) => entry.name),
          ],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checks?: CheckResult[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "审查失败");
      setReviewResults((previous) => ({
        ...previous,
        [chapter.id]: data.checks ?? [],
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReviewingChapterId(null);
    }
  }

  async function settleChapter(chapter: Chapter) {
    if (!activeId || !chapter.content?.trim()) return;
    setError(null);
    const draft = trackingDrafts[chapter.id] ?? { result: "", characters: "", promises: "", readerKnowledge: "" };
    const characterStates = draft.characters.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      const [name, ...state] = line.split("=");
      return name?.trim() && state.join("=").trim() ? [{ name: name.trim(), state: state.join("=").trim() }] : [];
    });
    const promises = draft.promises.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      const [id, status, ...text] = line.split("|");
      return id?.trim() && (status === "open" || status === "resolved") && text.join("|").trim()
        ? [{ id: id.trim(), status, text: text.join("|").trim() }]
        : [];
    });
    const readerKnowledge = draft.readerKnowledge.split("\n").map((line) => line.trim()).filter(Boolean).map((text) => ({ text }));
    const response = await fetch(`/api/v1/novels/${activeId}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterId: chapter.id,
        idempotencyKey: `settle-${chapter.id}-r${chapter.revision}`,
        expectedStateRevision: tracking?.tracking.stateRevision,
        facts: { result: draft.result.trim() || undefined, characterStates, promises, readerKnowledge },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as TrackingSnapshot & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "章节结算失败");
      return;
    }
    setTracking(data);
    setEditingTrackingId(null);
    setReviewResults((previous) => ({ ...previous, [chapter.id]: data.records.find((record) => record.chapterId === chapter.id)?.checks ?? [] }));
  }

  function downloadNovel(format: "txt" | "json") {
    if (!detail) return;
    const filenameBase = detail.novel.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "作品";
    let body: string;
    let type: string;
    let extension: string;
    if (format === "txt") {
      body = detail.chapters
        .map((chapter) => `第${chapter.ch}章 ${chapter.title}\n\n${chapter.content ?? ""}`)
        .join("\n\n");
      type = "text/plain;charset=utf-8";
      extension = "txt";
    } else {
      body = JSON.stringify(detail, null, 2);
      type = "application/json;charset=utf-8";
      extension = "json";
    }
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${filenameBase}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
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
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">创建新作品</p>
            <span className="text-[10px] text-faint">先说一句就够</span>
          </div>
          <div className="mt-3 grid gap-2">
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
            <textarea
              value={bookDescription}
              onChange={(e) => setBookDescription(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="作品方向（可跳过）：比如“近未来城市里，一个失去记忆的修理师追查自己的过去”"
              aria-label="作品方向，可跳过"
              className="w-full resize-none rounded-xl border border-surface-2 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
            <div className="flex items-center justify-between gap-2 text-[10px] text-faint">
              <span>墨舟会把它带进后续写作，不满意时可以继续在正文里纠正。</span>
              <span className="shrink-0">{bookDescription.length}/500</span>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
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
            <p className="text-sm text-muted">选择或创建一个作品，开始写作</p>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-6">
            <div className="flex items-baseline justify-between">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-zinc-100">{detail.novel.name}</h2>
                {detail.novel.description && (
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                    {detail.novel.description}
                  </p>
                )}
              </div>
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
                    <li className="rounded-xl border border-dashed border-accent/30 bg-accent/5 px-4 py-3 text-center text-xs text-faint">
                      <p>还没有章节，先开始写作</p>
                      <button
                        onClick={() => void startExistingWriting()}
                        className="mt-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500"
                      >
                        开始写作
                      </button>
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
                  { name: "当前章节正文参考", desc: "对话时读取当前章节末尾" },
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

            {/* 章节机检：结果只来自当前作品章节和真实 checks API */}
            <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <ShieldCheck size={16} weight="duotone" className="text-accent" aria-hidden />
                章节审查
              </div>
              <ul className="mt-4 space-y-2">
                {detail.chapters.map((chapter) => {
                  const checks = reviewResults[chapter.id];
                  return (
                    <li key={chapter.id} className="rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm text-zinc-200">
                          <span className="mr-2 font-mono text-xs text-faint">{chapter.ch}</span>
                          {chapter.title}
                        </span>
                        <button
                          onClick={() => void runChapterReview(chapter)}
                          disabled={reviewingChapterId !== null}
                          className="shrink-0 rounded-full border border-accent/50 px-3 py-1 text-[11px] text-accent transition hover:bg-accent/10 disabled:opacity-50"
                        >
                          {reviewingChapterId === chapter.id ? "审查中…" : "运行审查"}
                        </button>
                        <button
                          onClick={() => void settleChapter(chapter)}
                          disabled={!chapter.content?.trim()}
                          className="shrink-0 rounded-full border border-emerald-500/40 px-3 py-1 text-[11px] text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-40"
                        >
                          结算追踪
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingTrackingId((current) => current === chapter.id ? null : chapter.id)}
                        className="mt-2 text-[11px] text-faint underline decoration-dotted underline-offset-4 hover:text-zinc-300"
                      >
                        {editingTrackingId === chapter.id ? "收起追踪事实" : "补充追踪事实（可选）"}
                      </button>
                      {editingTrackingId === chapter.id && (
                        <div className="mt-3 grid gap-2 border-t border-surface-2 pt-3 md:grid-cols-2">
                          <label className="text-[11px] text-faint md:col-span-2">
                            本章结果
                            <input
                              value={trackingDrafts[chapter.id]?.result ?? ""}
                              onChange={(event) => setTrackingDrafts((previous) => ({ ...previous, [chapter.id]: { ...(previous[chapter.id] ?? { result: "", characters: "", promises: "", readerKnowledge: "" }), result: event.target.value } }))}
                              placeholder="只写本章已经确认发生的结果"
                              className="mt-1 w-full rounded-lg border border-surface-2 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-accent"
                            />
                          </label>
                          <label className="text-[11px] text-faint">
                            人物状态（每行：角色=状态）
                            <textarea
                              value={trackingDrafts[chapter.id]?.characters ?? ""}
                              onChange={(event) => setTrackingDrafts((previous) => ({ ...previous, [chapter.id]: { ...(previous[chapter.id] ?? { result: "", characters: "", promises: "", readerKnowledge: "" }), characters: event.target.value } }))}
                              rows={3}
                              className="mt-1 w-full resize-none rounded-lg border border-surface-2 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-accent"
                            />
                          </label>
                          <label className="text-[11px] text-faint">
                            承诺（每行：ID|open/resolved|内容）
                            <textarea
                              value={trackingDrafts[chapter.id]?.promises ?? ""}
                              onChange={(event) => setTrackingDrafts((previous) => ({ ...previous, [chapter.id]: { ...(previous[chapter.id] ?? { result: "", characters: "", promises: "", readerKnowledge: "" }), promises: event.target.value } }))}
                              rows={3}
                              className="mt-1 w-full resize-none rounded-lg border border-surface-2 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-accent"
                            />
                          </label>
                          <label className="text-[11px] text-faint md:col-span-2">
                            读者已知（每行一条）
                            <textarea
                              value={trackingDrafts[chapter.id]?.readerKnowledge ?? ""}
                              onChange={(event) => setTrackingDrafts((previous) => ({ ...previous, [chapter.id]: { ...(previous[chapter.id] ?? { result: "", characters: "", promises: "", readerKnowledge: "" }), readerKnowledge: event.target.value } }))}
                              rows={2}
                              className="mt-1 w-full resize-none rounded-lg border border-surface-2 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-accent"
                            />
                          </label>
                          <p className="text-[10px] leading-4 text-faint md:col-span-2">
                            这些内容只会作为可审计追踪事实写入，不会自动把正文当作事实，也不会替你猜测剧情。
                          </p>
                        </div>
                      )}
                      {checks && (
                        <ul className="mt-3 space-y-1.5 border-t border-surface-2 pt-2.5">
                          {checks.map((check) => (
                            <li key={check.name} className="flex items-start gap-2 text-[11px]">
                              <span className={`mt-1 size-1.5 shrink-0 rounded-full ${check.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                              <span className="text-zinc-300">{check.name}：{check.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {detail.chapters.length === 0 && (
                  <li className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-center text-xs text-faint">
                    创建章节并保存正文后才能运行审查
                  </li>
                )}
              </ul>
              <p className="mt-3 text-[11px] text-faint">审查结果为本次运行结果；当前不伪造历史审查记录。</p>
              {tracking && (
                <p className="mt-1 text-[11px] text-faint">
                  作品追踪：已结算 {tracking.tracking.state.statusCard.settledChapters} 章
                  {tracking.tracking.state.statusCard.currentChapter ? ` · 当前 ${tracking.tracking.state.statusCard.currentChapter}` : ""}
                </p>
              )}
            </div>

            {/* 导出与备份：浏览器下载 + 真实 WebDAV 配置入口 */}
            <div className="rounded-card border border-surface-2 bg-surface/50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <CloudArrowUp size={16} weight="duotone" className="text-accent" aria-hidden />
                导出与备份
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <button
                  onClick={() => downloadNovel("txt")}
                  className="flex flex-col items-start gap-1 rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3.5 text-left transition hover:border-zinc-600"
                >
                  <FileText size={16} weight="duotone" className="text-zinc-400" aria-hidden />
                  <span className="text-sm font-medium text-zinc-200">全书 TXT</span>
                  <span className="text-[11px] leading-4 text-faint">纯文本导出，章节按序拼接</span>
                  <span className="mt-1 rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-400">可下载</span>
                </button>
                <button
                  onClick={() => downloadNovel("json")}
                  className="flex flex-col items-start gap-1 rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3.5 text-left transition hover:border-zinc-600"
                >
                  <FileArchive size={16} weight="duotone" className="text-zinc-400" aria-hidden />
                  <span className="text-sm font-medium text-zinc-200">作品包 JSON</span>
                  <span className="text-[11px] leading-4 text-faint">含设定、章节和正文的完整包</span>
                  <span className="mt-1 rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-400">可下载</span>
                </button>
                <Link
                  href="/sync"
                  className="flex flex-col items-start gap-1 rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3.5 text-left transition hover:border-zinc-600"
                >
                  <CloudArrowUp size={16} weight="duotone" className="text-zinc-400" aria-hidden />
                  <span className="text-sm font-medium text-zinc-200">云同步备份</span>
                  <span className="text-[11px] leading-4 text-faint">配置并推送到 WebDAV</span>
                  <span className="mt-1 rounded-full border border-accent/30 px-2 py-0.5 text-[10px] text-accent">打开配置</span>
                </Link>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
