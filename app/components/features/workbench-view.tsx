"use client";

// 创作台（A 版双栏写作台，工单 07）：
// 桌面三栏（左：作品/章节/人物/世界观/专项工具；中：AI 先提问 + 自由回答 + 最近正文 + 对话；
// 右：本次创作链路 + 默认技能状态 + ContextAssembler 输出 + 绑定参考）。
// 工作台侧栏在窄视口也保持展开；主内容横向延伸，避免入口被另一套导航替换。
// 自由回答是一级入口；「AI 先提问」态在任何模板选择之前可见。
// 原型仅作交互参考（sites-plugin-sites-openai-bundled/app/prototype/mozhou-workbench），不复刻代码。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpenText,
  Feather,
  ListNumbers,
  PenNib,
  Scissors,
  Sparkle,
  Trophy,
  UsersThree,
  ArrowUp,
  Pause,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { LogoutButton } from "@/app/workspace/logout-button";
import { GenerationStageRail, type GenerationPhase } from "@/components/features/generation-stage-rail";
import {
  WorkbenchSidebar,
  type BoundBrief,
  type BoundPack,
  type ChapterRow,
  type EntryRow,
  type NovelDetail,
  type NovelSummary,
  type WorkbenchPanel,
} from "@/components/features/workbench-sidebar";
import { BackButton } from "@/components/navigation/back-button";
import { BrandLockup } from "@/components/brand-lockup";
import {
  readCurrentNovelId,
  resolveCurrentNovelId,
  writeCurrentNovelId,
} from "@/lib/novels/current-novel";

interface SessionRow {
  id: number;
  title: string;
  novelId: number | null;
}

interface BuiltinSkillInfo {
  key: string;
  name: string;
  role: string;
  trigger: string;
  toggleable: boolean;
  connected: boolean;
  status: string;
  reason: string | null;
}

interface SkillRunView {
  runId: string;
  skillKey: string;
  status: string;
  evidence: string;
  reason: string | null;
  promptSection: { kind: string; tokens: number } | null;
  inputRefs: Array<{ kind: string; version: string }>;
}

interface EvidenceView {
  plan: {
    generationId: string;
    route: { phase: string };
    plannedSkills: Array<{ skillKey: string; trigger: string }>;
  };
  runs: SkillRunView[];
  manifest: {
    sections: Array<{ kind: string; tokens: number }>;
    skillRuns: Array<{ runId: string; skillKey: string; evidence: string }>;
  } | null;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

type MobileTab = "write" | "chapters" | "story" | "tools";
type WorkbenchLoadState = "loading" | "ready" | "error";

/** 风格库条目（GET /api/v1/styles 列表项；chat 只持 id+name，四维指南由服务端按 styleId 注入） */
type StyleOption = { id: number; name: string };

/** 胶囊按钮形态：选中=accent 填充，未选=描边（风格/技能胶囊共用此视觉） */
const capsuleClass = (active: boolean) =>
  `rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
    active ? "bg-accent/15 text-accent" : "border border-surface-2 text-faint hover:text-zinc-300"
  }`;

const SKILL_FALLBACK_NAMES: Record<string, string> = {
  story_grounding: "故事状态",
  chapter_planning: "章节规划",
  audience_genre: "读者与题材",
  narrative_style: "叙事声音",
  quality_gate: "成稿质量门",
};

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-400",
  degraded: "bg-amber-400",
  skipped: "bg-zinc-500",
  failed: "bg-red-400",
  applied: "bg-emerald-400",
  not_applied: "bg-zinc-500",
};

function StatusDot({ state }: { state: string }) {
  return (
    <span aria-hidden className={"inline-block size-1.5 shrink-0 rounded-full " + (STATUS_TONE[state] ?? "bg-zinc-500")} />
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as T;
}

/* ---------- Workbench 中央主面板（P0-B：左侧导航与中央内容必须同源切换） ---------- */

function OutlinePanel({ chapters }: { chapters: ChapterRow[] }) {
  return (
    <section aria-label="章节与大纲面板" className="mozhou-rise">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Outline</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">章节与大纲</h1>
      <p className="mt-2 text-sm leading-6 text-muted">管理章节顺序、标题与大纲入口。</p>
      <div className="mt-5 flex flex-col gap-2">
        {chapters.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-sm text-faint">暂无章节</p>
        ) : (
          [...chapters]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((ch) => (
              <div key={ch.id} className="rounded-xl border border-surface-2 bg-surface/40 px-4 py-3 text-sm text-zinc-200">
                <span className="font-mono text-xs text-faint">{ch.ch}</span> · {ch.title || "未命名"}
              </div>
            ))
        )}
      </div>
    </section>
  );
}

