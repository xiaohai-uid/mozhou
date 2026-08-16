"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Pause } from "@phosphor-icons/react/dist/ssr";

export type GenerationPhase =
  | "idle"
  | "preparing"
  | "streaming"
  | "finishing"
  | "complete"
  | "stopped"
  | "error";

const STAGES = [
  { key: "preparing", label: "准备上下文", detail: "人物、世界观与技能" },
  { key: "streaming", label: "流式生成", detail: "内容会实时出现" },
  { key: "finishing", label: "完成收尾", detail: "保存、检查与记录" },
  { key: "complete", label: "已完成", detail: "可以继续下一轮" },
] as const;

function phaseLabel(phase: GenerationPhase) {
  switch (phase) {
    case "preparing":
      return "正在准备上下文";
    case "streaming":
      return "正在流式生成";
    case "finishing":
      return "正在完成收尾";
    case "complete":
      return "生成完成";
    case "stopped":
      return "已停止，已保留当前内容";
    case "error":
      return "生成失败，可重试";
    default:
      return "等待开始";
  }
}

function formatElapsed(elapsedMs: number) {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function activeIndex(phase: GenerationPhase) {
  if (phase === "idle") return -1;
  if (phase === "stopped" || phase === "error") return 1;
  return STAGES.findIndex((stage) => stage.key === phase);
}

export function GenerationStageRail({
  phase,
  startedAt,
  onStop,
  compact = false,
}: {
  phase: GenerationPhase;
  startedAt: number | null;
  onStop: () => void;
  compact?: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const running = phase === "preparing" || phase === "streaming" || phase === "finishing";
  const index = activeIndex(phase);

  useEffect(() => {
    if (!startedAt || !running) return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (phase === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-2xl border border-accent/25 bg-accent/5 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-full ${running ? "animate-pulse bg-accent" : phase === "error" ? "bg-red-400" : phase === "stopped" ? "bg-yellow-400" : "bg-emerald-400"}`} />
          <span className="truncate text-xs font-medium text-zinc-200">{phaseLabel(phase)}</span>
          {startedAt && <span className="flex items-center gap-1 text-[10px] text-faint"><Clock size={12} /> {formatElapsed(elapsedMs)}</span>}
        </div>
        {running && (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-400/30 px-2.5 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
          >
            <Pause size={12} weight="fill" />
            停止
          </button>
        )}
      </div>

      <div className={`mt-3 ${compact ? "flex items-center gap-1" : "grid grid-cols-4 gap-1.5"}`}>
        {STAGES.map((stage, stageIndex) => {
          const complete = phase === "complete" || (index >= 0 && stageIndex < index);
          const current = index === stageIndex && phase !== "complete";
          return (
            <div key={stage.key} className={compact ? "flex min-w-0 flex-1 items-center gap-1" : "min-w-0"}>
              <div className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : current ? "border-accent/40 bg-accent/15 text-accent" : "border-surface-2 bg-background/30 text-zinc-600"}`}>
                {complete ? <Check size={11} weight="bold" /> : stageIndex + 1}
              </div>
              {!compact && (
                <div className="mt-1.5 truncate">
                  <p className={`truncate text-[10px] ${current ? "text-zinc-200" : complete ? "text-zinc-400" : "text-zinc-600"}`}>{stage.label}</p>
                  <p className="mt-0.5 truncate text-[9px] text-zinc-700">{stage.detail}</p>
                </div>
              )}
              {compact && stageIndex < STAGES.length - 1 && <span className={`h-px min-w-1 flex-1 ${complete ? "bg-emerald-400/30" : "bg-surface-2"}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
