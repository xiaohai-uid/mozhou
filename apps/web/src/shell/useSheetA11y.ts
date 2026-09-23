/**
 * 桌面 Sheet 可访问性共享钩子（DESIGN.md §5.2 Sheet 契约 + 规格 §30）：
 * Escape 关闭 · 打开时焦点入面板（data-autofocus 元素优先，否则首个按钮）·
 * Tab 循环困拢 · 关闭后焦点返回触发元素。桌面三 Sheet（场景/工具/能力详情）共用。
 */
import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])'

export function useSheetA11y(
  open: boolean,
  onClose: () => void,
): { panelRef: React.RefObject<HTMLDivElement> } {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const initial =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE)
    initial?.focus()

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
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus?.()
    }
  }, [open, onClose])

  return { panelRef }
}