function CharactersPanel({ characters }: { characters: EntryRow[] }) {
  return (
    <section aria-label="人物关系面板" className="mozhou-rise">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Characters</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">人物关系</h1>
      <p className="mt-2 text-sm leading-6 text-muted">管理人物与关系网。</p>
      <div className="mt-5 flex flex-col gap-2">
        {characters.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-sm text-faint">暂无人物</p>
        ) : (
          characters.map((c) => (
            <div key={c.id} className="rounded-xl border border-surface-2 bg-surface/40 px-4 py-3 text-sm text-zinc-200">
              {c.name}
              {c.note ? <span className="mt-0.5 block text-xs text-faint">{c.note}</span> : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function WorldPanel({ worldviews }: { worldviews: EntryRow[] }) {
  return (
    <section aria-label="世界规则面板" className="mozhou-rise">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">World</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">世界规则</h1>
      <p className="mt-2 text-sm leading-6 text-muted">管理世界观与规则设定。</p>
      <div className="mt-5 flex flex-col gap-2">
        {worldviews.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-2 px-4 py-3 text-sm text-faint">暂无世界观</p>
        ) : (
          worldviews.map((w) => (
            <div key={w.id} className="rounded-xl border border-surface-2 bg-surface/40 px-4 py-3 text-sm text-zinc-200">
              {w.name}
              {w.note ? <span className="mt-0.5 block text-xs text-faint">{w.note}</span> : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function WorkbenchView({ userEmail }: { userEmail: string }) {
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [novelsLoadState, setNovelsLoadState] = useState<WorkbenchLoadState>("loading");
  const [novelsReloadVersion, setNovelsReloadVersion] = useState(0);
  const [activeNovelId, setActiveNovelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [contextLoadState, setContextLoadState] = useState<WorkbenchLoadState>("ready");
  const [boundBriefs, setBoundBriefs] = useState<BoundBrief[]>([]);
  const [boundPacks, setBoundPacks] = useState<BoundPack[]>([]);
  const [builtinSkills, setBuiltinSkills] = useState<BuiltinSkillInfo[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsReady, setSessionsReady] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>("idle");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [lastSentContent, setLastSentContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 选项乙（2026-08-22）：技能胶囊——开关型内置技能 + 我的技能，随请求送入 skills[]（正式链真实生效）
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [mySkillNames, setMySkillNames] = useState<string[]>([]);
  // R4 残留补全：风格单选胶囊——同时只生效一个；「无」= null（服务端不注入）
  const [styleId, setStyleId] = useState<number | null>(null);
  const [styleLibrary, setStyleLibrary] = useState<StyleOption[]>([]);
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("write");
  const [activePanel, setActivePanel] = useState<WorkbenchPanel>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const phaseResetRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const generationRunRef = useRef(0);
  const contextLoadRef = useRef(0);

  const skillName = useCallback(
    (key: string) => builtinSkills.find((s) => s.key === key)?.name ?? SKILL_FALLBACK_NAMES[key] ?? key,
    [builtinSkills],
  );

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
  }, [novelsReloadVersion]);

  useEffect(() => {
    fetch("/api/v1/skills?scope=plaza")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { builtinSkills?: BuiltinSkillInfo[] } | null) => {
        if (!data?.builtinSkills) return;
        setBuiltinSkills(data.builtinSkills);
        // 选项乙（2026-08-22）：开关型内置技能默认选中（对齐「默认技能按阶段自动调用」），可手动关
        const names = data.builtinSkills.filter((s) => s.toggleable && s.connected).map((s) => s.name);
        setActiveSkills((prev) => [...new Set([...prev, ...names])]);
      });
    fetch("/api/v1/skills?scope=mine")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { skills?: Array<{ name: string }> } | null) => {
        if (data?.skills) setMySkillNames(data.skills.map((s) => s.name));
      })
      .catch(() => {});
    fetch("/api/v1/styles")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { styles?: StyleOption[] } | null) => {
        if (data?.styles) setStyleLibrary(data.styles);
      })
      .catch(() => {});
    fetch("/api/v1/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessions: SessionRow[] } | null) => {
        if (data) setSessions(data.sessions);
        setSessionsReady(true);
      });
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (phaseResetRef.current !== null) window.clearTimeout(phaseResetRef.current);
  }, []);

  const loadNovel = useCallback(async (novelId: number) => {
    const contextLoadId = contextLoadRef.current + 1;
    contextLoadRef.current = contextLoadId;
    generationRunRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    completedRef.current = false;
    if (phaseResetRef.current !== null) window.clearTimeout(phaseResetRef.current);
    setStreaming(false);
    setGenerationPhase("idle");
    setGenerationStartedAt(null);
    setError(null);
    setLastSentContent(null);
    setActiveNovelId(novelId);
    writeCurrentNovelId(novelId);
    setEvidence(null);
    setMessages([]);
    setSessionId(null);
    setDetail(null);
    setBoundBriefs([]);
    setBoundPacks([]);
    setContextLoadState("loading");
    try {
      const [nextDetail, briefs, packs] = await Promise.all([
        fetchJson<NovelDetail>(`/api/v1/novels/${novelId}`),
        fetchJson<{ briefings: BoundBrief[] }>(`/api/v1/novels/${novelId}/briefings`),
        fetchJson<{ packs: BoundPack[] }>(`/api/v1/novels/${novelId}/benchmark-packs`),
      ]);
      if (!nextDetail.novel || !Array.isArray(nextDetail.chapters) || !Array.isArray(nextDetail.characters) || !Array.isArray(nextDetail.worldviews) || !Array.isArray(briefs.briefings) || !Array.isArray(packs.packs)) {
        throw new Error("Invalid workbench context response");
      }
      if (contextLoadId !== contextLoadRef.current) return;
      setDetail(nextDetail);
      setBoundBriefs(briefs.briefings);
      setBoundPacks(packs.packs);
      setContextLoadState("ready");
    } catch {
      if (contextLoadId === contextLoadRef.current) setContextLoadState("error");
      return;
    }
    // 会话：优先复用该作品已有会话，否则新建
    const existing = sessions.find((s) => s.novelId === novelId);
    if (existing) {
      setSessionId(existing.id);
      const msgs = await fetch("/api/v1/sessions/" + existing.id + "/messages").then((res) => (res.ok ? res.json() : null));
      if (contextLoadId === contextLoadRef.current && msgs) setMessages((msgs as { messages: ChatMsg[] }).messages);
    } else {
      const created = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId }),
      }).then((res) => (res.ok ? res.json() : null));
      if (contextLoadId === contextLoadRef.current && created) {
        setSessionId((created as { session: SessionRow }).session.id);
        setSessions((prev) => [...prev, (created as { session: SessionRow }).session]);
      }
    }
  }, [sessions]);

  // P0-A: 挂载后把“当前作品”解析到唯一状态源并加载详情。
  // newlyCreatedId 不需要从这里传入：创建页已把新作品 id 写入同一 localStorage 源。
  useEffect(() => {
    if (novelsLoadState !== "ready" || !sessionsReady || novels.length === 0) return;
    const resolved = resolveCurrentNovelId({
      newlyCreatedId: null,
      persistedId: readCurrentNovelId(),
      availableNovelIds: novels.map((n) => n.id),
    });
    if (resolved != null && resolved !== activeNovelId) {
      // Defer the stateful loader past the effect body to avoid a cascading render.
      void Promise.resolve().then(() => loadNovel(resolved));
    }
  }, [novelsLoadState, novels, sessions, sessionsReady, activeNovelId, loadNovel]);

  const retryWorkbenchLoad = useCallback(() => {
    if (novelsLoadState !== "ready") {
      setNovelsLoadState("loading");
      setNovelsReloadVersion((version) => version + 1);
      return;
    }
    if (activeNovelId != null) void loadNovel(activeNovelId);
  }, [activeNovelId, loadNovel, novelsLoadState]);

  async function send(contentOverride?: string) {
    const content = (contentOverride ?? input).trim();
    if (!content || streaming) return;
    setInput("");
    setError(null);
    setLastSentContent(content);
    setStreaming(true);
    completedRef.current = false;
    if (phaseResetRef.current !== null) window.clearTimeout(phaseResetRef.current);
    setGenerationPhase("preparing");
    setGenerationStartedAt(Date.now());
    setMessages((prev) => [...prev, { role: "user", content }, { role: "assistant", content: "" }]);
    let body = "";
    let sawDone = false;
    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, model: "glm-4.5-flash", content, novelId: activeNovelId, skills: activeSkills, styleId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { error?: string } | null)?.error ?? "请求失败（" + res.status + "）");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let current = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          if (generationRunRef.current !== runId) return;
          const line = evt.trim();
          if (!line.startsWith("data:")) continue;
          const data = JSON.parse(line.slice(5).trim()) as {
            type: string;
            text?: string;
            sessionId?: number;
            message?: string;
            generationId?: string;
            phase?: "preparing" | "streaming" | "finishing";
          };
          if (data.type === "start" && data.sessionId) {
            setSessionId(data.sessionId);
            if (data.phase) setGenerationPhase(data.phase);
          } else if (data.type === "phase" && data.phase) {
            setGenerationPhase(data.phase);
          } else if (data.type === "delta" && data.text) {
            setGenerationPhase("streaming");
            current += data.text;
            body = current;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: current };
              return next;
            });
          } else if (data.type === "done") {
            sawDone = true;
            // 右栏「本次创作链路」：拉取完整 plan/manifest（skillRuns 已在 done 中，这里取详情）
            if (data.generationId) {
              fetch("/api/v1/runtime/generations/" + data.generationId)
                .then((res) => (res.ok ? res.json() : null))
                .then((payload: { evidence?: EvidenceView } | null) => {
                  if (generationRunRef.current === runId && payload?.evidence) setEvidence(payload.evidence);
                })
                .catch(() => {});
            }
          } else if (data.type === "error") {
            throw new Error(data.message ?? "生成失败");
          }
        }
      }
      if (!sawDone) throw new Error("生成连接中断，请重试");
      if (!body) throw new Error("没有收到回复");
      setLastSentContent(null);
      completedRef.current = true;
    } catch (err) {
      if (generationRunRef.current !== runId) return;
      if (controller.signal.aborted) {
        setError(null);
        setGenerationPhase("stopped");
        if (!body) setMessages((prev) => prev.slice(0, -1));
      } else {
        setError((err as Error).message);
        setGenerationPhase("error");
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      if (generationRunRef.current !== runId) return;
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
      if (completedRef.current) {
        setGenerationPhase("complete");
        phaseResetRef.current = window.setTimeout(() => {
          setGenerationPhase("idle");
          setGenerationStartedAt(null);
        }, 2200);
      }
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function retryLast() {
    if (!lastSentContent || streaming) return;
    await send(lastSentContent);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const hasReadyNovels = novelsLoadState === "ready" && novels.length > 0;
  const sidebarLoadState: WorkbenchLoadState = novelsLoadState === "error"
    ? "error"
    : novelsLoadState === "loading"
      ? "loading"
      : novels.length === 0
        ? "ready"
        : activeNovelId == null
          ? "loading"
          : contextLoadState;
  const hasReadyContext = sidebarLoadState === "ready" && detail != null;
  const latestChapter = [...(detail?.chapters ?? [])].sort((a, b) => b.sortOrder - a.sortOrder)[0];
  const draftText = latestChapter?.content.trim() ? latestChapter.content.trim().slice(0, 120) : null;
  const evidenceRuns = evidence?.runs ?? [];

  // 章节链接必须携带 novelId/novel/ch/title，否则章节页拿不到作品上下文。
  const chapterHref = (ch: ChapterRow) => {
    const novelId = activeNovelId ?? detail?.novel.id ?? 0;
    const novelName = detail?.novel.name ?? "";
    return `/chapter/${ch.id}?novelId=${novelId}&novel=${encodeURIComponent(novelName)}&ch=${encodeURIComponent(ch.ch)}&title=${encodeURIComponent(ch.title || "未命名")}`;
  };

  return (
    <div className="mz-workbench-shell flex h-[100dvh] flex-col bg-background text-foreground">
      {/* ===== 顶栏 ===== */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-2 bg-zinc-950/70 px-4 lg:px-5">
        <div className="flex items-center gap-3">
          <BackButton />
          <BrandLockup href="/workspace" ariaLabel="墨舟创作台" compact />
          <span aria-hidden className="hidden h-4 w-px bg-surface-2 sm:block" />
          <span className="flex items-center gap-1.5 text-sm text-zinc-300">
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-accent" />
            {detail ? detail.novel.name : "创作台"}
            {detail && latestChapter && (
              <span className="text-xs text-faint">/ 第 {latestChapter.ch} 章 · {latestChapter.title}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* 移动端：链路证据入口 */}
          <button
            type="button"
            onClick={() => setEvidenceOpen(true)}
            disabled={!evidence}
            className="flex items-center gap-1.5 rounded-full border border-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-accent disabled:opacity-40 lg:hidden"
          >
            <Sparkle size={14} weight="duotone" aria-hidden />
            本次链路
          </button>
          <span className="hidden text-xs text-faint sm:inline" title={userEmail}>{userEmail}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ===== 左栏（桌面） ===== */}
        <WorkbenchSidebar
          detail={hasReadyContext ? detail : null}
          boundBriefs={hasReadyContext ? boundBriefs : []}
          boundPacks={hasReadyContext ? boundPacks : []}
          activePanel={activePanel}
          onPanelChange={setActivePanel}
          chapterHref={chapterHref}
          loadState={sidebarLoadState}
          onRetry={retryWorkbenchLoad}
        />

        {/* ===== 中栏 ===== */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* 作品切换（有作品时显示） */}
          {hasReadyNovels && (
            <div className="flex items-center gap-2 border-b border-surface-2 px-4 py-2">
              <label htmlFor="workbench-novel" className="text-xs text-faint">当前作品</label>
              <select
                id="workbench-novel"
                value={activeNovelId ?? ""}
                disabled={streaming}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v) void loadNovel(v);
                }}
                className="rounded-lg border border-surface-2 bg-zinc-950 px-2.5 py-1 text-sm text-zinc-200 outline-none transition focus:border-accent"
              >
                <option value="">未选择</option>
                {novels.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
          )}

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
            {/* 无作品空态 */}
            {novelsLoadState === "ready" && novels.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <BookOpenText size={30} weight="duotone" className="text-zinc-500" aria-hidden />
                <h1 className="mt-4 text-xl font-semibold">欢迎来到墨舟创作台</h1>
                <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-6 text-muted">
                  创建你的第一个小说作品：人物库、世界观设定与章节摘要会在这里汇合，AI 记得你笔下的世界。
                </p>
                <Link href="/projects" className="mt-6 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500">
                  创建作品
                </Link>
              </div>
            )}

            {hasReadyNovels && !hasReadyContext && (
              <div className="flex h-full items-center justify-center text-center">
                <p className="text-sm text-faint">
                  {sidebarLoadState === "error" ? "当前作品加载失败，请在左侧重试。" : "正在加载当前作品…"}
                </p>
              </div>
            )}

            {hasReadyContext && activePanel !== null && (
              <div className="mx-auto max-w-3xl">
                {activePanel === "outline" && <OutlinePanel chapters={detail?.chapters ?? []} />}
                {activePanel === "characters" && <CharactersPanel characters={detail?.characters ?? []} />}
                {activePanel === "world" && <WorldPanel worldviews={detail?.worldviews ?? []} />}
              </div>
            )}

            {hasReadyContext && activePanel === null && (
              <div className="mx-auto max-w-3xl">
                <div className="mozhou-rise">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Continue the story</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight">接着写，还是先聊聊？</h1>
                </div>

                {/* AI 先提问（messages 为空且未流式时可见；先于任何模板选择） */}
                {messages.length === 0 && !streaming && (
                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent/5 p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white" aria-hidden>墨</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-100">墨舟先问你</p>
                      <p className="mt-1 text-sm leading-6 text-zinc-300">这一章，你希望读者先感到什么？</p>
                      <p className="mt-1 text-xs leading-5 text-faint">不用选模板，直接告诉我。一个画面、一句对白，或者还没成形的念头都可以。</p>
                    </div>
                    <span aria-hidden className="ml-auto text-accent">✦</span>
                  </div>
                )}

                {/* 快捷起点 */}
                {messages.length === 0 && !streaming && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-faint">也可以从这里开始</span>
                    {[
                      "让阿雀在这一章第一次说出她知道的秘密，但不要马上解释原因。",
                      "这一章先把冲突推近一点，结尾留一个读者必须继续看的钩子。",
                      "我想自由描述这一章，不套模板。",
                    ].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setInput(q)}
                        className="rounded-full border border-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-accent/50 hover:text-accent"
                      >
                        {q.slice(0, 14)}…
                      </button>
                    ))}
                  </div>
                )}

                {/* 最近正文 */}
                {messages.length === 0 && !streaming && draftText && latestChapter && (
                  <Link href={"/chapter/" + latestChapter.id} className="mt-5 block rounded-2xl border border-surface-2 bg-surface/40 p-4 transition hover:border-zinc-600">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">最近正文 · 第 {latestChapter.ch} 章结尾</p>
                      <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-400">已保存</span>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-zinc-100">{latestChapter.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-300">{draftText}…</p>
                  </Link>
                )}

                {/* 对话区 */}
                {messages.map((m, i) => (
                  <div key={i} className={"mt-4 flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={"max-w-[82%] whitespace-pre-wrap px-4 py-2.5 text-sm leading-6 " + (m.role === "user" ? "rounded-2xl rounded-br-sm bg-accent text-white" : "rounded-2xl rounded-bl-sm border border-surface-2 bg-zinc-950 text-zinc-200")}>
                      {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                      {m.role === "assistant" && streaming && i === messages.length - 1 && (
                        <span aria-label="正在生成" className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />
                      )}
                    </div>
                  </div>
                ))}

                {error && (
                  <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-sm text-red-400">
                    <span>{error}</span>
                    {!streaming && lastSentContent && (
                      <button
                        type="button"
                        onClick={() => void retryLast()}
                        className="shrink-0 rounded-full border border-current px-3 py-1 text-xs transition hover:bg-current/10"
                      >
                        重试
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 自由回答主输入（仅写作对话面板显示） */}
          {hasReadyContext && activePanel === null && (
            <footer className="shrink-0 border-t border-surface-2 p-4">
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 lg:hidden">
                  <GenerationStageRail
                    phase={generationPhase}
                    startedAt={generationStartedAt}
                    onStop={stopGeneration}
                    compact
                  />
                </div>
                {/* 风格胶囊行：单选（R4）——「无」为显式选项，风格同时只生效一个 */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-faint">风格</span>
                  <button
                    type="button"
                    onClick={() => setStyleId(null)}
                    disabled={streaming}
                    aria-pressed={styleId === null}
                    title="不使用写作风格"
                    className={capsuleClass(styleId === null)}
                  >
                    无
                  </button>
                  {styleLibrary.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStyleId(s.id)}
                      disabled={streaming}
                      aria-pressed={styleId === s.id}
                      title={`应用「${s.name}」文风（单选）`}
                      className={capsuleClass(styleId === s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                  {styleLibrary.length === 0 && (
                    <span className="text-[10px] text-faint">（蒸馏页保存后出现）</span>
                  )}
                </div>
                {/* 技能胶囊行：开关型内置技能 + 我的技能（多选；默认全选内置，关闭后不注入本次生成） */}
                {(builtinSkills.some((s) => s.toggleable && s.connected) || mySkillNames.length > 0) && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-faint">技能</span>
                    {builtinSkills.filter((s) => s.toggleable && s.connected).map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() =>
                          setActiveSkills((prev) =>
                            prev.includes(s.name) ? prev.filter((x) => x !== s.name) : [...prev, s.name],
                          )
                        }
                        disabled={streaming}
                        title="内置技能（可开关，关闭后不注入本次生成）"
                        className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                          activeSkills.includes(s.name)
                            ? "bg-accent/15 text-accent"
                            : "border border-surface-2 text-faint hover:text-zinc-300"
                        }`}
                      >
                        {s.name}
                      </button>
                    ))}
                    {mySkillNames.map((name) => (
                      <button
                        key={"mine:" + name}
                        type="button"
                        onClick={() =>
                          setActiveSkills((prev) =>
                            prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
                          )
                        }
                        disabled={streaming}
                        title="我的技能（声明契约后注入正式写作链）"
                        className={`rounded-full px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
                          activeSkills.includes(name)
                            ? "bg-accent/15 text-accent"
                            : "border border-surface-2 text-faint hover:text-zinc-300"
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-surface-2 bg-zinc-950 p-2 transition focus-within:border-accent">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={streaming}
                    rows={2}
                    placeholder={streaming ? "正在生成…" : "自由回答，告诉墨舟你想让这一章发生什么…"}
                    className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-faint"
                  />
                  {streaming ? (
                    <button
                      type="button"
                      onClick={stopGeneration}
                      aria-label="停止生成"
                      title="停止生成"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-red-400/30 text-red-300 transition hover:bg-red-400/10"
                    >
                      <Pause size={15} weight="fill" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={!input.trim() || activeNovelId == null}
                      aria-label="发送"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-violet-500 active:translate-y-px disabled:opacity-40"
                    >
                      <ArrowUp size={16} weight="bold" />
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-center text-[11px] text-faint">Enter 发送 · Shift + Enter 换行 · 自由回答是一级入口</p>
              </div>
            </footer>
          )}
        </main>

        {/* ===== 右栏（桌面）：本次创作链路（窄屏用顶部「本次链路」抽屉替代） ===== */}
        <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-surface-2 bg-zinc-950/40 px-4 py-4 lg:flex">
          <GenerationStageRail
            phase={generationPhase}
            startedAt={generationStartedAt}
            onStop={stopGeneration}
          />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">This generation</p>
              <h2 className="mt-0.5 text-sm font-semibold">本次创作链路</h2>
            </div>
            {evidence?.plan && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{evidence.plan.generationId.slice(0, 8)}</span>
            )}
          </div>
          {!evidence ? (
            <p className="mt-3 rounded-xl border border-dashed border-surface-2 px-3.5 py-3 text-xs leading-5 text-faint">
              发送一条消息后，这里会显示本次生成中每个技能的运行证据：读取的产物、进入载荷的区段与检查结果。
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {evidenceRuns.map((run) => (
                <div key={run.runId} className="rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusDot state={run.status} />
                    <span className="text-sm font-medium text-zinc-200">{skillName(run.skillKey)}</span>
                    <span className="ml-auto text-[10px] text-faint">
                      {run.status === "completed" || run.status === "degraded"
                        ? run.evidence === "applied" ? "已进入载荷" : "未进入载荷"
                        : run.status === "skipped" ? "已跳过" : run.status}
                    </span>
                  </div>
                  {run.promptSection && (
                    <p className="mt-1 pl-3.5 text-[11px] text-muted">区段 {run.promptSection.kind} · {run.promptSection.tokens} tokens</p>
                  )}
                  {run.inputRefs.length > 0 && (
                    <p className="mt-0.5 pl-3.5 text-[11px] text-faint">读取产物：{run.inputRefs.map((ref) => ref.kind + " " + ref.version).join("、")}</p>
                  )}
                  {run.reason && <p className="mt-0.5 pl-3.5 text-[11px] text-faint">{run.reason}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 border-t border-surface-2 pt-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Default skills</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {builtinSkills.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-xs">
                  <StatusDot state={s.connected ? "applied" : "skipped"} />
                  <span className="text-zinc-300">{s.name}</span>
                  <span className="ml-auto text-faint">{s.connected ? "已接入" : "待接入"}</span>
                </div>
              ))}
              {builtinSkills.length === 0 && <p className="text-xs text-faint">加载中…</p>}
            </div>
          </div>

          {evidence?.manifest && (
            <div className="mt-5 border-t border-surface-2 pt-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Context assembler</p>
              <div className="mt-2 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5">
                <p className="text-xs text-zinc-300">
                  已选入 {evidence.manifest.sections.reduce((sum, s) => sum + s.tokens, 0)} tokens
                </p>
                <p className="mt-1 text-[11px] text-faint">{evidence.manifest.sections.map((s) => s.kind).join(" · ")}</p>
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-surface-2 pt-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">Bound references</p>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <p className="flex items-center gap-2 text-zinc-300">
                <Trophy size={13} weight="duotone" aria-hidden /> 7 日题材市场简报
                <em className="ml-auto not-italic text-faint">{boundBriefs[0] ? boundBriefs[0].version : "未绑定"}</em>
              </p>
              <p className="flex items-center gap-2 text-zinc-300">
                <Scissors size={13} weight="duotone" aria-hidden /> 个人拆解方法包
                <em className="ml-auto not-italic text-faint">{boundPacks[0] ? boundPacks[0].version : "未绑定"}</em>
              </p>
              <div className="flex gap-3 pt-1">
                <Link href="/rankings?surface=workbench" className="text-[11px] text-accent">管理市场简报 ↗</Link>
                <Link href="/deconstruct?surface=workbench" className="text-[11px] text-accent">管理方法包 ↗</Link>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ===== 移动端底部导航 ===== */}
      <nav className="flex h-14 shrink-0 border-t border-surface-2 bg-zinc-950/90 lg:hidden" aria-label="移动端导航">
        {([
          ["write", "写作", PenNib],
          ["chapters", "章节", ListNumbers],
          ["story", "故事", UsersThree],
          ["tools", "工具", Sparkle],
        ] as Array<[MobileTab, string, typeof PenNib]>).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMobileTab(key)}
            className={"flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[11px] transition " + (mobileTab === key ? "text-accent" : "text-faint")}
          >
            <Icon size={18} weight={mobileTab === key ? "fill" : "duotone"} aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      {/* ===== 移动端二级内容面板 ===== */}
      {mobileTab !== "write" && (
        <div className="fixed inset-x-0 bottom-14 top-14 z-20 overflow-y-auto border-t border-surface-2 bg-background px-4 py-4 lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {mobileTab === "chapters" ? "章节与大纲" : mobileTab === "story" ? "人物与世界观" : "专项工具"}
            </h2>
            <button type="button" onClick={() => setMobileTab("write")} aria-label="关闭" className="text-faint hover:text-zinc-200"><X size={18} /></button>
          </div>
          {mobileTab === "chapters" && (
            <div className="flex flex-col gap-1.5">
              {[...(detail?.chapters ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((ch) => (
                <Link key={ch.id} href={chapterHref(ch)} className="rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200">
                  {ch.ch} · {ch.title || "未命名"}
                </Link>
              ))}
              {(!detail || detail.chapters.length === 0) && <p className="text-sm text-faint">暂无章节</p>}
            </div>
          )}
          {mobileTab === "story" && (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-medium text-zinc-300">人物（{detail?.characters.length ?? 0}）</p>
                {(detail?.characters ?? []).map((c) => (
                  <p key={c.id} className="mt-1 text-sm text-zinc-400">{c.name}{c.note ? "：" + c.note : ""}</p>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-300">世界观（{detail?.worldviews.length ?? 0}）</p>
                {(detail?.worldviews ?? []).map((w) => (
                  <p key={w.id} className="mt-1 text-sm text-zinc-400">{w.name}{w.note ? "：" + w.note : ""}</p>
                ))}
              </div>
            </div>
          )}
          {mobileTab === "tools" && (
            <div className="flex flex-col gap-1.5">
              <Link href="/rankings?surface=workbench" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Trophy size={16} weight="duotone" aria-hidden /> 扫榜简报</Link>
              <Link href="/deconstruct?surface=workbench" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Scissors size={16} weight="duotone" aria-hidden /> 参考拆解</Link>
              <Link href="/chat?surface=workbench" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Feather size={16} weight="duotone" aria-hidden /> 独立写作对话</Link>
              <Link href="/skills?surface=workbench" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Sparkle size={16} weight="duotone" aria-hidden /> 技能广场</Link>
            </div>
          )}
        </div>
      )}

      {/* ===== 移动端链路证据抽屉（二级面板） ===== */}
      {evidenceOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" role="presentation" onClick={() => setEvidenceOpen(false)}>
          <div
            role="dialog"
            aria-label="本次创作链路"
            className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-surface-2 bg-background px-4 py-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">本次创作链路</h2>
              <button type="button" onClick={() => setEvidenceOpen(false)} aria-label="关闭" className="text-faint hover:text-zinc-200"><X size={18} /></button>
            </div>
            {!evidence ? (
              <p className="text-xs leading-5 text-faint">发送一条消息后，这里会显示本次生成的技能运行证据。</p>
            ) : (
              <div className="flex flex-col gap-2">
                {evidenceRuns.map((run) => (
                  <div key={run.runId} className="rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusDot state={run.status} />
                      <span className="text-sm font-medium text-zinc-200">{skillName(run.skillKey)}</span>
                      <span className="ml-auto text-[10px] text-faint">{run.status}</span>
                    </div>
                    {run.promptSection && (
                      <p className="mt-1 pl-3.5 text-[11px] text-muted">区段 {run.promptSection.kind} · {run.promptSection.tokens} tokens</p>
                    )}
                    {run.reason && <p className="mt-0.5 pl-3.5 text-[11px] text-faint">{run.reason}</p>}
                  </div>
                ))}
                {evidence.manifest && (
                  <p className="mt-1 text-[11px] text-faint">
                    ContextAssembler 已选入 {evidence.manifest.sections.reduce((sum, s) => sum + s.tokens, 0)} tokens
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
