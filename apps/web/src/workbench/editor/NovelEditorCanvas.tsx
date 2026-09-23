import React, { useCallback, useRef, useState } from 'react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { FloatingBubbleMenu } from './FloatingBubbleMenu';

export interface NovelEditorCanvasProps {
  value: string;
  onChange: (newValue: string) => void;
  /** 选区/Slash AI 动作回调。当前无正文编辑 AI 契约——实现方应呈现诚实不可用。 */
  onSelectionAction?: ((action: string, selectedText: string) => void) | undefined;
  /** 选区变化回调（from/to UTF-16 偏移与所选原文）。 */
  onSelectionChange?: ((selection: { from: number; to: number; selectedText: string } | null) => void) | undefined;
  placeholder?: string | undefined;
  readOnly?: boolean | undefined;
  className?: string | undefined;
}

/** 光标行偏移估算（用于 Slash 菜单就地弹出）。 */
function caretOffset(textarea: HTMLTextAreaElement): { top: number; left: number } {
  const upToCaret = textarea.value.slice(0, textarea.selectionStart);
  const lineIndex = upToCaret.split('\n').length - 1;
  const lineHeight = 33;
  return {
    top: textarea.offsetTop + Math.min(lineIndex, 12) * lineHeight - textarea.scrollTop + 34,
    left: textarea.offsetLeft + 32,
  };
}

/**
 * 网文沉浸画卷（Reading Slate · ADR-0028 写作层）：
 * 近实心 Slate、serif 17px / lh1.9、2em 段缩进、一键排版；
 * Slash（场景/角色/节拍就地插入；rewrite/deslop 需 provider——回调方诚实呈现）；
 * 选区 Bubble（AI 调优需正文编辑契约——回调方诚实呈现）。
 * 中文输入优先：无装饰性按键拦截。
 */
export const NovelEditorCanvas: React.FC<NovelEditorCanvasProps> = ({
  value,
  onChange,
  onSelectionAction,
  onSelectionChange,
  placeholder = '在此开始构思正文...',
  readOnly = false,
  className = '',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashPosition, setSlashPosition] = useState<{ top: number; left: number } | null>(null);
  const [bubblePosition, setBubblePosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        const textarea = textareaRef.current;
        if (textarea === null) return;
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
    },
    [onChange],
  );

  /** '/' 于行首 → 就地打开 Slash 菜单。 */
  const handleSlashTrace = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const upToCaret = textarea.value.slice(0, textarea.selectionStart);
    if (upToCaret.endsWith('/')) {
      const beforeSlash = upToCaret.slice(0, -1);
      if (beforeSlash.endsWith('\n') || beforeSlash === '') {
        setSlashPosition(caretOffset(textarea));
      }
    }
  }, []);

  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const from = textarea.selectionStart;
    const to = textarea.selectionEnd;
    const raw = textarea.value.slice(from, to);
    setSelectedText(raw.trim());
    if (from < to && raw.length > 0) {
      onSelectionChange?.({ from, to, selectedText: raw });
    } else {
      onSelectionChange?.(null);
    }
  }, [onSelectionChange]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const from = textarea.selectionStart;
    const to = textarea.selectionEnd;
    const raw = textarea.value.slice(from, to);
    const selected = raw.trim();
    if (selected.length > 0 && from < to) {
      setSelectedText(selected);
      setBubblePosition({ top: e.clientY, left: e.clientX });
      onSelectionChange?.({ from, to, selectedText: raw });
    } else {
      setBubblePosition(null);
      if (from === to) {
        onSelectionChange?.(null);
      }
    }
  }, [onSelectionChange]);

  const handleKeyUp = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const from = textarea.selectionStart;
    const to = textarea.selectionEnd;
    const raw = textarea.value.slice(from, to);
    if (from < to && raw.length > 0) {
      setSelectedText(raw.trim());
      onSelectionChange?.({ from, to, selectedText: raw });
    } else {
      setSelectedText('');
      onSelectionChange?.(null);
    }
  }, [onSelectionChange]);

  const handleFormatTypography = useCallback(() => {
    const paragraphs = value.split('\n');
    const formatted = paragraphs
      .map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('“') || trimmed.startsWith('「')) {
          return '　　' + trimmed;
        }
        return trimmed.startsWith('　　') ? trimmed : '　　' + trimmed;
      })
      .join('\n');
    onChange(formatted);
  }, [value, onChange]);

  const insertMarker = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      const at = textarea === null ? value.length : textarea.selectionStart;
      onChange(value.slice(0, at) + text + value.slice(at));
      setSlashPosition(null);
    },
    [value, onChange],
  );

  const handleSlashCommand = useCallback(
    (command: string) => {
      setSlashPosition(null);
      const textarea = textareaRef.current;
      if (textarea !== null) {
        const start = textarea.selectionStart;
        if (value.slice(0, start).endsWith('/')) {
          onChange(value.slice(0, start - 1) + value.slice(start));
        }
      }
      if (command === 'scene') insertMarker('\n【场景切分 · POV视点】\n');
      else if (command === 'character') insertMarker('【正典角色卡：】');
      else if (command === 'beat') insertMarker('\n【核心节拍：冲突升级】\n');
      else onSelectionAction?.(command, '');
    },
    [value, onChange, insertMarker, onSelectionAction],
  );

  const handleBubbleAction = useCallback(
    (action: string, customInstruction?: string) => {
      setBubblePosition(null);
      onSelectionAction?.(action + (customInstruction !== undefined ? ':' + customInstruction : ''), selectedText);
    },
    [onSelectionAction, selectedText],
  );

  return (
    <div
      className={`reading-slate ${className}`}
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      data-testid="novel-editor-canvas"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="kicker">READING SLATE · ACTIVE DRAFT</span>
          <span className="badge b-neutral" style={{ fontSize: 9 }}>标准排版</span>
        </div>
        <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={handleFormatTypography} title="一键首行缩进两字符与段落归整">
          一键网文排版
        </button>
      </div>

      <div style={{ position: 'relative', flex: 1, padding: '22px 28px', overflowY: 'auto' }}>
        <textarea
          ref={textareaRef}
          aria-label="章节正文编辑区"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            handleSlashTrace();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onSelect={handleSelect}
          onMouseUp={handleMouseUp}
          placeholder={placeholder}
          readOnly={readOnly}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 380,
            resize: 'none',
            display: 'block',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--foreground)',
            fontFamily: 'var(--serif)',
            fontSize: 17,
            lineHeight: 1.9,
            letterSpacing: '0.02em',
            caretColor: 'var(--jade)',
          }}
        />
      </div>

      <SlashCommandMenu position={slashPosition} onSelectCommand={handleSlashCommand} onClose={() => setSlashPosition(null)} />
      {selectedText.length > 0 && bubblePosition !== null && (
        <FloatingBubbleMenu
          selectedText={selectedText}
          position={bubblePosition}
          onAction={handleBubbleAction}
          onClose={() => setBubblePosition(null)}
        />
      )}
    </div>
  );
};
