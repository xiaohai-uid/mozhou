import React, { useEffect, useRef } from 'react'

export interface MobileDrawerSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}

const FOCUSABLE =
  'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])'

/**
 * 移动端底部抽屉（Ink Realm 中断性修订，P2）：
 * Escape 关闭 · 打开时焦点入面板（关闭钮）· Tab 循环困在面板内 ·
 * 关闭后焦点返回触发元素。装饰性 handle 保留视觉语义。
 */
export function MobileDrawerSheet({
  open,
  title,
  onClose,
  children,
}: MobileDrawerSheetProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const closeBtn = panel?.querySelector<HTMLButtonElement>('.mobile-action-btn')
    closeBtn?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Tab' && panel !== null) {
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute('disabled'),
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === panel)) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus?.()
    }
  }, [open, onClose])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className={`mobile-sheet-backdrop ${open ? 'open' : ''}`}
      onClick={handleBackdropClick}
      aria-hidden={!open}
    >
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="mobile-sheet-handle" />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <h3
            style={{
              fontFamily: 'var(--font-prose-mobile)',
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--fg-pure-mobile)',
            }}
          >
            {title}
          </h3>
          <button
            className="mobile-action-btn"
            style={{ padding: '2px 10px', fontSize: 11 }}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="mobile-sheet-content">{children}</div>
      </div>
    </div>
  )
}
