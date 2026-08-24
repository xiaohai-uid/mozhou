"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { getBackNavigationMode } from "@/lib/navigation/back";

export function BackButton({ fallback = "/workspace" }: { fallback?: string }) {
  const router = useRouter();

  function handleBack() {
    const mode = getBackNavigationMode({
      historyLength: window.history.length,
      fallback,
    });
    if (mode === "history") {
      router.back();
    } else {
      router.replace(fallback);
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label="返回上一页"
      title="返回上一页"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-surface-2 text-zinc-400 transition hover:border-zinc-600 hover:bg-surface hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ArrowLeft size={17} weight="bold" aria-hidden />
    </button>
  );
}
