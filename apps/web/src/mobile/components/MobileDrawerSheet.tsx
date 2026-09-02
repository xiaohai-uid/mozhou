import React from 'react'

export interface MobileDrawerSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}

export function MobileDrawerSheet({
  open,
  title,
  onClose,
  children,
}: MobileDrawerSheetProps): JSX.Element {
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
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true">
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
