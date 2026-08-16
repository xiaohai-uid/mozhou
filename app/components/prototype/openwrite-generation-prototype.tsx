"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Clock,
  FileText,
  Lightning,
  Pause,
  Play,
  Sparkle,
  Timer,
  Waveform,
} from "@phosphor-icons/react";

type Variant = "A" | "B" | "C";
type Phase = "idle" | "preparing" | "streaming" | "quality" | "ready" | "stopped" | "applied";

const GENERATED_TEXT =
  "她没有立刻推开那扇门。雨水沿着伞骨滴下来，在门槛前聚成一小片暗色的光。楼上的窗还亮着，像有人知道她会回来。";

const VARIANTS: Array<{ key: Variant; name: string; note: string }> = [
  { key: "A", name: "阶段轨道", note: "把等待拆成一条清晰的生成链路" },
  { key: "B", name: "生成驾驶舱", note: "把状态、上下文和停止集中到顶部" },
  { key: "C", name: "正文优先", note: "让用户始终看见结果会落在哪里" },
];

function useGenerationDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef<number[]>([]);
  const startedAt = useRef<number | null>(null);

  function clearTimers() {
    timers.current.forEach((timer) => {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    });
    timers.current = [];
  }

  function resetTimers() {
    clearTimers();
    startedAt.current = Date.now();
    setElapsed(0);
  }

  function start() {
    resetTimers();
    setText("");
    setPhase("preparing");

    const preparingTimer = window.setTimeout(() => {
      setPhase("streaming");
      let cursor = 0;
      const streamTimer = window.setInterval(() => {
        cursor = Math.min(GENERATED_TEXT.length, cursor + 2);
        setText(GENERATED_TEXT.slice(0, cursor));
        if (cursor >= GENERATED_TEXT.length) {
          window.clearInterval(streamTimer);
          setPhase("quality");
          const qualityTimer = window.setTimeout(() => setPhase("ready"), 1100);
          timers.current.push(qualityTimer);
        }
      }, 48);
      timers.current.push(streamTimer);
    }, 1400);
    timers.current.push(preparingTimer);
  }

  function stop() {
    if (phase !== "preparing" && phase !== "streaming" && phase !== "quality") return;
    clearTimers();
    setPhase("stopped");
  }

  function apply() {
    if (phase === "ready") setPhase("applied");
  }

  useEffect(() => {
    if (phase !== "preparing" && phase !== "streaming" && phase !== "quality") return;
    const timer = window.setInterval(() => {
      if (startedAt.current) setElapsed(Date.now() - startedAt.current);
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => clearTimers(), []);

  return { phase, text, elapsed, start, stop, apply };
}

function formatElapsed(elapsed: number) {
  return `${(elapsed / 1000).toFixed(1)}s`;
}

function phaseLabel(phase: Phase) {
  switch (phase) {
    case "preparing":
      return "正在准备上下文";
    case "streaming":
      return "正在流式生成";
    case "quality":
      return "正在检查一致性";
    case "ready":
      return "生成完成，等待确认";
    case "stopped":
      return "已停止，保留已生成内容";
    case "applied":
      return "已确认插入正文";
    default:
      return "等待开始";
  }
}

function phaseTone(phase: Phase) {
  if (phase === "ready" || phase === "applied") return "emerald";
  if (phase === "stopped") return "amber";
  if (phase === "idle") return "muted";
  return "violet";
}

function StatusPill({ phase }: { phase: Phase }) {
  const tone = phaseTone(phase);
  const styles = {
    emerald: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    amber: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    violet: "border-violet-400/25 bg-violet-400/10 text-violet-200",
    muted: "border-white/10 bg-white/[0.04] text-zinc-400",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${styles}`}>
      <span className={`size-1.5 rounded-full ${phase === "idle" ? "bg-zinc-500" : phase === "stopped" ? "bg-amber-300" : phase === "ready" || phase === "applied" ? "bg-emerald-300" : "animate-pulse bg-violet-300"}`} />
      {phaseLabel(phase)}
    </span>
  );
}

function ActionButton({
  phase,
  onStart,
  onStop,
  onApply,
  compact = false,
}: {
  phase: Phase;
  onStart: () => void;
  onStop: () => void;
  onApply: () => void;
  compact?: boolean;
}) {
  const base = compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm";
  if (phase === "preparing" || phase === "streaming" || phase === "quality") {
    return (
      <button
        type="button"
        onClick={onStop}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-300/10 font-medium text-rose-200 transition hover:bg-rose-300/20 ${base}`}
      >
        <Pause size={14} weight="fill" />
        停止生成
      </button>
    );
  }
  if (phase === "ready") {
    return (
      <button
        type="button"
        onClick={onApply}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-violet-400 font-semibold text-[#17121f] transition hover:bg-violet-300 ${base}`}
      >
        <Check size={14} weight="bold" />
        确认插入正文
      </button>
    );
  }
  if (phase === "applied") {
    return (
      <button
        type="button"
        onClick={onStart}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] font-medium text-zinc-200 transition hover:bg-white/10 ${base}`}
      >
        <Play size={14} weight="fill" />
        再生成一版
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-violet-400 font-semibold text-[#17121f] transition hover:bg-violet-300 ${base}`}
    >
      <Sparkle size={14} weight="fill" />
      {phase === "stopped" ? "重新生成" : "开始生成"}
    </button>
  );
}

