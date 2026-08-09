"use client";

// 网文扫榜（UI）：扫榜开关 + 多榜浏览（对齐 OpenWrite 逆向的 8 案例）。
import { useState } from "react";
import { ToggleLeft, ToggleRight, Trophy } from "@phosphor-icons/react/dist/ssr";

const boards = [
  { name: "畅销榜 Top10", site: "番茄小说" },
  { name: "月票榜", site: "起点中文网" },
  { name: "新书榜", site: "番茄小说" },
  { name: "完结榜", site: "起点中文网" },
];

const demoRows = [
  { rank: 1, name: "宿命之环", heat: "9.8 万人在读" },
  { rank: 2, name: "道诡异仙", heat: "8.7 万人在读" },
  { rank: 3, name: "深海余烬", heat: "7.9 万人在读" },
  { rank: 4, name: "玄鉴仙族", heat: "6.4 万人在读" },
  { rank: 5, name: "夜的命名术", heat: "5.8 万人在读" },
];

export function RankingsView() {
  const [enabled, setEnabled] = useState(false);
  const [board, setBoard] = useState(boards[0].name);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Trophy size={22} weight="duotone" className="text-accent" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">网文扫榜</h1>
          </div>
          <p className="mt-2 text-sm text-muted">跟踪热门作品与市场风向，扫榜结果可写入参考库</p>
        </div>
        <button
          onClick={() => setEnabled((v) => !v)}
          aria-label={enabled ? "关闭扫榜" : "开启扫榜"}
          className={enabled ? "text-accent" : "text-faint"}
        >
          {enabled ? <ToggleRight size={32} weight="fill" /> : <ToggleLeft size={32} weight="fill" />}
        </button>
      </div>

      {enabled && (
        <>
          {/* 榜源切换 */}
          <div className="mt-8 flex flex-wrap gap-2">
            {boards.map((b) => (
              <button
                key={b.name}
                onClick={() => setBoard(b.name)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  board === b.name
                    ? "bg-accent text-white"
                    : "border border-surface-2 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {b.name}
                <span className={`ml-1.5 text-[10px] ${board === b.name ? "text-white/70" : "text-faint"}`}>
                  {b.site}
                </span>
              </button>
            ))}
          </div>

          {/* 榜单 */}
          <div className="mt-6 rounded-card border border-surface-2 bg-surface/50">
            <div className="border-b border-surface-2 px-6 py-3.5">
              <h2 className="text-sm font-semibold text-zinc-200">{board}</h2>
            </div>
            <ul className="divide-y divide-surface-2">
              {demoRows.map((r) => (
                <li key={r.rank} className="flex items-center gap-4 px-6 py-3.5">
                  <span
                    className={`w-6 text-center font-mono text-sm ${
                      r.rank <= 3 ? "font-semibold text-accent" : "text-faint"
                    }`}
                  >
                    {String(r.rank).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm text-zinc-200">{r.name}</span>
                  <span className="text-xs text-faint">{r.heat}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-center text-xs text-faint">
            榜单数据源接入中，当前为界面示意
          </p>
        </>
      )}

      {!enabled && (
        <div className="mt-10 rounded-card border border-dashed border-surface-2 px-8 py-16 text-center">
          <Trophy size={26} weight="duotone" className="mx-auto text-zinc-500" aria-hidden />
          <p className="mt-4 text-sm text-muted">打开扫榜开关，开始跟踪热门作品</p>
        </div>
      )}
    </main>
  );
}
