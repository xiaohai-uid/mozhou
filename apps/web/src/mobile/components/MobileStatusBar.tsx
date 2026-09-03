export interface MobileStatusBarProps {
  authorName: string
  statusText: string
  onOpenAuth: () => void
}

export function MobileStatusBar({
  authorName,
  statusText,
  onOpenAuth,
}: MobileStatusBarProps): JSX.Element {
  const localTime = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <header className="mobile-status-bar">
      <span style={{ fontSize: 12, color: 'var(--fg-secondary-mobile)' }}>{localTime}</span>

      <button
        type="button"
        className="mobile-status-capsule"
        onClick={onOpenAuth}
        title="创作者状态与账户"
      >
        <span className="mobile-status-dot" />
        <span className="mobile-status-text">
          {authorName} · {statusText}
        </span>
      </button>

      <button
        type="button"
        className="mobile-user-btn"
        onClick={onOpenAuth}
        title="创作者账号与登录"
      >
        <span>{authorName.slice(0, 1)}</span>
      </button>
    </header>
  )
}
