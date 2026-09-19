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
          账号服务尚未接入（云端账号服务尚未接入）
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 当前工作在单机离线模式，作品全量存储在本地。不向云端上传作品，无需强制登录即可使用全部核心创作功能。
        </div>
      </div>

      <div
        className="mobile-card"
        style={{
          margin: 0,
          background: 'var(--surface-core-mobile)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          本地环境与授权信息
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
          • 当前模式：本地单机创作者模式（Local-First）
          <br />
          • 设备识别：本设备已获独立硬件指纹授权
          <br />
          • 数据安全：创作数据存储于本地 SQLite 与 Markdown 正典中
        </div>
      </div>

      <button type="button" className="mobile-action-btn" onClick={onOpenLicense}>
        查看版本与授权状态
      </button>
    </div>
  )
}
