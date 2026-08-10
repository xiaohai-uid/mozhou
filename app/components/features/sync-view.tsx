"use client";

// 云同步（UI）：WebDAV 配置（坚果云默认端点）+ 同步状态。
import { useState } from "react";
import { CloudArrowUp, Eye, EyeSlash, ToggleLeft, ToggleRight } from "@phosphor-icons/react/dist/ssr";

export function SyncView() {
  const [showPassword, setShowPassword] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [testing, setTesting] = useState(false);

  async function saveAndTest() {
    if (testing) return;
    setTesting(true);
    // UI 先行：mock 连接测试延迟；后端 /api/v1/sync/config 实现后替换为真实 POST
    await new Promise((r) => setTimeout(r, 1200));
    setTesting(false);
    setConfigured(true);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      <h1 className="text-xl font-semibold tracking-tight">云同步</h1>
      <p className="mt-2 text-sm text-muted">
        通过 WebDAV 同步你的作品、会话与技能（支持坚果云等）
      </p>

      {/* 配置 */}
      <div className="mt-8 rounded-card border border-surface-2 bg-surface/50 p-6">
        <h2 className="text-sm font-semibold text-zinc-200">WebDAV 配置</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs text-faint">服务器地址</span>
            <input
              defaultValue="https://dav.jianguoyun.com/dav/"
              placeholder="https://dav.jianguoyun.com/dav/"
              className="mt-2 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
          </label>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-faint">账号</span>
              <input
                placeholder="坚果云邮箱"
                className="mt-2 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-xs text-faint">应用密码</span>
              <div className="relative mt-2">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="坚果云「应用密码」"
                  className="w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 pr-10 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
                />
                <button
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-zinc-300"
                >
                  {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>
        </div>
        <button
          onClick={() => void saveAndTest()}
          disabled={testing}
          className="mt-5 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
        >
          {testing ? "测试连接中…" : "保存并测试连接"}
        </button>
      </div>

      {/* 测试中 */}
      {testing && (
        <div className="mt-6 flex items-center justify-center gap-3 rounded-card border border-surface-2 bg-surface/50 py-8">
          <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="text-sm text-muted">正在连接 WebDAV 服务器…</span>
        </div>
      )}

      {/* 同步状态 */}
      {configured && (
        <div className="mt-6 rounded-card border border-surface-2 bg-surface/50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CloudArrowUp size={18} weight="duotone" className="text-accent" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-200">同步状态</h2>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
              已连接
            </span>
          </div>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[
              { name: "作品与章节", status: "3 分钟前同步" },
              { name: "会话记录", status: "3 分钟前同步" },
              { name: "技能包", status: "未更改" },
            ].map((item) => (
              <li
                key={item.name}
                className="flex items-center justify-between rounded-xl border border-surface-2 bg-zinc-950/60 px-4 py-3"
              >
                <span className="text-zinc-300">{item.name}</span>
                <span className="text-xs text-faint">{item.status}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-center justify-between border-t border-surface-2 pt-4">
            <div>
              <p className="text-sm text-zinc-300">自动同步</p>
              <p className="mt-0.5 text-xs text-faint">保存后自动上传变更</p>
            </div>
            <button
              onClick={() => setAutoSync((v) => !v)}
              aria-label={autoSync ? "关闭自动同步" : "开启自动同步"}
              className={autoSync ? "text-accent" : "text-faint"}
            >
              {autoSync ? <ToggleRight size={28} weight="fill" /> : <ToggleLeft size={28} weight="fill" />}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
