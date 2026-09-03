import React from 'react';

export interface InlineDiffViewerProps {
  originalText: string;
  proposedText: string;
  onAccept: () => void;
  onReject: () => void;
  actionLabel?: string;
}

export const InlineDiffViewer: React.FC<InlineDiffViewerProps> = ({
  originalText,
  proposedText,
  onAccept,
  onReject,
  actionLabel = 'AI 调优结果',
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl p-4 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs font-semibold text-zinc-200">{actionLabel} 对比</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700/80 rounded-lg transition-colors"
          >
            放弃 (Esc)
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-md transition-colors"
          >
            采纳替换 (Enter)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-serif">
        {/* Original */}
        <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-lg space-y-1">
          <div className="text-[11px] font-sans font-medium text-red-400">原始片段</div>
          <div className="text-red-200/90 leading-relaxed whitespace-pre-wrap line-through opacity-80">
            {originalText}
          </div>
        </div>

        {/* Proposed */}
        <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded-lg space-y-1">
          <div className="text-[11px] font-sans font-medium text-emerald-400">采纳后重构</div>
          <div className="text-emerald-200 leading-relaxed whitespace-pre-wrap">
            {proposedText}
          </div>
        </div>
      </div>
    </div>
  );
};
