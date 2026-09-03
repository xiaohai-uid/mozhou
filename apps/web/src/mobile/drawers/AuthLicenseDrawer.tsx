export interface AuthLicenseDrawerProps {
  initialEmail?: string
  onLoginSuccess: (name: string, email: string) => void
  onOpenLicense: () => void
}

export function AuthLicenseDrawer({ onOpenLicense }: AuthLicenseDrawerProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          账号服务尚未接入
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 当前仅使用本地作品数据，不提供注册、登录、账号切换或云端身份绑定。
        </div>
      </div>
      <button type="button" className="mobile-action-btn" onClick={onOpenLicense}>
        查看版本与授权状态
      </button>
    </div>
  )
}
