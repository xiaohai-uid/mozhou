"use client";

// 创作台（A 版双栏写作台，工单 07）：
// 桌面三栏（左：作品/章节/人物/世界观/专项工具；中：AI 先提问 + 自由回答 + 最近正文 + 对话；
// 右：本次创作链路 + 默认技能状态 + ContextAssembler 输出 + 绑定参考）。
// 移动端：折叠左右栏 + 底部导航（写作/章节/故事/工具）+ 链路证据二级面板（抽屉）。
// 自由回答是一级入口；「AI 先提问」态在任何模板选择之前可见。
// 原型仅作交互参考（sites-plugin-sites-openai-bundled/app/prototype/mozhou-workbench），不复刻代码。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpenText,
  Feather,
  House,
  ListChecks,
  PenNib,
  Scissors,
  Sparkle,
  Trophy,
  UsersThree,
  GlobeHemisphereWest,
  ListNumbers,
  UserCircle,
  Question,
  ArrowUp,
  Pause,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { LogoutButton } from "@/app/workspace/logout-button";
import { GenerationStageRail, type GenerationPhase } from "@/components/features/generation-stage-rail";
import { BackButton } from "@/components/navigation/back-button";

/* ---------- 类型 ---------- */

interface NovelSummary {
  id: number;
  name: string;
  meta: string;
  ragEnabled: boolean;
}

interface ChapterRow {
  id: number;
  ch: string;
  title: string;
  content: string;
  status: string;
  sortOrder: number;
}

interface EntryRow {
  id: number;
  name: string;
  note: string | null;
}

interface NovelDetail {
  novel: NovelSummary;
  chapters: ChapterRow[];
  characters: EntryRow[];
  worldviews: EntryRow[];
}

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

interface BoundBrief {
  artifactId: string;
  version: string;
  provenance: { source: string; capturedAt: string };
}
interface BoundPack {
  artifactId: string;
  version: string;
  sourceRunId: number | null;
}

type MobileTab = "write" | "chapters" | "story" | "tools";

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

