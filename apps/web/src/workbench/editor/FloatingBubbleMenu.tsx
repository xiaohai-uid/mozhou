import React, { useState } from 'react';

export interface FloatingBubbleMenuProps {
  selectedText: string;
  position: { top: number; left: number } | null;
  onAction: (action: string, customInstruction?: string) => void;
  onClose: () => void;
  loading?: boolean;
}

export const FloatingBubbleMenu: React.FC<FloatingBubbleMenuProps> = ({
  selectedText,
  position,
  onAction,
  onClose,
  loading = false,
}) => {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  if (!position) return null;

  const presets = [
    { id: 'sensory_expansion', label: '描写强化', icon: '✨', desc: '增强五感细节' },
    { id: 'deslop_sharpen', label: '情绪提纯', icon: '🔥', desc: '去废话与空洞修辞' },
    { id: 'dialogue_polish', label: '对白调优', icon: '💬', desc: '强化角色声线' },
    { id: 'plot_twist', label: '剧情反转', icon: '⚡', desc: '构思冲突变数' },
  ];

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    onAction('custom', customPrompt.trim());
    setCustomPrompt('');
    setShowCustomInput(false);
  };

  return (
    <div
      className="fixed z-50 transform -translate-x-1/2 -translate-y-full mb-3 bg-zinc-900/95 border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 backdrop-blur-md flex flex-col gap-1.5 min-w-[280px] animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: `${Math.max(10, position.top - 10)}px`,
        left: `${Math.min(window.innerWidth - 160, Math.max(160, position.left))}px`,
      }}
    >
      {/* Top Presets Row */}
      <div className="flex items-center gap-1">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={loading}
            onClick={() => onAction(p.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-200 hover:text-white bg-zinc-800/60 hover:bg-indigo-600/80 rounded-lg transition-all disabled:opacity-50"
            title={p.desc}
          >
            <span>{p.icon}</span>
            <span className="font-medium">{p.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustomInput(!showCustomInput)}
          className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/30 hover:bg-zinc-800 rounded-lg"
          title="自定义指令"
        >
          ⋯
        </button>
      </div>

      {/* Optional Custom Input Box */}
      {showCustomInput && (
        <form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5 mt-1 pt-1 border-t border-zinc-800">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="输入针对选中文字的修改要求..."
            className="flex-1 bg-zinc-950 border border-zinc-700/80 rounded-lg px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !customPrompt.trim()}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium disabled:opacity-50"
          >
            执行
          </button>
        </form>
      )}

      {loading && (
        <div className="text-[10px] text-indigo-400 text-center py-0.5 animate-pulse">
          正在调优选区文字...
        </div>
      )}
    </div>
  );
};
