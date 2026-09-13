import React, { useEffect } from 'react';

export interface SlashCommandMenuProps {
  position: { top: number; left: number } | null;
  onSelectCommand: (command: string) => void;
  onClose: () => void;
}

const COMMANDS = [
  { id: 'scene', code: 'SC', label: '场景切分 (Scene Break)', desc: '插入独立时空与POV视点标记' },
  { id: 'character', code: 'CC', label: '正典角色卡 (Character)', desc: '引用或创建世界观人物' },
  { id: 'beat', code: 'PB', label: '剧情节拍 (Plot Beat)', desc: '插入本章核心推进冲突' },
  { id: 'rewrite', code: 'AC', label: 'AI 自动续写 (Auto Complete)', desc: '需 draft provider（Gate 3）' },
  { id: 'deslop', code: 'DS', label: '即时去味 (De-Slop Polish)', desc: '需正文编辑契约（后续票）' },
] as const;

/** Slash 快捷指令菜单（Ink Realm · Jade 系 AI 语义 · CSS hover · Escape/外点关闭）。 */
export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ position, onSelectCommand, onClose }) => {
  useEffect(() => {
    if (position === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="menu"]') === null) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [position, onClose])

  if (position === null) return null;

  return (
    <div
      className="mat-ink-glass"
      role="menu"
      style={{
        position: 'fixed',
        zIndex: 50,
        width: 264,
        padding: 6,
        top: `${position.top}px`,
        left: `${Math.min(window.innerWidth - 280, position.left)}px`,
        boxShadow: '0 14px 34px rgba(0,0,0,.45)',
      }}
    >
      <div className="kicker" style={{ padding: '4px 8px', fontSize: 9.5 }}>
        SLASH COMMANDS · Esc 收起
      </div>
      {COMMANDS.map((cmd) => (
        <button
          key={cmd.id}
          type="button"
          role="menuitem"
          className="ir-menu-item"
          onClick={() => onSelectCommand(cmd.id)}
        >
          <span className="ir-menu-code">{cmd.code}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="ir-menu-label">{cmd.label}</span>
            <span className="ir-menu-desc">{cmd.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
};

