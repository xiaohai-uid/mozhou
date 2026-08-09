"use client";

// 写作工具面板（UI）：合同 / 任务书 / 机检 / 上下文 四 tab。
// 形态参考 lingbi-next 写作工具面板（只读展示面），语义对齐 storyrepo。
import { useState } from "react";
import { ClipboardText, FileText, ShieldCheck, Stack } from "@phosphor-icons/react/dist/ssr";

const tabs = [
  { key: "contract", label: "合同", icon: ClipboardText },
  { key: "brief", label: "任务书", icon: FileText },
  { key: "checks", label: "机检", icon: ShieldCheck },
  { key: "context", label: "上下文", icon: Stack },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const demoChecks = [
  { name: "字数窗口", ok: true, detail: "2885 字（窗口 2400-3900）" },
  { name: "占位符", ok: true, detail: "无占位符" },
  { name: "泄密扫描", ok: true, detail: "未曝光 S-001/003/005" },
  { name: "实体登记", ok: true, detail: "青水河,田师 已登记" },
  { name: "复读检测", ok: false, detail: "相邻段落重复片段「\"田是它的」" },
  { name: "合同断言", ok: false, detail: "未覆盖必含词 守塔" },
];

export function WritingToolsPanel() {
  const [tab, setTab] = useState<TabKey>("contract");

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
              本章写作合同：正文须覆盖必含词，不得触碰禁区词（S- 信息差）。
            </p>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                必含词
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["开田", "肃界卫", "守塔"].map((w) => (
                  <span key={w} className="rounded-full border border-surface-2 px-2.5 py-1 text-xs text-zinc-300">
                    {w}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-faint">
                禁区词
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["S-001", "S-003", "S-005", "S-006"].map((w) => (
                  <span key={w} className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs text-red-400">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "brief" && (
          <div className="space-y-4">
            {[
              { title: "背景", body: "灰烬镇，灯童与陆沉舟立约：你守田，我守灯。" },
              { title: "本章目标", body: "完成第一次开田种苗，回程遇肃界卫盘查。" },
              { title: "必须推进", body: "P-005 背书、P-006 推进；S-006 加深。" },
              { title: "红线", body: "不炸穿 S-001/003/005；章末禁总结体。" },
            ].map((s) => (
              <div key={s.title}>
                <p className="text-xs font-semibold text-zinc-200">{s.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "checks" && (
          <ul className="space-y-2">
            {demoChecks.map((c) => (
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

        {tab === "context" && (
          <div className="space-y-5">
            {/* 上下文使用量 */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">上下文使用量</span>
                <span className="text-faint">4.2K / 8K</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full w-[52%] rounded-full bg-accent" />
              </div>
              <p className="mt-1.5 text-[11px] text-faint">超出 70% 将自动压缩</p>
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
              <ul className="mt-2 space-y-1.5">
                {[
                  { name: "人物库 · 陆沉舟 / 阿雀", on: true },
                  { name: "世界观 · 零界 / 灰烬镇", on: true },
                  { name: "章摘要 · 001-004", on: false },
                ].map((m) => (
                  <li key={m.name} className="flex items-center justify-between rounded-xl border border-surface-2 bg-surface/40 px-3.5 py-2.5">
                    <span className="text-xs text-zinc-300">{m.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        m.on ? "bg-accent/15 text-accent" : "bg-surface-2 text-faint"
                      }`}
                    >
                      {m.on ? "注入中" : "未注入"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
