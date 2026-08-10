"use client";

// 技能广场（任务二-A 已真实化）：我的技能 CRUD + 广场安装（/api/v1/skills）。
// 技能 = 声明式（名称/说明/系统提示词），chat 顶部胶囊可加载注入。
import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, Plus, Sparkle, Trash } from "@phosphor-icons/react/dist/ssr";

interface Skill {
  id?: number;
  name: string;
  description: string;
  systemPrompt: string;
  author: string;
}

export function SkillsView() {
  const [showCreate, setShowCreate] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillPrompt, setSkillPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [mySkills, setMySkills] = useState<Skill[]>([]);
  const [plazaSkills, setPlazaSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mine, plaza] = await Promise.all([
      fetch("/api/v1/skills?scope=mine").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/v1/skills?scope=plaza").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (mine) setMySkills(mine.skills);
    if (plaza) setPlazaSkills(plaza.skills);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveSkill() {
    const name = skillName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: skillDesc.trim() || "自定义技能",
          systemPrompt: skillPrompt.trim() || `执行「${name}」的规则。`,
        }),
      });
      if (!res.ok) throw new Error("保存失败");
      setSkillName("");
      setSkillDesc("");
      setSkillPrompt("");
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function installSkill(s: Skill) {
    if (installing) return;
    setInstalling(s.name);
    try {
      const res = await fetch("/api/v1/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.name,
          description: s.description,
          systemPrompt: s.systemPrompt,
          author: s.author,
        }),
      });
      if (!res.ok) throw new Error("安装失败");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInstalling(null);
    }
  }

  async function deleteSkill(id: number | undefined) {
    if (!id) return;
    const res = await fetch(`/api/v1/skills?id=${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
  }

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

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}

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
              value={skillPrompt}
              onChange={(e) => setSkillPrompt(e.target.value)}
              rows={4}
              placeholder="写给 AI 的规则与指令…"
              className="mt-2 w-full resize-none rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
          </label>
          <button
            onClick={() => void saveSkill()}
            disabled={!skillName.trim() || saving}
            className="mt-4 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存技能"}
          </button>
        </div>
      )}

      {/* 我的技能 */}
      <h2 className="mt-10 text-sm font-semibold text-zinc-200">我的技能</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {mySkills.map((s) => (
          <div key={s.id ?? s.name} className="group rounded-card border border-surface-2 bg-surface/50 p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Sparkle size={16} weight="duotone" className="text-accent" aria-hidden />
                {s.name}
              </span>
              <span className="flex items-center gap-2">
                <span className="rounded-full border border-surface-2 px-2.5 py-0.5 text-[10px] text-faint">
                  {s.author}
                </span>
                <button
                  onClick={() => void deleteSkill(s.id)}
                  aria-label={`删除 ${s.name}`}
                  className="text-faint opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash size={14} aria-hidden />
                </button>
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{s.description}</p>
          </div>
        ))}
        {mySkills.length === 0 && (
          <p className="rounded-card border border-dashed border-surface-2 px-5 py-8 text-center text-xs text-faint">
            还没有技能，创建或从广场安装
          </p>
        )}
      </div>

      {/* 广场 */}
      <h2 className="mt-10 text-sm font-semibold text-zinc-200">广场</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {plazaSkills.map((s) => (
          <div key={s.name} className="rounded-card border border-surface-2 bg-surface/50 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-100">{s.name}</span>
              <span className="rounded-full border border-surface-2 px-2.5 py-0.5 text-[10px] text-faint">
                {s.author}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{s.description}</p>
            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => void installSkill(s)}
                disabled={installing !== null}
                className="flex items-center gap-1 rounded-full border border-surface-2 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white disabled:opacity-50"
              >
                <DownloadSimple size={13} aria-hidden />
                {installing === s.name ? "安装中…" : "安装"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
