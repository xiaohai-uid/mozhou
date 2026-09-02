export interface MobileStatusBarProps {
  authorName?: string
  statusText?: string
  onOpenAuth: () => void
}

export function MobileStatusBar({
  authorName = '道玄先生',
  statusText = '已就绪',
  onOpenAuth,
}: MobileStatusBarProps): JSX.Element {
  return (
    <header className="mobile-status-bar">
      <span style={{ fontSize: 12, color: 'var(--fg-secondary-mobile)' }}>09:41</span>

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
