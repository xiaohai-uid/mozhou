import React, { useState } from 'react';
import { GENRE_PRESETS, GenreKit } from './genrePresets';

export const GenreKitMarketplaceView: React.FC = () => {
  const [selectedKit, setSelectedKit] = useState<GenreKit>(GENRE_PRESETS[0]!);
  const [applied, setApplied] = useState<string | null>(null);

  const handleApply = (kit: GenreKit) => {
    setApplied(kit.id);
    setTimeout(() => {
      setApplied(null);
    }, 2000);
  };

  return (
    <div className="w-full h-full min-h-[600px] bg-zinc-950/80 border border-zinc-800 rounded-2xl p-6 shadow-2xl flex flex-col space-y-6">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <h2 className="text-base font-semibold text-zinc-100">网文流派资产市场 (Genre Kits)</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            开箱即用的热门网文世界观底座、金手指规则卡、流派避雷词库与黄金三章节拍器
          </p>
        </div>
      </div>

      {/* Main Grid: Left List + Right Preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1">
        {/* Left Preset Cards */}
        <div className="space-y-3 overflow-y-auto max-h-[520px] pr-1">
          {GENRE_PRESETS.map((kit) => (
            <div
              key={kit.id}
              onClick={() => setSelectedKit(kit)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                selectedKit.id === kit.id
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-lg'
                  : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200">{kit.name}</span>
                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                  {kit.category}
                </span>
              </div>
              <div className="text-[11px] text-indigo-400 mt-1">{kit.tag}</div>
              <p className="text-[11px] text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                {kit.synopsis}
              </p>
            </div>
          ))}
        </div>

        {/* Right Detail Showcase */}
        <div className="col-span-2 bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{selectedKit.name}</h3>
                <span className="text-xs text-zinc-500">标签：{selectedKit.tag}</span>
              </div>
              <button
                type="button"
                onClick={() => handleApply(selectedKit)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all flex items-center gap-1.5"
              >
                <span>🚀</span>
                <span>{applied === selectedKit.id ? '已成功应用到当前书！' : '一键载入本项目'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl space-y-1">
                <span className="text-zinc-500 block">金手指预设</span>
                <span className="text-indigo-300 font-medium">{selectedKit.goldenFinger}</span>
              </div>
              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl space-y-1">
                <span className="text-zinc-500 block">核心天道规则</span>
                <span className="text-amber-300 font-medium">{selectedKit.coreRule}</span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <span className="text-zinc-400 font-semibold block uppercase tracking-wider">
                🚫 流派避雷禁区 (De-Cliche Redlines)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedKit.bannedTropes.map((trope, i) => (
                  <span
                    key={i}
                    className="bg-red-950/30 text-red-300 border border-red-900/50 px-2 py-1 rounded text-[11px]"
                  >
                    × {trope}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <span className="text-zinc-400 font-semibold block uppercase tracking-wider">
                🎯 黄金三章节拍器 (Opening Beats)
              </span>
              <div className="space-y-1.5">
                {selectedKit.openingBeats.map((beat, i) => (
                  <div key={i} className="p-2 bg-zinc-950/50 border border-zinc-800 rounded-lg text-zinc-300 flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-indigo-600/50 text-[10px] flex items-center justify-center text-white">
                      {i + 1}
                    </span>
                    <span>{beat}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
