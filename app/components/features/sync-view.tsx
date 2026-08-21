"use client";

// 云备份：WebDAV 配置、连接测试和作品章节文件级单向推送。
// 当前范围只包含作品与章节正文；会话和技能不会被声称已经同步。
import { useEffect, useState } from "react";
import { CloudArrowUp, Eye, EyeSlash, ToggleLeft, ToggleRight } from "@phosphor-icons/react/dist/ssr";

export function SyncView() {
  const [url, setUrl] = useState("https://dav.jianguoyun.com/dav/");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [lastPush, setLastPush] = useState<{ at: string; pushed: number } | null>(null);

  useEffect(() => {
    // 加载已有配置（密码不回传，仅回填 URL/账号；状态区显示真实配置时间）
    fetch("/api/v1/sync/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { configured?: boolean; url?: string; username?: string; autoSync?: boolean; updatedAt?: string } | null) => {
        if (data?.configured) {
          setUrl((prev) => data.url ?? prev);
          setUsername(data.username ?? "");
          setAutoSync(data.autoSync ?? true);
          setUpdatedAt(data.updatedAt ?? null);
          setConfigured(true);
        }
      });
  }, []);

  async function saveAndTest() {
    if (testing) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/sync/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, username, password, autoSync }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "保存失败");
      setResult({ ok: data.ok ?? false, message: data.message ?? "已连接" });
      if (data.ok) {
        setConfigured(true);
        setUpdatedAt(new Date().toISOString());
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  /** 工单 20：立即同步（文件级单向推送） */
  async function pushNow() {
    if (pushing) return;
    setPushing(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/sync/push", { method: "POST" });
      const data = (await res.json()) as {
        pushed?: number;
        at?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "同步失败");
      if (data.pushed !== undefined && data.at) {
        setLastPush({ at: data.at, pushed: data.pushed });
        setResult({ ok: true, message: `已推送 ${data.pushed} 章` });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setPushing(false);
    }
  }

  /** 工单 20：autoSync 开关真实落库（PATCH 不重测连接） */
  async function toggleAutoSync() {
    const next = !autoSync;
    setAutoSync(next);
    try {
      await fetch("/api/v1/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSync: next }),
      });
    } catch {
      setAutoSync(!next); // 失败回滚
    }
  }

  return (
    <main className="mz-page mz-page-compact">
      <h1 className="mz-page-title text-xl font-semibold tracking-tight">云同步</h1>
      <p className="mz-page-description mt-2 text-sm text-muted">
        通过 WebDAV 备份你的作品章节（支持坚果云等）
      </p>

      {/* 配置 */}
      <div className="mt-8 rounded-card border border-surface-2 bg-surface/50 p-6">
        <h2 className="text-sm font-semibold text-zinc-200">WebDAV 配置</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-xs text-faint">服务器地址</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://dav.jianguoyun.com/dav/"
              className="mt-2 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
            />
          </label>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs text-faint">账号</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="坚果云邮箱"
                className="mt-2 w-full rounded-xl border border-surface-2 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-faint focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-xs text-faint">应用密码</span>
              <div className="relative mt-2">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
          disabled={testing || !url || !username || !password}
          className="mt-5 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
        >
          {testing ? "测试连接中…" : "保存并测试连接"}
        </button>
        {result && (
          <p
            role={result.ok ? "status" : "alert"}
            className={`mt-3 text-xs ${result.ok ? "text-emerald-400" : "text-yellow-400"}`}
          >
            {result.message}
          </p>
        )}
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
              {
                name: "作品与章节",
                status: lastPush
                  ? `上次推送 ${new Date(lastPush.at).toLocaleString()} · ${lastPush.pushed} 章`
                  : updatedAt
                    ? "配置已保存，尚未推送"
                    : "未同步",
              },
              { name: "会话记录", status: "暂不纳入（范围决策）" },
              { name: "技能包", status: "暂不纳入（范围决策）" },
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
          {/* 工单 20：立即同步（文件级单向推送，mozhou/<作品名>/<章节号>-<标题>.md） */}
          <button
            onClick={() => void pushNow()}
            disabled={pushing}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            <CloudArrowUp size={15} weight="bold" aria-hidden />
            {pushing ? "同步中…" : "立即同步"}
          </button>
          <p className="mt-2 text-[11px] text-faint">
            作品章节以正文推送为 mozhou/&lt;作品名&gt;/&lt;章节号&gt;-&lt;标题&gt;.md（人可读、可迁移）
          </p>
          <div className="mt-5 flex items-center justify-between border-t border-surface-2 pt-4">
            <div>
              <p className="text-sm text-zinc-300">自动同步</p>
              <p className="mt-0.5 text-xs text-faint">保存后自动上传变更</p>
            </div>
            <button
              onClick={() => void toggleAutoSync()}
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
