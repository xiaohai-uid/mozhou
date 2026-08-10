"use client";

// 风格蒸馏（07 工单已真实化）：上传文本 → 真实 LLM 风格分析（one-api 网关）→ 四维指南。
// 工单 14：命名保存到风格库 + 我的风格库列表/删除（同页闭环）+ 保存后"应用到对话"回流（真实库引用）
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Sparkle, Trash } from "@phosphor-icons/react/dist/ssr";

interface Guide {
  narrative: string;
  sentence: string;
  imagery: string;
  rhythm: string;
}

interface StyleRow {
  id: number;
  name: string;
  createdAt: string;
}

/** 默认风格名：风格_MMDD */
function defaultStyleName(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `风格_${mm}-${dd}`;
}

export function DistillView() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 工单 14：命名保存 + 我的风格库
  const [styleName, setStyleName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<StyleRow | null>(null);
  const [library, setLibrary] = useState<StyleRow[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const refreshLibrary = useCallback(async () => {
    const res = await fetch("/api/v1/styles");
    if (!res.ok) return;
    const data = (await res.json()) as { styles: StyleRow[] };
    setLibrary(data.styles);
  }, []);

  useEffect(() => {
    // 挂载时异步加载风格库（fetch 后 setState）；豁免规则误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshLibrary();
  }, [refreshLibrary]);

  async function analyze(file: File) {
    setAnalyzing(true);
    setError(null);
    setGuide(null);
    setSaved(null);
    setStyleName("");
    try {
      const text = await file.text();
      if (text.trim().length < 200) {
        throw new Error("文本太短，建议 1 万字以上效果更好（至少 200 字）");
      }
      const res = await fetch("/api/v1/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 20000) }),
      });
      const data = (await res.json()) as { guide?: Guide; error?: string };
      if (!res.ok) throw new Error(data.error ?? "分析失败");
      setGuide(data.guide ?? null);
      setStyleName(defaultStyleName());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveStyle() {
    if (!guide || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: styleName.trim() || defaultStyleName(),
          guide,
        }),
      });
      const data = (await res.json()) as { style?: StyleRow; error?: string };
      if (!res.ok) throw new Error(data.error ?? "保存失败");
      setSaved(data.style ?? null);
      setStyleName("");
      await refreshLibrary();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** R1/R2 回流：保存成功后一键进对话并自动选中该风格（真实库引用，工单 15 消费 styleId） */
  function applyToChat() {
    if (!saved) return;
    sessionStorage.setItem(
      "mozhou_pending_style",
      JSON.stringify({ styleId: saved.id, name: saved.name, at: Date.now() }),
    );
    router.push("/chat");
  }

  async function removeStyle(id: number) {
    if (deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/styles?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "删除失败");
      }
      if (saved?.id === id) setSaved(null);
      await refreshLibrary();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">风格蒸馏</h1>
      <p className="mt-2 text-sm text-muted">
        上传文本，分析写作风格，生成可复用的风格指南
      </p>

      {/* 上传区 */}
      <label
        className={`mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border border-dashed px-8 py-14 text-center transition ${
          fileName ? "border-accent/50 bg-accent/5" : "border-surface-2 hover:border-zinc-600"
        }`}
      >
        <FileText size={28} weight="duotone" className="text-zinc-400" aria-hidden />
        {fileName ? (
          <span className="text-sm font-medium text-zinc-100">{fileName}</span>
        ) : (
          <>
            <span className="text-sm text-zinc-200">点击选择或拖入文本文件</span>
            <span className="text-xs text-faint">支持 .txt / .md，建议 1 万字以上</span>
          </>
        )}
        <input
          type="file"
          accept=".txt,.md"
          className="hidden"
          disabled={analyzing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFileName(f.name);
              void analyze(f);
            }
          }}
        />
      </label>

      {analyzing && (
        <div className="mt-8 flex items-center justify-center gap-3 rounded-card border border-surface-2 bg-surface/50 py-10">
          <Sparkle size={20} className="animate-pulse text-accent" aria-hidden />
          <span className="text-sm text-muted">正在分析风格特征…</span>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {error}
        </p>
      )}

      {guide && (
        <div className="mt-8 space-y-4">
          <div className="rounded-card border border-surface-2 bg-surface/50 p-6">
            <h2 className="text-sm font-semibold text-zinc-100">风格指南</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
              <li className="flex gap-3">
                <span className="w-20 shrink-0 text-xs text-faint">叙事视角</span>
                {guide.narrative}
              </li>
              <li className="flex gap-3">
                <span className="w-20 shrink-0 text-xs text-faint">句式节奏</span>
                {guide.sentence}
              </li>
              <li className="flex gap-3">
                <span className="w-20 shrink-0 text-xs text-faint">意象偏好</span>
                {guide.imagery}
              </li>
              <li className="flex gap-3">
                <span className="w-20 shrink-0 text-xs text-faint">情绪节奏</span>
                {guide.rhythm}
              </li>
            </ul>
            {/* 工单 14：命名保存到风格库；保存成功后提供"应用到对话"回流 */}
            {!saved ? (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={styleName}
                  onChange={(e) => setStyleName(e.target.value)}
                  placeholder={`默认：${defaultStyleName()}`}
                  maxLength={30}
                  className="w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
                />
                <button
                  onClick={() => void saveStyle()}
                  disabled={saving}
                  className="shrink-0 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                >
                  {saving ? "保存中…" : "保存到风格库"}
                </button>
              </div>
            ) : (
              <div className="mt-5 flex flex-col items-center justify-between gap-3 sm:flex-row">
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                  <Check size={16} weight="bold" aria-hidden />
                  已保存「{saved.name}」
                </p>
                <button
                  onClick={applyToChat}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 sm:w-auto sm:px-6"
                >
                  <Sparkle size={15} weight="fill" aria-hidden />
                  应用到写作对话
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 我的风格库（工单 14：列表/删除） */}
      <h2 className="mt-10 text-sm font-semibold text-zinc-200">我的风格库</h2>
      <div className="mt-4 space-y-2">
        {library.map((s) => (
          <div
            key={s.id}
            className="group flex items-center justify-between rounded-card border border-surface-2 bg-surface/50 px-5 py-3.5"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Sparkle size={16} weight="duotone" className="text-accent" aria-hidden />
              {s.name}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-faint">
                {new Date(s.createdAt).toLocaleDateString("zh-CN")}
              </span>
              <button
                onClick={() => void removeStyle(s.id)}
                disabled={deletingId === s.id}
                aria-label={`删除 ${s.name}`}
                className="text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-400 disabled:opacity-40"
              >
                <Trash size={14} aria-hidden />
              </button>
            </span>
          </div>
        ))}
        {library.length === 0 && (
          <p className="rounded-card border border-dashed border-surface-2 px-5 py-8 text-center text-xs text-faint">
            还没有保存的风格，分析文本后命名保存即可复用
          </p>
        )}
      </div>
    </main>
  );
}