function StageRail({ phase, compact = false }: { phase: Phase; compact?: boolean }) {
  const stages = [
    { key: "preparing", label: "准备上下文", detail: "人物 · 世界观 · 最近章节" },
    { key: "streaming", label: "流式生成", detail: "首字出现后持续输出" },
    { key: "quality", label: "一致性检查", detail: "生成结束后的快速检查" },
    { key: "ready", label: "等待确认", detail: "确认后才写入正文" },
  ];
  const activeIndex = phase === "idle" ? -1 : phase === "stopped" ? 1 : phase === "applied" ? 3 : stages.findIndex((stage) => stage.key === phase);

  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-2"}>
      {stages.map((stage, index) => {
        const complete = phase === "applied" || (activeIndex >= 0 && index < activeIndex);
        const active = activeIndex === index && phase !== "stopped";
        return (
          <div key={stage.key} className={compact ? "flex items-center gap-2" : "flex items-start gap-3"}>
            <div className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs ${complete ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-300" : active ? "border-violet-300/40 bg-violet-300/15 text-violet-200" : "border-white/10 bg-white/[0.03] text-zinc-600"}`}>
              {complete ? <Check size={13} weight="bold" /> : index + 1}
            </div>
            {!compact && (
              <div className="min-w-0 pt-0.5">
                <p className={`text-sm ${active ? "text-zinc-100" : complete ? "text-zinc-300" : "text-zinc-500"}`}>{stage.label}</p>
                <p className="mt-0.5 text-[11px] leading-5 text-zinc-600">{stage.detail}</p>
              </div>
            )}
            {compact && index < stages.length - 1 && <span className={`h-px w-4 ${complete ? "bg-emerald-300/30" : "bg-white/10"}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Prompt({ variant = "default" }: { variant?: "default" | "quiet" }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${variant === "quiet" ? "border-white/8 bg-white/[0.025]" : "border-violet-300/20 bg-violet-300/[0.06]"}`}>
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">你的指令</p>
      <p className="mt-2 text-sm leading-6 text-zinc-200">让主角在雨巷里第一次看见那扇亮着的窗，但不要马上解释是谁在等她。</p>
    </div>
  );
}

function Result({ phase, text, muted = false }: { phase: Phase; text: string; muted?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${muted ? "border-white/8 bg-white/[0.025]" : "border-white/10 bg-[#111019]"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="size-2 rounded-full bg-violet-300" /> AI 草稿
        </div>
        <StatusPill phase={phase} />
      </div>
      {phase === "preparing" && <p className="mt-6 text-sm text-zinc-400">正在读取人物、世界观和最近章节…</p>}
      {phase === "streaming" && <p className="mt-6 text-sm leading-7 text-zinc-200">{text}<span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-violet-300" /></p>}
      {phase === "quality" && <p className="mt-6 text-sm leading-7 text-zinc-200">{text}<span className="ml-2 text-xs text-zinc-500">正在检查人物和伏笔一致性…</span></p>}
      {(phase === "ready" || phase === "applied" || phase === "stopped") && (
        <p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-zinc-200">{text || "本次生成还没有产生正文。"}</p>
      )}
      {phase === "idle" && <p className="mt-6 text-sm leading-7 text-zinc-600">点击开始生成，观察每一个可理解的阶段。</p>}
      {phase === "ready" && <p className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><CheckCircle size={14} weight="fill" /> 草稿已完成，尚未写入正文</p>}
      {phase === "stopped" && <p className="mt-4 flex items-center gap-2 text-xs text-amber-300"><Pause size={14} weight="fill" /> 已保留当前内容，可以重新生成</p>}
      {phase === "applied" && <p className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><CheckCircle size={14} weight="fill" /> 已写入当前章节</p>}
    </div>
  );
}

function ContextList() {
  return (
    <div className="space-y-2">
      {[
        ["人物库", "阿雀 · 已读取"],
        ["世界观", "雨巷设定 · 已读取"],
        ["最近正文", "第 1 章末尾 · 1,204 字"],
        ["技能", "章节续写 · 已加载"],
      ].map(([label, value]) => (
        <div key={label} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5 text-xs">
          <span className="text-zinc-500">{label}</span>
          <span className="text-zinc-300">{value}</span>
        </div>
      ))}
    </div>
  );
}

function VariantA({ demo }: { demo: ReturnType<typeof useGenerationDemo> }) {
  return (
    <div className="mx-auto grid min-h-[calc(100vh-150px)] max-w-7xl gap-4 lg:grid-cols-[210px_minmax(0,1fr)_260px]">
      <aside className="rounded-3xl border border-white/10 bg-[#101017] p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">Generation flow</p>
        <h2 className="mt-2 text-lg font-semibold text-zinc-100">这次生成</h2>
        <div className="mt-8"><StageRail phase={demo.phase} /></div>
        <div className="mt-10 rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] p-3.5">
          <div className="flex items-center gap-2 text-xs text-violet-200"><Lightning size={14} weight="fill" /> OpenWrite 参考</div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">先展示，再确认写入。等待不应该是黑盒。</p>
        </div>
      </aside>

      <main className="rounded-3xl border border-white/10 bg-[#0f0f15] p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs text-zinc-500">第一章 · 雨巷</p><h1 className="mt-1 text-xl font-semibold text-zinc-100">章节续写</h1></div>
          <ActionButton phase={demo.phase} onStart={demo.start} onStop={demo.stop} onApply={demo.apply} />
        </div>
        <div className="mt-8 space-y-4">
          <Prompt />
          <Result phase={demo.phase} text={demo.text} />
        </div>
      </main>

      <aside className="space-y-4">
        <div className="rounded-3xl border border-white/10 bg-[#101017] p-5">
          <div className="flex items-center justify-between"><p className="text-xs text-zinc-500">实时状态</p><Clock size={15} className="text-zinc-600" /></div>
          <p className="mt-3 text-2xl font-semibold text-zinc-100">{formatElapsed(demo.elapsed)}</p>
          <p className="mt-1 text-xs text-zinc-600">从点击生成开始计时</p>
          <div className="mt-5"><ActionButton phase={demo.phase} onStart={demo.start} onStop={demo.stop} onApply={demo.apply} compact /></div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-[#101017] p-5"><p className="mb-3 text-xs text-zinc-500">本次上下文</p><ContextList /></div>
      </aside>
    </div>
  );
}

function VariantB({ demo }: { demo: ReturnType<typeof useGenerationDemo> }) {
  return (
    <div className="mx-auto min-h-[calc(100vh-150px)] max-w-5xl">
      <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#171523] via-[#111019] to-[#0d0d12] p-6 shadow-2xl shadow-violet-950/20 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><p className="text-xs text-violet-200/70">AI 写作驾驶舱</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">我正在替你做什么？</h1><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">任何时候都能看到当前阶段，也可以立刻停止并保留已经生成的内容。</p></div>
          <StatusPill phase={demo.phase} />
        </div>
        <div className="mt-8"><StageRail phase={demo.phase} compact /></div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-5 text-xs text-zinc-500"><span className="flex items-center gap-2"><Waveform size={15} className="text-violet-300" /> DeepSeek</span><span className="flex items-center gap-2"><Timer size={15} className="text-violet-300" /> {formatElapsed(demo.elapsed)}</span><span className="flex items-center gap-2"><FileText size={15} className="text-violet-300" /> {demo.text.length} 字</span></div>
          <ActionButton phase={demo.phase} onStart={demo.start} onStop={demo.stop} onApply={demo.apply} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-[1.25fr_.75fr]">
        <section className="rounded-[2rem] border border-white/10 bg-[#101017] p-6"><div className="flex items-center justify-between"><p className="text-xs text-zinc-500">对话记录</p><span className="text-[10px] uppercase tracking-[0.16em] text-zinc-700">Chapter 01</span></div><div className="mt-6 space-y-4"><Prompt variant="quiet" /><Result phase={demo.phase} text={demo.text} muted /></div></section>
        <section className="rounded-[2rem] border border-white/10 bg-[#101017] p-6"><p className="text-xs text-zinc-500">上下文检查</p><p className="mt-2 text-sm text-zinc-300">这次生成会使用：</p><div className="mt-4"><ContextList /></div><div className="mt-5 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3.5 text-xs leading-5 text-emerald-200/80">完成后只产生草稿，不会悄悄覆盖你的正文。</div></section>
      </div>
    </div>
  );
}

function VariantC({ demo }: { demo: ReturnType<typeof useGenerationDemo> }) {
  return (
    <div className="mx-auto grid min-h-[calc(100vh-150px)] max-w-7xl gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <main className="rounded-3xl border border-white/10 bg-[#121116] p-6 sm:p-9">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-5"><div><p className="text-xs text-zinc-600">第 1 章 · 雨巷</p><h1 className="mt-1 text-xl font-semibold text-zinc-100">正文编辑器</h1></div><span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-300">已保存</span></div>
        <div className="mx-auto mt-9 max-w-2xl text-[15px] leading-8 text-zinc-300">
          <p>她合上笔记本时，窗外正好起了风。故事还没有名字，但人物已经在纸上醒来。</p>
          <p className="mt-6">她抬头看了一眼楼上亮着的那扇窗，决定再往前走一步。</p>
          <div className={`my-7 rounded-2xl border-l-2 border-violet-300 bg-violet-300/[0.05] px-5 py-4 ${demo.text ? "text-zinc-200" : "text-zinc-600"}`}>
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-violet-200/70"><Sparkle size={13} /> AI 草稿预览</div>
            {demo.text || "生成内容会先出现在这里，不会直接覆盖正文。"}
            {(demo.phase === "streaming" || demo.phase === "quality") && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-violet-300" />}
          </div>
          <p className="text-zinc-600">正文目标：让读者知道有人在窗后等待，但暂时不揭示身份。</p>
        </div>
      </main>

      <aside className="rounded-3xl border border-white/10 bg-[#101017] p-5">
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">AI sidecar</p><h2 className="mt-1 text-lg font-semibold text-zinc-100">继续这一章</h2></div><Sparkle size={18} className="text-violet-300" /></div>
        <div className="mt-6"><Prompt variant="quiet" /></div>
        <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4"><div className="flex items-center justify-between text-xs text-zinc-500"><span>生成状态</span><span>{formatElapsed(demo.elapsed)}</span></div><p className="mt-3 text-sm text-zinc-200">{phaseLabel(demo.phase)}</p><div className="mt-4"><StageRail phase={demo.phase} /></div></div>
        <div className="mt-5 flex flex-col gap-2"><ActionButton phase={demo.phase} onStart={demo.start} onStop={demo.stop} onApply={demo.apply} /></div>
        <p className="mt-4 text-center text-[11px] leading-5 text-zinc-600">确认后将插入光标所在位置，并保留撤销能力。</p>
      </aside>
    </div>
  );
}

function PrototypeSwitcher({ variant, setVariant }: { variant: Variant; setVariant: (variant: Variant) => void }) {
  const currentIndex = VARIANTS.findIndex((item) => item.key === variant);
  function move(delta: number) {
    const next = VARIANTS[(currentIndex + delta + VARIANTS.length) % VARIANTS.length].key;
    window.history.replaceState(null, "", `?variant=${next}`);
    setVariant(next);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const current = VARIANTS[currentIndex];
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-violet-200/25 bg-[#191522]/95 px-2 py-2 text-xs text-zinc-200 shadow-2xl shadow-black/30 backdrop-blur">
      <button type="button" aria-label="上一个变体" onClick={() => move(-1)} className="rounded-xl p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"><ArrowLeft size={15} /></button>
      <div className="min-w-44 px-2 text-center"><span className="font-mono text-violet-200">{current.key}</span><span className="mx-2 text-zinc-700">·</span><span>{current.name}</span><p className="mt-0.5 text-[10px] text-zinc-500">{current.note}</p></div>
      <button type="button" aria-label="下一个变体" onClick={() => move(1)} className="rounded-xl p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"><ArrowRight size={15} /></button>
    </div>
  );
}

export function OpenWriteGenerationPrototype() {
  const demo = useGenerationDemo();
  const [variant, setVariant] = useState<Variant>("A");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("variant");
    if (value === "A" || value === "B" || value === "C") setVariant(value);
  }, []);

  return (
    <main className="min-h-screen bg-[#09090d] px-4 pb-28 pt-5 text-zinc-100 sm:px-6">
      <header className="mx-auto mb-5 flex max-w-7xl flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-indigo-500 text-sm font-bold text-white">墨</div><div><p className="text-sm font-semibold">墨舟 · 生成反馈原型</p><p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">throwaway / OpenWrite study</p></div></div>
        <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-3 py-1 text-[10px] text-amber-200"><Clock size={12} /> 本地内存状态</span><span className="rounded-full border border-white/8 px-3 py-1 text-[10px] text-zinc-500">?variant={variant}</span></div>
      </header>
      {variant === "A" && <VariantA demo={demo} />}
      {variant === "B" && <VariantB demo={demo} />}
      {variant === "C" && <VariantC demo={demo} />}
      {process.env.NODE_ENV !== "production" && <PrototypeSwitcher variant={variant} setVariant={setVariant} />}
    </main>
  );
}
