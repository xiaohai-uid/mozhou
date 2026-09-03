import React from 'react';

export interface SlashCommandMenuProps {
  position: { top: number; left: number } | null;
  onSelectCommand: (command: string) => void;
  onClose: () => void;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  position,
  onSelectCommand,
}) => {
  if (!position) return null;

  const commands = [
    { id: 'scene', label: '场景切分 (Scene Break)', icon: '🎬', desc: '插入独立时空与POV视点标记' },
    { id: 'character', label: '正典角色卡 (Character)', icon: '👤', desc: '引用或创建世界观人物' },
    { id: 'beat', label: '剧情节拍 (Plot Beat)', icon: '🎯', desc: '插入本章核心推进冲突' },
    { id: 'rewrite', label: 'AI 自动续写 (Auto Complete)', icon: '✨', desc: '根据前情与大纲流式生成' },
    { id: 'deslop', label: '即时去味 (De-Slop Polish)', icon: '🔥', desc: '净化段落空洞修辞' },
  ];

  return (
    <div
      className="fixed z-50 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 backdrop-blur-xl w-64 animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: `${position.top + 24}px`,
        left: `${Math.min(window.innerWidth - 270, position.left)}px`,
      }}
    >
      <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
        快捷创作指令 (Slash Commands)
      </div>
      <div className="space-y-0.5 mt-1">
        {commands.map((cmd) => (
          <button
            key={cmd.id}
            type="button"
            onClick={() => onSelectCommand(cmd.id)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-indigo-600/80 hover:text-white text-zinc-200 transition-colors group"
          >
            <span className="text-sm">{cmd.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{cmd.label}</div>
              <div className="text-[10px] text-zinc-400 group-hover:text-indigo-200 truncate">
                {cmd.desc}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
