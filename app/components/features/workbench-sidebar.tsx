"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  GlobeHemisphereWest,
  House,
  ListChecks,
  ListNumbers,
  PenNib,
  Question,
  Scissors,
  Sparkle,
  Trophy,
  UserCircle,
  UsersThree,
} from "@phosphor-icons/react";
import {
  readCurrentNovelId,
  resolveCurrentNovelId,
} from "@/lib/novels/current-novel";

export interface NovelSummary {
  id: number;
  name: string;
  meta: string;
  ragEnabled: boolean;
}

export interface ChapterRow {
  id: number;
  ch: string;
  title: string;
  content: string;
  status: string;
  sortOrder: number;
}

export interface EntryRow {
  id: number;
  name: string;
  note: string | null;
}

export interface NovelDetail {
  novel: NovelSummary;
  chapters: ChapterRow[];
  characters: EntryRow[];
  worldviews: EntryRow[];
}

export interface BoundBrief {
  artifactId: string;
  version: string;
  provenance: { source: string; capturedAt: string };
}

export interface BoundPack {
  artifactId: string;
  version: string;
  sourceRunId: number | null;
}

export type WorkbenchPanel = "outline" | "characters" | "world" | null;

type WorkbenchLoadState = "loading" | "ready" | "error";

type WorkbenchSidebarProps = {
  detail: NovelDetail | null;
  boundBriefs: BoundBrief[];
  boundPacks: BoundPack[];
  activePanel: WorkbenchPanel;
  onPanelChange: (panel: WorkbenchPanel) => void;
  chapterHref: (chapter: ChapterRow) => string;
  activeToolPath?: string;
  onWritingClick?: () => void;
  loadState?: WorkbenchLoadState;
  onRetry?: () => void;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
      {children}
    </p>
  );
}

function toolLinkClass(active: boolean) {
  return "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition " +
    (active
      ? "bg-accent/10 text-zinc-100"
      : "text-zinc-400 hover:bg-surface hover:text-zinc-100");
}