/* ---------- 小组件 ---------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
      {children}
    </p>
  );
}

function StatusDot({ state }: { state: string }) {
  return (
    <span aria-hidden className={"inline-block size-1.5 shrink-0 rounded-full " + (STATUS_TONE[state] ?? "bg-zinc-500")} />
  );
}

export function WorkbenchView({ userEmail }: { userEmail: string }) {
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [activeNovelId, setActiveNovelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [boundBriefs, setBoundBriefs] = useState<BoundBrief[]>([]);
  const [boundPacks, setBoundPacks] = useState<BoundPack[]>([]);
  const [builtinSkills, setBuiltinSkills] = useState<BuiltinSkillInfo[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>("idle");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [lastSentContent, setLastSentContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("write");
  const [railExpanded, setRailExpanded] = useState<"chapters" | "characters" | "worldviews" | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const phaseResetRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const generationRunRef = useRef(0);

  const skillName = useCallback(
    (key: string) => builtinSkills.find((s) => s.key === key)?.name ?? SKILL_FALLBACK_NAMES[key] ?? key,
    [builtinSkills],
  );

  useEffect(() => {
    fetch("/api/v1/novels")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { novels: NovelSummary[] } | null) => {
        if (data) setNovels(data.novels);
      });
    fetch("/api/v1/skills?scope=plaza")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { builtinSkills?: BuiltinSkillInfo[] } | null) => {
        if (data?.builtinSkills) setBuiltinSkills(data.builtinSkills);
      });
    fetch("/api/v1/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessions: SessionRow[] } | null) => {
        if (data) setSessions(data.sessions);
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
    setEvidence(null);
    setMessages([]);
    setSessionId(null);
    const [d, briefs, packs] = await Promise.all([
      fetch("/api/v1/novels/" + novelId).then((res) => (res.ok ? res.json() : null)),
      fetch("/api/v1/novels/" + novelId + "/briefings").then((res) => (res.ok ? res.json() : null)),
      fetch("/api/v1/novels/" + novelId + "/benchmark-packs").then((res) => (res.ok ? res.json() : null)),
    ]);
    if (d) setDetail(d as NovelDetail);
    setBoundBriefs((briefs as { briefings: BoundBrief[] } | null)?.briefings ?? []);
    setBoundPacks((packs as { packs: BoundPack[] } | null)?.packs ?? []);
    // 会话：优先复用该作品已有会话，否则新建
    const existing = sessions.find((s) => s.novelId === novelId);
    if (existing) {
      setSessionId(existing.id);
      const msgs = await fetch("/api/v1/sessions/" + existing.id + "/messages").then((res) => (res.ok ? res.json() : null));
      if (msgs) setMessages((msgs as { messages: ChatMsg[] }).messages);
    } else {
      const created = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId }),
      }).then((res) => (res.ok ? res.json() : null));
      if (created) {
        setSessionId((created as { session: SessionRow }).session.id);
        setSessions((prev) => [...prev, (created as { session: SessionRow }).session]);
      }
    }
  }, [sessions]);

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
        body: JSON.stringify({ sessionId, model: "deepseek-v4-flash", content, novelId: activeNovelId }),
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

  const latestChapter = [...(detail?.chapters ?? [])].sort((a, b) => b.sortOrder - a.sortOrder)[0];
  const draftText = latestChapter?.content.trim() ? latestChapter.content.trim().slice(0, 120) : null;
  const settledCount = latestChapter ? Number(latestChapter.ch) : 0;
  const evidenceRuns = evidence?.runs ?? [];

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      {/* ===== 顶栏 ===== */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-2 bg-zinc-950/70 px-4 lg:px-5">
        <div className="flex items-center gap-3">
          <BackButton />
          <Link href="/workspace" className="flex items-center gap-2.5" aria-label="墨舟创作台">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white">墨</span>
            <span className="hidden text-base font-semibold tracking-wide sm:inline">墨舟</span>
          </Link>
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
        <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-surface-2 bg-zinc-950/60 px-3 py-4 lg:flex">
          <SectionLabel>Current Work</SectionLabel>
          <div className="rounded-xl border border-surface-2 bg-surface/50 px-4 py-3">
            {detail ? (
              <>
                <p className="text-sm font-semibold text-zinc-100">{detail.novel.name}</p>
                <p className="mt-0.5 text-xs text-faint">{detail.novel.meta}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: Math.min(100, settledCount * 5) + "%" }} />
                </div>
                <p className="mt-1 text-[11px] text-faint">已写至第 {settledCount} 章</p>
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
              onClick={() => setRailExpanded(null)}
              className={"flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition " + (railExpanded === null ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
            >
              <PenNib size={16} weight="duotone" aria-hidden /> 写作对话
            </button>
            <button
              type="button"
              onClick={() => setRailExpanded(railExpanded === "chapters" ? null : "chapters")}
              className={"flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " + (railExpanded === "chapters" ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
            >
              <span className="flex items-center gap-2.5"><ListNumbers size={16} weight="duotone" aria-hidden /> 章节与大纲</span>
              <b className="text-xs text-faint">{detail?.chapters.length ?? 0}</b>
            </button>
            {railExpanded === "chapters" && (
              <div className="ml-6 flex flex-col gap-0.5 border-l border-surface-2 pl-2">
                {[...(detail?.chapters ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((ch) => (
                  <Link key={ch.id} href={"/chapter/" + ch.id} className="truncate rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                    {ch.ch} · {ch.title || "未命名"}
                  </Link>
                ))}
                {(!detail || detail.chapters.length === 0) && <p className="px-2 py-1 text-xs text-zinc-600">暂无章节</p>}
              </div>
            )}
            <button
              type="button"
              onClick={() => setRailExpanded(railExpanded === "characters" ? null : "characters")}
              className={"flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " + (railExpanded === "characters" ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
            >
              <span className="flex items-center gap-2.5"><UsersThree size={16} weight="duotone" aria-hidden /> 人物关系</span>
              <b className="text-xs text-faint">{detail?.characters.length ?? 0}</b>
            </button>
            {railExpanded === "characters" && (
              <div className="ml-6 flex flex-col gap-0.5 border-l border-surface-2 pl-2">
                {(detail?.characters ?? []).slice(0, 12).map((c) => (
                  <p key={c.id} className="truncate rounded-lg px-2 py-1 text-xs text-zinc-400" title={c.note ?? undefined}>{c.name}</p>
                ))}
                {(!detail || detail.characters.length === 0) && <p className="px-2 py-1 text-xs text-zinc-600">暂无人物</p>}
              </div>
            )}
            <button
              type="button"
              onClick={() => setRailExpanded(railExpanded === "worldviews" ? null : "worldviews")}
              className={"flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " + (railExpanded === "worldviews" ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-surface hover:text-zinc-100")}
            >
              <span className="flex items-center gap-2.5"><GlobeHemisphereWest size={16} weight="duotone" aria-hidden /> 世界规则</span>
              <b className="text-xs text-faint">{detail?.worldviews.length ?? 0}</b>
            </button>
            {railExpanded === "worldviews" && (
              <div className="ml-6 flex flex-col gap-0.5 border-l border-surface-2 pl-2">
                {(detail?.worldviews ?? []).slice(0, 12).map((w) => (
                  <p key={w.id} className="truncate rounded-lg px-2 py-1 text-xs text-zinc-400" title={w.note ?? undefined}>{w.name}</p>
                ))}
                {(!detail || detail.worldviews.length === 0) && <p className="px-2 py-1 text-xs text-zinc-600">暂无世界观</p>}
              </div>
            )}
          </nav>

          <div className="mt-4 border-t border-surface-2 pt-3">
            <SectionLabel>Tools</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <Link href="/rankings" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                <Trophy size={16} weight="duotone" aria-hidden /> 扫榜简报
                {boundBriefs.length > 0 && <em className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] not-italic text-accent">已绑定 {boundBriefs[0].version}</em>}
              </Link>
              <Link href="/deconstruct" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                <Scissors size={16} weight="duotone" aria-hidden /> 参考拆解
                {boundPacks.length > 0 && <em className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-[10px] not-italic text-accent">已绑定 {boundPacks[0].version}</em>}
              </Link>
              <Link href="/chat" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                <House size={16} weight="duotone" aria-hidden /> 独立写作对话
              </Link>
              <Link href="/skills" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                <Sparkle size={16} weight="duotone" aria-hidden /> 技能广场
              </Link>
              <Link href="/tasks" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-zinc-400 transition hover:bg-surface hover:text-zinc-100">
                <ListChecks size={16} weight="duotone" aria-hidden /> 任务中心
              </Link>
            </div>
          </div>

          <div className="mt-auto flex items-center justify-between border-t border-surface-2 px-2 pt-3">
            <Link href="/projects" className="flex items-center gap-1.5 text-xs text-faint transition hover:text-zinc-200"><Question size={13} aria-hidden /> 使用说明</Link>
            <Link href="/account" className="flex items-center gap-1.5 text-xs text-faint transition hover:text-zinc-200"><UserCircle size={13} aria-hidden /> 账户与额度</Link>
          </div>
        </aside>

        {/* ===== 中栏 ===== */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* 作品切换（有作品时显示） */}
          {novels.length > 0 && (
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
            {novels.length === 0 && (
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

            {novels.length > 0 && (
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

          {/* 自由回答主输入 */}
          {novels.length > 0 && (
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

        {/* ===== 右栏（桌面）：本次创作链路 ===== */}
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
                <Link href="/rankings" className="text-[11px] text-accent">管理市场简报 ↗</Link>
                <Link href="/deconstruct" className="text-[11px] text-accent">管理方法包 ↗</Link>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ===== 移动端底部导航 ===== */}
      <nav className="flex shrink-0 border-t border-surface-2 bg-zinc-950/90 lg:hidden" aria-label="移动端导航">
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
            className={"flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition " + (mobileTab === key ? "text-accent" : "text-faint")}
          >
            <Icon size={18} weight={mobileTab === key ? "fill" : "duotone"} aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      {/* ===== 移动端二级内容面板 ===== */}
      {mobileTab !== "write" && (
        <div className="fixed inset-x-0 bottom-12 top-14 z-20 overflow-y-auto border-t border-surface-2 bg-background px-4 py-4 lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {mobileTab === "chapters" ? "章节与大纲" : mobileTab === "story" ? "人物与世界观" : "专项工具"}
            </h2>
            <button type="button" onClick={() => setMobileTab("write")} aria-label="关闭" className="text-faint hover:text-zinc-200"><X size={18} /></button>
          </div>
          {mobileTab === "chapters" && (
            <div className="flex flex-col gap-1.5">
              {[...(detail?.chapters ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((ch) => (
                <Link key={ch.id} href={"/chapter/" + ch.id} className="rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200">
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
              <Link href="/rankings" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Trophy size={16} weight="duotone" aria-hidden /> 扫榜简报</Link>
              <Link href="/deconstruct" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Scissors size={16} weight="duotone" aria-hidden /> 参考拆解</Link>
              <Link href="/chat" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Feather size={16} weight="duotone" aria-hidden /> 独立写作对话</Link>
              <Link href="/skills" className="flex items-center gap-2.5 rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5 text-sm text-zinc-200"><Sparkle size={16} weight="duotone" aria-hidden /> 技能广场</Link>
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
