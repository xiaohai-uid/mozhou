"use client";

// 会员中心（11 工单已真实化）：当前状态 + 套餐对比 + 真实用量（/api/v1/account）。
import { useEffect, useState } from "react";
import { Check, Crown } from "@phosphor-icons/react/dist/ssr";

const features = [
  { name: "写作对话（流式）", free: true, member: true },
  { name: "风格蒸馏", free: false, member: true },
  { name: "小说拆解", free: false, member: true },
  { name: "抽卡模式", free: false, member: true },
  { name: "联网搜索", free: false, member: true },
  { name: "云同步容量", free: "500MB", member: "10GB" },
  { name: "高级模型 BYOK", free: false, member: true },
];

interface AccountOverview {
  email: string;
  plan: "free" | "member";
  quota: {
    token: { used: number; total: number; pct: number };
    draw: { used: number; total: number; pct: number };
  };
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
}

export function AccountView() {
  const [isMember, setIsMember] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [overview, setOverview] = useState<AccountOverview | null>(null);

  useEffect(() => {
    // 11 工单：真实用量
    fetch("/api/v1/account")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AccountOverview | null) => {
        if (data) {
          setOverview(data);
          setIsMember(data.plan === "member");
        }
      });
  }, []);

  async function upgrade() {
    if (upgrading || isMember) return;
    setUpgrading(true);
    // UI 先行：mock 开通延迟；后端 /api/v1/account/upgrade 实现后替换为真实 POST
    await new Promise((r) => setTimeout(r, 1200));
    setUpgrading(false);
    setIsMember(true);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      {/* 当前状态 */}
      <div className="rounded-card border border-surface-2 bg-surface/50 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-base font-bold text-white">
              墨
            </span>
            <div>
              <h1 className="text-base font-semibold text-zinc-100">
                {isMember ? "会员" : "免费版"}
              </h1>
              <p className="mt-0.5 text-xs text-faint">figma-test@mozhou.local</p>
            </div>
          </div>
          {!isMember && (
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
              免费 · 0 元
            </span>
          )}
        </div>
      </div>

      {/* 套餐对比 */}
      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="rounded-card border border-surface-2 bg-surface/50 p-6">
          <h2 className="text-sm font-semibold text-zinc-100">免费版</h2>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            ¥0<span className="text-sm font-normal text-faint"> / 月</span>
          </p>
          <ul className="mt-5 space-y-2.5">
            {features.map((f) => (
              <li key={f.name} className="flex items-center gap-2.5 text-sm">
                {f.free ? (
                  <Check size={15} weight="bold" className="shrink-0 text-accent" aria-hidden />
                ) : (
                  <span className="inline-block size-[15px] shrink-0" aria-hidden />
                )}
                <span className={f.free ? "text-zinc-300" : "text-faint"}>
                  {f.name}
                  {typeof f.free === "string" ? `（${f.free}）` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative rounded-card border border-accent/40 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(127,34,254,0.14),transparent_55%),var(--surface)] p-6">
          <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-[10px] text-accent">
            <Crown size={11} weight="fill" aria-hidden />
            推荐
          </span>
          <h2 className="text-sm font-semibold text-zinc-100">会员</h2>
          <p className="mt-1 text-2xl font-semibold text-zinc-100">
            ¥19<span className="text-sm font-normal text-faint"> / 月</span>
          </p>
          <ul className="mt-5 space-y-2.5">
            {features.map((f) => (
              <li key={f.name} className="flex items-center gap-2.5 text-sm">
                <Check size={15} weight="bold" className="shrink-0 text-accent" aria-hidden />
                <span className="text-zinc-300">
                  {f.name}
                  {typeof f.member === "string" ? `（${f.member}）` : ""}
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => void upgrade()}
            disabled={upgrading || isMember}
            className="mt-6 w-full rounded-full bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {upgrading ? "开通中…" : isMember ? "已是会员" : "升级为会员"}
          </button>
        </div>
      </div>


      {/* 额度与用量（11 工单：真实聚合） */}
      <div className="mt-8 rounded-card border border-surface-2 bg-surface/50 p-6">
        <h2 className="text-sm font-semibold text-zinc-200">额度与用量</h2>
        {(overview?.quota.token.pct ?? 0) >= 100 && (
          <p className="mt-2 flex items-center gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-400">
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-yellow-400" aria-hidden />
            Token 额度已用完（RateLimited）—— 升级会员解锁更多
          </p>
        )}
        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
          {[
            {
              label: "本月 Token",
              used: fmt(overview?.quota.token.used ?? 0),
              total: fmt(overview?.quota.token.total ?? 500000),
              pct: overview?.quota.token.pct ?? 0,
            },
            {
              label: "抽卡次数",
              used: String(overview?.quota.draw.used ?? 0),
              total: String(overview?.quota.draw.total ?? 20),
              pct: overview?.quota.draw.pct ?? 0,
            },
          ].map((q) => (
            <div key={q.label}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-faint">{q.label}</span>
                <span className="text-sm font-medium text-zinc-200">
                  {q.used}<span className="text-xs text-faint"> / {q.total}</span>
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${q.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[11px] text-faint">
          用量来自真实 Token 记账（写作对话/蒸馏/拆解/抽卡）
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-faint">
        会员开通与支付服务接入中，当前为界面示意
      </p>
    </main>
  );
}
