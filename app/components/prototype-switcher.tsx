"use client";

// PROTOTYPE — 变体浮动切换器（?variant=A|B|C，←/→ 键循环；生产构建隐藏）
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const VARIANTS = [
  { key: "A", name: "三栏工作台" },
  { key: "B", name: "分段导航" },
  { key: "C", name: "大纲 + 抽屉" },
] as const;

export function PrototypeSwitcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = (searchParams.get("variant") ?? "A").toUpperCase();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const active = VARIANTS[idx >= 0 ? idx : 0];

  function cycle(dir: 1 | -1) {
    const next =
      VARIANTS[(VARIANTS.indexOf(active) + dir + VARIANTS.length) % VARIANTS.length];
    router.replace(`/prototype/novel-project?variant=${next.key}`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-2 text-sm shadow-lg shadow-black/40">
      <button
        onClick={() => cycle(-1)}
        aria-label="上一个变体"
        className="text-zinc-400 transition hover:text-violet-300"
      >
        ←
      </button>
      <span className="text-zinc-200">
        <span className="font-semibold text-violet-400">{active.key}</span>
        <span className="ml-2 text-zinc-400">{active.name}</span>
      </span>
      <button
        onClick={() => cycle(1)}
        aria-label="下一个变体"
        className="text-zinc-400 transition hover:text-violet-300"
      >
        →
      </button>
    </div>
  );
}
