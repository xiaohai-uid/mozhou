"use client";

// 风格蒸馏（UI 先行）：上传文本 → 分析中 → 风格指南四维。
// 当前为界面示意：本地 mock 数据演示流程；后端 /api/v1/distill 实现后替换为真实调用。
import { useState } from "react";
import { FileText, Sparkle } from "@phosphor-icons/react/dist/ssr";

interface Guide {
  narrative: string;
  sentence: string;
  imagery: string;
  rhythm: string;
}

// mock 风格指南（演示用；真实结果来自 LLM 风格分析）
const MOCK_GUIDE: Guide = {
  narrative: "第三人称限知视角，紧贴主角感官，场景以触觉与气味开场",
  sentence: "短句为主，动作前置，句中少用连接词，偶用顶针衔接",
  imagery: "偏好农耕/土地/器物意象，拟人化土地，数字具象化",
  rhythm: "段落短促如开垦节奏，冲突段落句长骤增，收束处留白",
};

export function DistillView() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze(file: File) {
    setAnalyzing(true);
    setError(null);
    setGuide(null);
    try {
      const text = await file.text();
      if (text.trim().length < 200) {
        throw new Error("文本太短，建议 1 万字以上效果更好（至少 200 字）");
      }
      // UI 先行：mock 延迟 + 假数据；后端接入后替换为
      // fetch("/api/v1/distill", { body: JSON.stringify({ text }) })
      await new Promise((r) => setTimeout(r, 1600));
      setGuide(MOCK_GUIDE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
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
            {/* R1/R2 回流：应用到写作对话（产物→上下文注入） */}
            <button
              onClick={() => {
                // 暂存指南，chat 页读取后注入为风格提示（R4 风格胶囊联动）
                sessionStorage.setItem(
                  "mozhou_pending_style",
                  JSON.stringify({
                    name: "本次蒸馏风格",
                    guide,
                    at: Date.now(),
                  }),
                );
                window.location.href = "/chat";
              }}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-violet-500"
            >
              <Sparkle size={15} weight="fill" aria-hidden />
              应用到写作对话
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
