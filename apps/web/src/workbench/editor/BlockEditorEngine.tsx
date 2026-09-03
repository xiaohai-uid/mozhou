import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { EditorQualityTelemetry } from './EditorQualityTelemetry';

export interface BlockEditorEngineProps {
  value: string;
  onChange: (val: string) => void;
  onSlashAction?: (command: string) => void;
  className?: string;
}

export const BlockEditorEngine: React.FC<BlockEditorEngineProps> = ({
  value,
  onChange,
  onSlashAction,
  className = '',
}) => {
  const [slashMenuPos, setSlashMenuPos] = useState<{ top: number; left: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '/') {
      const textarea = textareaRef.current;
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        setSlashMenuPos({
          top: rect.top + 40,
          left: rect.left + 40,
        });
      }
    } else if (e.key === 'Escape') {
      setSlashMenuPos(null);
    } else if (e.key === 'Enter') {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentText = textarea.value;

      e.preventDefault();
      const indent = '\n　　';
      const updated = currentText.substring(0, start) + indent + currentText.substring(end);
      onChange(updated);

      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + indent.length;
      });
    }
  };

  const handleSelectCommand = (command: string) => {
    setSlashMenuPos(null);
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (command === 'scene') {
      const marker = '\n\n【场景切分 · POV视点】\n　　';
      onChange(value + marker);
    } else if (command === 'beat') {
      const beat = '\n\n【核心节拍：冲突升级】\n　　';
      onChange(value + beat);
    } else if (command === 'character') {
      const charRef = '@[主角 / 林守常] ';
      onChange(value + charRef);
    }

    if (onSlashAction) {
      onSlashAction(command);
    }
  };

  return (
    <div className={`relative flex flex-col h-full bg-zinc-950/70 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl ${className}`}>
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-zinc-900/60 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
            TipTap AST 块级写作引擎
          </span>
          <span className="text-[10px] text-zinc-400 bg-zinc-800/70 px-2 py-0.5 rounded-full border border-zinc-700/50">
            支持 / 斜杠指令
          </span>
        </div>
      </div>

      {/* Editor Main Canvas */}
      <div className="relative flex-1 p-6 overflow-y-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在此输入正文，随时输入 / 呼出创作指令..."
          className="w-full h-full min-h-[420px] resize-none bg-transparent outline-none text-zinc-100 font-serif text-lg leading-relaxed placeholder-zinc-600 selection:bg-indigo-500/30 selection:text-indigo-200"
          style={{
            letterSpacing: '0.025em',
            lineHeight: '1.9',
          }}
        />
      </div>

      {/* Slash Command Overlay Menu */}
      {slashMenuPos && (
        <SlashCommandMenu
          position={slashMenuPos}
          onSelectCommand={handleSelectCommand}
          onClose={() => setSlashMenuPos(null)}
        />
      )}

      {/* Gutter Telemetry Bar */}
      <div className="p-3 bg-zinc-950/90 border-t border-zinc-800/60">
        <EditorQualityTelemetry content={value} />
      </div>
    </div>
  );
};
