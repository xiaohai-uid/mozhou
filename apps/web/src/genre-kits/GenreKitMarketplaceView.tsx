import React, { useState } from 'react';
import { GENRE_PRESETS, GenreKit } from './genrePresets';
import { post } from '../lib/post';
import type { BookInfo } from '../shell/workbenchStorage';

export const GenreKitMarketplaceView: React.FC<{
  book?: BookInfo | null | undefined;
}> = ({ book }) => {
  const [selectedKit, setSelectedKit] = useState<GenreKit>(GENRE_PRESETS[0]!);
  const [applied, setApplied] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedDetail, setAppliedDetail] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const categories = ['all', '男频爽文', '悬疑灵异', '都市异能', '女频古言'] as const;

  const filteredKits = GENRE_PRESETS.filter((k) =>
    activeCategory === 'all' ? true : k.category === activeCategory,
  );

  const handleApply = async (kit: GenreKit) => {
    setApplyError(null);
    setAppliedDetail(null);
    if (!book?.root) {
      setApplyError('当前未建立/未打开作品，请先建书后再载入流派设定。');
      setApplied(null);
      return;
    }
    try {
      const res = await post<{ ok: boolean; appliedCount?: number }>('/api/genre-kit.apply', {
        root: book.root,
        kitId: kit.id,
      });
      setApplied(kit.id);
      setAppliedDetail(`已成功注入 ${res.appliedCount ?? 0} 项流派设定与开篇大纲脚手架到《${book.title}》。`);
    } catch (e) {
      setApplyError((e as Error).message);
      setApplied(null);
    }
  };

  return (
    <div className="w-full h-full min-h-[600px] flex flex-col space-y-5 p-6 overflow-y-auto">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
            <h2 className="text-base font-semibold text-zinc-100 tracking-wide">
              网文流派资产市场 · Genre Kits
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-mono">
              8 大网文流派就绪
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            开箱即用的热门网文世界观底座、金手指规则卡、避雷红线词库与黄金三章节拍器
          </p>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-900/90 border border-white/[0.08] rounded-xl text-xs backdrop-blur-md">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-lg transition-all text-xs ${
                activeCategory === cat
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              {cat === 'all' ? '全部流派' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Main Bento Grid: Left List + Right Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Preset Cards (5 cols) */}
        <div className="lg:col-span-5 space-y-3 overflow-y-auto max-h-[640px] pr-1.5 scrollbar-thin">
          {filteredKits.map((kit) => {
            const isSelected = selectedKit.id === kit.id;
            return (
              <div
                key={kit.id}
                onClick={() => setSelectedKit(kit)}
                className={`p-4 rounded-2xl border cursor-pointer transition-all duration-200 relative overflow-hidden group ${
                  isSelected
                    ? 'bg-zinc-900/90 border-indigo-500/80 shadow-[0_8px_24px_-4px_rgba(99,102,241,0.25)] ring-1 ring-indigo-500/30'
                    : 'bg-zinc-900/40 border-white/[0.06] hover:border-white/[0.14] hover:bg-zinc-900/60'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-emerald-400" />
                )}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-zinc-100 group-hover:text-white transition-colors">
                    {kit.name}
                  </span>
                  <span className="text-[10px] bg-white/[0.06] text-zinc-400 border border-white/[0.06] px-2 py-0.5 rounded-full font-sans">
                    {kit.category}
                  </span>
                </div>
                <div className="text-[11px] text-indigo-400 font-medium mb-1.5 flex items-center gap-1">
                  <span>✦</span>
                  <span>{kit.tag}</span>
                </div>
                <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                  {kit.synopsis}
                </p>
              </div>
            );
          })}
        </div>

        {/* Right Detail Showcase (7 cols) */}
        <div className="lg:col-span-7 bg-zinc-900/70 border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between backdrop-blur-xl shadow-2xl space-y-5">
          <div className="space-y-5">
            {/* Top Showcase Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-zinc-100">{selectedKit.name}</h3>
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                    {selectedKit.category}
                  </span>
                </div>
                <span className="text-xs text-zinc-400 mt-1 block">
                  核心标签：{selectedKit.tag}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleApply(selectedKit)}
                className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 shrink-0 active:scale-[0.98]"
              >
                <span>🚀</span>
                <span>{applied === selectedKit.id ? '已成功应用到当前书！' : '一键载入本项目'}</span>
              </button>
            </div>

            {/* Core Golden Finger & Rules Bento */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div className="p-4 bg-zinc-950/70 border border-white/[0.06] rounded-xl space-y-1.5 shadow-inner">
                <span className="text-zinc-500 font-medium block flex items-center gap-1.5">
                  <span className="text-indigo-400">⚡</span> 核心金手指预设
                </span>
                <span className="text-indigo-200 font-medium leading-relaxed block">
                  {selectedKit.goldenFinger}
                </span>
              </div>
              <div className="p-4 bg-zinc-950/70 border border-white/[0.06] rounded-xl space-y-1.5 shadow-inner">
                <span className="text-zinc-500 font-medium block flex items-center gap-1.5">
                  <span className="text-amber-400">📜</span> 核心天道运行规则
                </span>
                <span className="text-amber-200 font-medium leading-relaxed block">
                  {selectedKit.coreRule}
                </span>
              </div>
            </div>

            {/* Banned Tropes Redlines */}
            <div className="space-y-2 text-xs">
              <span className="text-zinc-400 font-semibold block uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <span className="text-rose-400">🚫</span> 流派避雷禁区 (De-Cliche Redlines)
              </span>
              <div className="flex flex-wrap gap-2">
                {selectedKit.bannedTropes.map((trope, i) => (
                  <span
                    key={i}
                    className="bg-rose-950/30 text-rose-300 border border-rose-900/40 px-2.5 py-1 rounded-lg text-[11px] font-sans"
                  >
                    × {trope}
                  </span>
                ))}
              </div>
            </div>

            {/* Opening Beats Sequencer */}
            <div className="space-y-2 text-xs">
              <span className="text-zinc-400 font-semibold block uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <span className="text-teal-400">🎯</span> 黄金三章节拍器 (Opening Beats)
              </span>
              <div className="space-y-2">
                {selectedKit.openingBeats.map((beat, i) => (
                  <div
                    key={i}
                    className="p-3 bg-zinc-950/60 border border-white/[0.06] rounded-xl text-zinc-300 flex items-center gap-3 text-xs"
                  >
                    <span className="w-5 h-5 rounded-full bg-indigo-600/40 border border-indigo-500/50 text-[10px] flex items-center justify-center text-indigo-200 font-mono shrink-0">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{beat}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feedback Messages */}
          {applyError && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 p-3 rounded-xl flex items-center gap-2">
              <span>⚠</span>
              <span>{applyError}</span>
            </div>
          )}
          {appliedDetail && (
            <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 p-3 rounded-xl flex items-center gap-2">
              <span>✓</span>
              <span>{appliedDetail}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