export function WorkbenchSidebar({
  detail,
  boundBriefs,
  boundPacks,
  activePanel,
  onPanelChange,
  chapterHref,
  activeToolPath,
  onWritingClick,
  loadState = "ready",
  onRetry,
}: WorkbenchSidebarProps) {
  const latestChapter = [...(detail?.chapters ?? [])].sort((a, b) => b.sortOrder - a.sortOrder)[0];

  return (
    <aside data-workbench-sidebar className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-surface-2 bg-zinc-950/60 px-3 py-4">
      <SectionLabel>Current Work</SectionLabel>
      <div className="rounded-xl border border-surface-2 bg-surface/50 px-4 py-3">
        {loadState === "error" ? (
          <div role="alert">
            <p className="text-sm font-semibold text-zinc-100">作品加载失败</p>
            <p className="mt-0.5 text-xs text-faint">暂时无法获取当前作品，请重试。</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-lg border border-surface-2 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-accent/50 hover:text-zinc-100"
              >
                重试加载作品
              </button>
            )}
          </div>
        ) : loadState === "loading" ? (
          <>
            <p className="text-sm font-semibold text-zinc-100">正在加载作品</p>
            <p className="mt-0.5 text-xs text-faint">正在同步创作上下文</p>
          </>
        ) : detail ? (
          <>
            <p className="text-sm font-semibold text-zinc-100">{detail.novel.name}</p>
            <p className="mt-0.5 text-xs text-faint">{detail.novel.meta}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: Math.min(100, Number(latestChapter?.ch ?? 0) * 5) + "%" }} />
            </div>
            <p className="mt-1 text-[11px] text-faint">已写至第 {latestChapter?.ch ?? 0} 章</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-zinc-100">还没有作品</p>
            <p className="mt-0.5 text-xs text-faint">创建作品后在这里继续写作</p>
          </>
        )}
      </div>

      <nav className="mt-4 flex flex-col gap-0.5" aria-label="作品导航">
        <button
          type="button"
          onClick={() => {
            onPanelChange(null);
            onWritingClick?.();
          }}
          className={"flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition " + (activePanel === null ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
        >
          <PenNib size={16} weight="duotone" aria-hidden /> 写作对话
        </button>
        <button
          type="button"
          onClick={() => onPanelChange(activePanel === "outline" ? null : "outline")}
          className={"flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " + (activePanel === "outline" ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
        >
          <span className="flex items-center gap-2.5"><ListNumbers size={16} weight="duotone" aria-hidden /> 章节与大纲</span>
          <b className="text-xs text-faint">{detail?.chapters.length ?? 0}</b>
        </button>
        {activePanel === "outline" && (
          <div className="ml-6 flex flex-col gap-0.5 border-l border-surface-2 pl-2">
            {[...(detail?.chapters ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((chapter) => (
              <Link key={chapter.id} href={chapterHref(chapter)} className="truncate rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                {chapter.ch} · {chapter.title || "未命名"}
              </Link>
            ))}
            {(!detail || detail.chapters.length === 0) && <p className="px-2 py-1 text-xs text-zinc-600">暂无章节</p>}
          </div>
        )}
        <button
          type="button"
          onClick={() => onPanelChange(activePanel === "characters" ? null : "characters")}
          className={"flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " + (activePanel === "characters" ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
        >
          <span className="flex items-center gap-2.5"><UsersThree size={16} weight="duotone" aria-hidden /> 人物关系</span>
          <b className="text-xs text-faint">{detail?.characters.length ?? 0}</b>
        </button>
        {activePanel === "characters" && (
          <div className="ml-6 flex flex-col gap-0.5 border-l border-surface-2 pl-2">
            {(detail?.characters ?? []).slice(0, 12).map((character) => (
              <p key={character.id} className="truncate rounded-lg px-2 py-1 text-xs text-zinc-400" title={character.note ?? undefined}>{character.name}</p>
            ))}
            {(!detail || detail.characters.length === 0) && <p className="px-2 py-1 text-xs text-zinc-600">暂无人物</p>}
          </div>
        )}
        <button
          type="button"
          onClick={() => onPanelChange(activePanel === "world" ? null : "world")}
          className={"flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " + (activePanel === "world" ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
        >
          <span className="flex items-center gap-2.5"><GlobeHemisphereWest size={16} weight="duotone" aria-hidden /> 世界规则</span>
          <b className="text-xs text-faint">{detail?.worldviews.length ?? 0}</b>
        </button>
        {activePanel === "world" && (
          <div className="ml-6 flex flex-col gap-0.5 border-l border-surface-2 pl-2">
            {(detail?.worldviews ?? []).slice(0, 12).map((world) => (
              <p key={world.id} className="truncate rounded-lg px-2 py-1 text-xs text-zinc-400" title={world.note ?? undefined}>{world.name}</p>
            ))}
            {(!detail || detail.worldviews.length === 0) && <p className="px-2 py-1 text-xs text-zinc-600">暂无世界观</p>}
          </div>
        )}
      </nav>

      <div className="mt-4 border-t border-surface-2 pt-3">
        <SectionLabel>Tools</SectionLabel>
        <div className="flex flex-col gap-0.5">
          <Link href="/rankings?surface=workbench" data-active={activeToolPath === "/rankings"} aria-current={activeToolPath === "/rankings" ? "page" : undefined} className={toolLinkClass(activeToolPath === "/rankings")}>
            <Trophy size={16} weight="duotone" aria-hidden /> 扫榜简报
            {boundBriefs.length > 0 && <em className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] not-italic text-accent">已绑定 {boundBriefs[0].version}</em>}
          </Link>
          <Link href="/deconstruct?surface=workbench" data-active={activeToolPath === "/deconstruct"} aria-current={activeToolPath === "/deconstruct" ? "page" : undefined} className={toolLinkClass(activeToolPath === "/deconstruct")}>
            <Scissors size={16} weight="duotone" aria-hidden /> 参考拆解
            {boundPacks.length > 0 && <em className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] not-italic text-accent">已绑定 {boundPacks[0].version}</em>}
          </Link>
          <Link href="/chat?surface=workbench" data-active={activeToolPath === "/chat"} aria-current={activeToolPath === "/chat" ? "page" : undefined} className={toolLinkClass(activeToolPath === "/chat")}>
            <House size={16} weight="duotone" aria-hidden /> 独立写作对话
          </Link>
          <Link href="/skills?surface=workbench" data-active={activeToolPath === "/skills"} aria-current={activeToolPath === "/skills" ? "page" : undefined} className={toolLinkClass(activeToolPath === "/skills")}>
            <Sparkle size={16} weight="duotone" aria-hidden /> 技能广场
          </Link>
          <Link href="/tasks?surface=workbench" data-active={activeToolPath === "/tasks"} aria-current={activeToolPath === "/tasks" ? "page" : undefined} className={toolLinkClass(activeToolPath === "/tasks")}>
            <ListChecks size={16} weight="duotone" aria-hidden /> 任务中心
          </Link>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-surface-2 px-2 pt-3">
        <Link href="/projects" className="flex items-center gap-1.5 text-xs text-faint transition hover:text-zinc-200"><Question size={13} aria-hidden /> 使用说明</Link>
        <Link href="/account" className="flex items-center gap-1.5 text-xs text-faint transition hover:text-zinc-200"><UserCircle size={13} aria-hidden /> 账户与额度</Link>
      </div>
    </aside>
  );
}

function activeToolPath(pathname: string) {
  for (const path of ["/rankings", "/deconstruct", "/chat", "/skills", "/tasks"]) {
    if (pathname === path || pathname.startsWith(`${path}/`)) return path;
  }
  return undefined;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

export function WorkbenchSidebarLoader() {
  const pathname = usePathname();
  const router = useRouter();
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [boundBriefs, setBoundBriefs] = useState<BoundBrief[]>([]);
  const [boundPacks, setBoundPacks] = useState<BoundPack[]>([]);
  const [activePanel, setActivePanel] = useState<WorkbenchPanel>(null);
  const [novelsLoadState, setNovelsLoadState] = useState<WorkbenchLoadState>("loading");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadedDetailKey, setLoadedDetailKey] = useState<string | null>(null);
  const [failedDetailKey, setFailedDetailKey] = useState<string | null>(null);
  const activeNovelId = resolveCurrentNovelId({
    persistedId: readCurrentNovelId(),
    availableNovelIds: novels.map((novel) => novel.id),
  });
  const detailLoadKey = `${reloadVersion}:${activeNovelId ?? "none"}`;
  const activeDetail = detail?.novel.id === activeNovelId ? detail : null;
  const detailLoadState: WorkbenchLoadState = activeNovelId == null
    ? "ready"
    : failedDetailKey === detailLoadKey
      ? "error"
      : loadedDetailKey === detailLoadKey
        ? "ready"
        : "loading";
  const loadState: WorkbenchLoadState = novelsLoadState === "error"
    ? "error"
    : novelsLoadState === "loading"
      ? "loading"
      : detailLoadState;
  const isCurrentDetailReady = loadState === "ready" && activeDetail != null;

  useEffect(() => {
    let alive = true;
    void fetchJson<{ novels: NovelSummary[] }>("/api/v1/novels")
      .then((data) => {
        if (!Array.isArray(data.novels)) throw new Error("Invalid novel list response");
        if (!alive) return;
        setNovels(data.novels);
        setNovelsLoadState("ready");
      })
      .catch(() => {
        if (alive) setNovelsLoadState("error");
      });
    return () => {
      alive = false;
    };
  }, [reloadVersion]);

  useEffect(() => {
    if (activeNovelId == null) return;

    let alive = true;
    Promise.all([
      fetchJson<NovelDetail>(`/api/v1/novels/${activeNovelId}`),
      fetchJson<{ briefings: BoundBrief[] }>(`/api/v1/novels/${activeNovelId}/briefings`),
      fetchJson<{ packs: BoundPack[] }>(`/api/v1/novels/${activeNovelId}/benchmark-packs`),
    ]).then(([novel, briefs, packs]) => {
      if (!novel.novel || !Array.isArray(novel.chapters) || !Array.isArray(novel.characters) || !Array.isArray(novel.worldviews) || !Array.isArray(briefs.briefings) || !Array.isArray(packs.packs)) {
        throw new Error("Invalid workbench context response");
      }
      if (!alive) return;
      setDetail(novel);
      setBoundBriefs(briefs.briefings);
      setBoundPacks(packs.packs);
      setLoadedDetailKey(detailLoadKey);
    }).catch(() => {
      if (alive) setFailedDetailKey(detailLoadKey);
    });

    return () => {
      alive = false;
    };
  }, [activeNovelId, detailLoadKey]);

  const chapterHref = (chapter: ChapterRow) => {
    const novelId = activeNovelId ?? activeDetail?.novel.id ?? 0;
    const novelName = activeDetail?.novel.name ?? "";
    return `/chapter/${chapter.id}?novelId=${novelId}&novel=${encodeURIComponent(novelName)}&ch=${encodeURIComponent(chapter.ch)}&title=${encodeURIComponent(chapter.title || "未命名")}`;
  };

  return (
    <WorkbenchSidebar
      detail={activeDetail}
      boundBriefs={isCurrentDetailReady ? boundBriefs : []}
      boundPacks={isCurrentDetailReady ? boundPacks : []}
      activePanel={activePanel}
      onPanelChange={setActivePanel}
      chapterHref={chapterHref}
      activeToolPath={activeToolPath(pathname)}
      onWritingClick={() => router.push("/workspace")}
      loadState={loadState}
      onRetry={() => {
        setNovelsLoadState("loading");
        setReloadVersion((version) => version + 1);
      }}
    />
  );
}
