"use client";

// 技能广场（UI）：我的技能 + 创建入口 + 广场浏览。
import { useState } from "react";
import { Plus, Sparkle, DownloadSimple } from "@phosphor-icons/react/dist/ssr";

const mySkills = [
  { name: "网文开篇", desc: "黄金三章结构，钩子前置", tag: "写作" },
  { name: "伏笔管理", desc: "登记与回收纪律检查", tag: "一致性" },
];

const plazaSkills = [
  { name: "去 AI 味", desc: "反例库机检，动态合并红线", tag: "文风", author: "墨舟官方" },
  { name: "人物小传", desc: "角色弧光与动机推导", tag: "人物", author: "社区" },
  { name: "信息差设计", desc: "读者已知/角色已知对照表", tag: "设定", author: "社区" },
];

export function SkillsView() {
  const [showCreate, setShowCreate] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">技能广场</h1>
          <p className="mt-2 text-sm text-muted">
            声明式技能：提示词 + 规则，按需加载到写作对话
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500"
        >
          <Plus size={15} weight="bold" aria-hidden />
          创建技能
        </button>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <div className="mt-6 rounded-card border border-surface-2 bg-surface/50 p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-faint">技能名称</span>
              <input
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="例：悬念铺垫检查"
                className="mt-2 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-xs text-faint">一句话说明</span>
              <input
                value={skillDesc}
                onChange={(e) => setSkillDesc(e.target.value)}
                placeholder="这个技能做什么"
                className="mt-2 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="text-xs text-faint">系统提示词</span>
            <textarea
              rows={4}
              placeholder="写给 AI 的规则与指令…"
              className="mt-2 w-full resize-none rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
          </label>
          <button className="mt-4 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500">
            保存技能
          </button>
        </div>
      )}

      {/* 我的技能 */}
      <h2 className="mt-10 text-sm font-semibold text-zinc-200">我的技能</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {mySkills.map((s) => (
          <div key={s.name} className="rounded-card border border-surface-2 bg-surface/50 p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Sparkle size={16} weight="duotone" className="text-accent" aria-hidden />
                {s.name}
              </span>
              <span className="rounded-full border border-surface-2 px-2.5 py-0.5 text-[10px] text-faint">
                {s.tag}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* 广场 */}
      <h2 className="mt-10 text-sm font-semibold text-zinc-200">广场</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {plazaSkills.map((s) => (
          <div key={s.name} className="rounded-card border border-surface-2 bg-surface/50 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-100">{s.name}</span>
              <span className="rounded-full border border-surface-2 px-2.5 py-0.5 text-[10px] text-faint">
                {s.tag}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{s.desc}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[10px] text-faint">{s.author}</span>
              <button className="flex items-center gap-1 rounded-full border border-surface-2 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white">
                <DownloadSimple size={13} aria-hidden />
                安装
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
