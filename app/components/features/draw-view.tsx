"use client";

// 抽卡模式：多模型并行真实调用（one-api 双渠道）。
import { useState } from "react";
import { Cards, Play } from "@phosphor-icons/react/dist/ssr";

const MODEL_OPTIONS = [
  { id: "deepseek-v4-flash", label: "DeepSeek（免费）" },
  { id: "glm-4.5-flash", label: "GLM（免费）" },
] as const;

interface DrawOutput {
  model: string;
  text: string;
}

export function DrawView() {
  const [selected, setSelected] = useState<string[]>(["deepseek-v4-flash"]);
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [outputs, setOutputs] = useState<DrawOutput[]>([]);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function run() {
    if (selected.length === 0) return;
    setRunning(true);
    setError(null);
    setOutputs([]);
    try {
      // 并行调用所有选中模型
      const results = await Promise.all(
        selected.map(async (id) => {
          const res = await fetch("/api/v1/draw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: id, instruction }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) throw new Error(data.error ?? `模型 ${id} 失败`);
          return {
            model: MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id,
            text: data.text ?? "",
          };
        }),
      );
      setOutputs(results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:px-8">
      <div className="flex items-center gap-2">
        <Cards size={22} weight="duotone" className="text-accent" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">抽卡模式</h1>
      </div>
      <p className="mt-2 text-sm text-muted">同一指令，多模型并行对比输出</p>

      {/* 配置区 */}
      <div className="mt-8 rounded-card border border-surface-2 bg-surface/50 p-6">
        <h2 className="text-sm font-semibold text-zinc-200">选择模型</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {MODEL_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              aria-pressed={selected.includes(m.id)}
              className={`rounded-full px-5 py-2 text-sm transition ${
                selected.includes(m.id)
                  ? "bg-accent text-white"
                  : "border border-surface-2 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="mt-5 block">
          <span className="text-xs text-faint">写作指令</span>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="例：写一段雨夜，阿雀在门口等陆沉舟回来，300 字内"
            className="mt-2 w-full resize-none rounded-xl border border-surface-2 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          onClick={() => void run()}
          disabled={selected.length === 0 || running}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-sm font-medium text-white transition hover:bg-violet-500 active:translate-y-px disabled:opacity-40"
        >
          <Play size={16} weight="fill" aria-hidden />
          {running ? "生成中…" : "开始抽卡"}
        </button>
      </div>

      {/* 真实对比区 */}
      {(running || outputs.length > 0) && (
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {outputs.map((o) => (
            <div key={o.model} className="rounded-card border border-surface-2 bg-surface/50 p-6">
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
                {o.model}
              </span>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-200">
                {o.text}
              </p>
            </div>
          ))}
          {running && (
            <div className="rounded-card border border-surface-2 bg-surface/50 p-6 md:col-span-2">
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
                模型并行生成中…
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
