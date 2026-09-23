import React, { useState } from 'react';

export interface FloatingBubbleMenuProps {
  selectedText: string;
  position: { top: number; left: number } | null;
  onAction: (action: string, customInstruction?: string) => void;
  onClose: () => void;
  loading?: boolean;
}

const PRESETS = [
  { id: 'sensory_expansion', label: '描写强化', desc: '增强五感细节' },
  { id: 'deslop_sharpen', label: '情绪提纯', desc: '去空洞修辞' },
  { id: 'dialogue_polish', label: '对白调优', desc: '强化角色声线' },
  { id: 'plot_twist', label: '剧情反转', desc: '构思冲突变数' },
] as const;

/** 选区悬浮 Bubble（Ink Realm · Jade AI 语义 · 无 emoji）。 */
export const FloatingBubbleMenu: React.FC<FloatingBubbleMenuProps> = ({
  position,
  onAction,
  loading = false,
}) => {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  if (position === null) return null;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    onAction('custom', customPrompt.trim());
    setCustomPrompt('');
    setShowCustomInput(false);
  };

  return (
    <div
      className="mat-ink-glass"
      style={{
        position: 'fixed',
        zIndex: 50,
        transform: 'translate(-50%, -100%)',
        marginBottom: 10,
        padding: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 280,
        top: `${Math.max(52, position.top - 10)}px`,
        left: `${Math.min(window.innerWidth - 160, Math.max(160, position.left))}px`,
        boxShadow: '0 14px 34px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={loading}
            onClick={() => onAction(preset.id)}
            title={preset.desc}
            className="ir-menu-item"
            style={{
              width: 'auto',
              gap: 4,
              padding: '6px 9px',
              font: '500 11.5px/1 var(--sans)',
              opacity: loading ? 0.5 : 1,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustomInput(!showCustomInput)}
          title="自定义指令"
          className="ir-menu-item"
          style={{ width: 'auto', padding: '6px 8px', color: 'var(--text-faint)' }}
        >
          …
        </button>
      </div>

      {showCustomInput && (
        <form
          onSubmit={handleCustomSubmit}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, paddingTop: 6, borderTop: '1px solid var(--hairline)' }}
        >
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="针对选中文字的修改要求..."
            className="input"
            style={{ padding: '5px 9px', fontSize: 12 }}
            autoFocus
          />
          <button type="submit" disabled={loading || !customPrompt.trim()} className="btn-ai btn" style={{ padding: '5px 10px', fontSize: 12 }}>
            执行
          </button>
        </form>
      )}

      {loading && (
        <div className="kicker" style={{ textAlign: 'center', color: 'var(--jade)', padding: '2px 0' }}>
          正在调优选区文字…
        </div>
      )}
    </div>
  );
};
