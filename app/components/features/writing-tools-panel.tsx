"use client";

// 写作工具面板：合同 / 任务书 / 机检 / 上下文四 tab。
// 独立对话没有绑定作品时，只显示真实边界，不用某个示例作品冒充当前上下文。
import { useState } from "react";
import { ClipboardText, FileText, ShieldCheck, Stack } from "@phosphor-icons/react/dist/ssr";

const tabs = [
  { key: "contract", label: "合同", icon: ClipboardText },
  { key: "brief", label: "任务书", icon: FileText },
  { key: "checks", label: "机检", icon: ShieldCheck },
  { key: "context", label: "上下文", icon: Stack },
] as const;

type TabKey = (typeof tabs)[number]["key"];

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export function WritingToolsPanel() {
  const [tab, setTab] = useState<TabKey>("contract");
  // 机检（任务二-B）：输入正文 → 真实 6 项检查
  const [checkText, setCheckText] = useState("");
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function runChecks() {
    const text = checkText.trim();
    if (!text || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch("/api/v1/tools/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mustCover: [] }),
      });
      const data = (await res.json()) as {
        checks?: CheckResult[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "机检失败");
      setChecks(data.checks ?? null);
    } catch (err) {
      setCheckError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-surface-2 bg-zinc-950/40">
      {/* tab 切换 */}
      <div className="flex border-b border-surface-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 flex-col items-center gap-1 px-1 py-3 text-[11px] transition ${
                tab === t.key
                  ? "border-b-2 border-accent text-zinc-100"
                  : "text-faint hover:text-zinc-300"
              }`}
            >
              <Icon size={16} weight="duotone" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "contract" && (
          <div className="space-y-4">
            <p className="text-xs leading-5 text-muted">
              当前是独立写作对话，尚未绑定作品或章节合同。进入具体章节后，合同应由章节上下文提供。
            </p>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                当前状态
              </p>
              <span className="mt-2 inline-flex rounded-full border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-1 text-xs text-yellow-400">
                未绑定章节合同
              </span>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                机检说明
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">下方机检只执行通用规则；作品专属禁区必须由真实合同传入。</p>
            </div>
          </div>
        )}

        {tab === "brief" && (
          <div className="space-y-4">
            <p className="text-xs leading-5 text-muted">
              当前对话没有可验证的章节任务书。任务书需要绑定作品和章节后，从真实大纲、设定和前文生成；这里不会显示虚构背景或目标。
            </p>
            <span className="inline-flex rounded-full border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-1 text-xs text-yellow-400">
              未生成任务书
            </span>
          </div>
        )}

        {tab === "checks" && (
          <div className="space-y-3">
            <textarea
              value={checkText}
              onChange={(e) => setCheckText(e.target.value)}
              rows={6}
              placeholder="粘贴本章正文，运行机器检查…"
              className="w-full resize-none rounded-xl border border-surface-2 bg-zinc-950 px-3 py-2.5 text-xs leading-5 text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
            <button
              onClick={() => void runChecks()}
              disabled={!checkText.trim() || checking}
              className="w-full rounded-full bg-accent py-2 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              {checking ? "检查中…" : "运行机检"}
            </button>
            {checkError && (
              <p role="alert" className="text-xs text-red-400">
                {checkError}
              </p>
            )}
            {checks && (
              <ul className="space-y-2">
                {checks.map((c) => (
                  <li
                    key={c.name}
                    className={`rounded-xl border px-3.5 py-2.5 ${
                      c.ok
                        ? "border-surface-2 bg-surface/40"
                        : "border-red-500/30 bg-red-500/5"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`size-1.5 rounded-full ${
                          c.ok ? "bg-emerald-400" : "bg-red-400"
                        }`}
                      />
                      <span className="text-xs font-medium text-zinc-200">{c.name}</span>
                    </div>
                    <p className="mt-1 pl-3.5 text-[11px] leading-4 text-muted">{c.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "context" && (
          <div className="space-y-5">
            {/* 上下文使用量 */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">上下文使用量</span>
                <span className="text-faint">未绑定会话</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" />
              <p className="mt-1.5 text-[11px] text-faint">发送消息后按真实 payload 计算；此面板不估算上下文。</p>
            </div>

            {/* 压缩开关 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-300">自动压缩</p>
                <p className="mt-0.5 text-[11px] text-faint">长对话自动摘要旧消息</p>
              </div>
              <button
                aria-label="自动压缩开关"
                className="rounded-full bg-accent px-4 py-1.5 text-[11px] font-medium text-white"
              >
                开启
              </button>
            </div>

            {/* 记忆注入 */}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                记忆注入
              </p>
              <p className="mt-2 rounded-xl border border-dashed border-surface-2 px-3.5 py-2.5 text-xs leading-5 text-faint">
                当前未绑定作品，人物库、世界观和章节摘要不会注入。绑定作品后以服务端 payload 为准。
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
