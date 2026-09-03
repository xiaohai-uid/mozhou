import React, { useRef, useCallback, useEffect } from 'react';
import { useEditorSelection } from './useEditorSelection';
import { EditorQualityTelemetry } from './EditorQualityTelemetry';

export interface NovelEditorCanvasProps {
  value: string;
  onChange: (newValue: string) => void;
  onSelectionAction?: (action: string, selectedText: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

export const NovelEditorCanvas: React.FC<NovelEditorCanvasProps> = ({
  value,
  onChange,
  onSelectionAction,
  placeholder = '在此开始构思正文...',
  readOnly = false,
  className = '',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { selection, clearSelection } = useEditorSelection(textareaRef);

  // Auto-indent paragraphs with standard Chinese 2 em spaces upon pressing Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentText = textarea.value;

        // Custom handling for new paragraph indentation
        e.preventDefault();
        const indent = '\n　　';
        const updated = currentText.substring(0, start) + indent + currentText.substring(end);
        onChange(updated);

        // Restore cursor position after the indent
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + indent.length;
        });
      }
    },
    [onChange]
  );

  // Normalize full text: automatically add 2-em spaces to unindented paragraphs
  const handleFormatTypography = useCallback(() => {
    const paragraphs = value.split('\n');
    const formatted = paragraphs
      .map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        // If it starts with quote, keep clean or indent
        if (trimmed.startsWith('“') || trimmed.startsWith('「')) {
          return '　　' + trimmed;
        }
        return trimmed.startsWith('　　') ? trimmed : '　　' + trimmed;
      })
      .join('\n');
    onChange(formatted);
  }, [value, onChange]);

  return (
    <div className={`relative flex flex-col h-full bg-zinc-950/60 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl backdrop-blur-md ${className}`}>
      {/* Top Format Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/50 border-b border-zinc-800/80">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300 tracking-wide uppercase">网文沉浸画卷</span>
          <span className="text-[10px] text-zinc-500 bg-zinc-800/70 px-1.5 py-0.5 rounded">标准排版</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFormatTypography}
            className="text-xs px-2.5 py-1 text-zinc-300 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-700/80 rounded border border-zinc-700/60 transition-colors"
            title="一键首行缩进两字符与段落归整"
          >
            一键网文排版
          </button>
        </div>
      </div>

      {/* Text Area */}
      <div className="relative flex-1 p-6 overflow-y-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          readOnly={readOnly}
          className="w-full h-full min-h-[400px] resize-none bg-transparent outline-none text-zinc-100 font-serif text-lg leading-relaxed placeholder-zinc-600 selection:bg-indigo-500/30 selection:text-indigo-200"
          style={{
            letterSpacing: '0.02em',
            lineHeight: '1.85',
          }}
        />
      </div>

      {/* Bottom Quality Telemetry Banner */}
      <div className="p-3 bg-zinc-950/90 border-t border-zinc-800/60">
        <EditorQualityTelemetry content={value} />
      </div>
    </div>
  );
};
