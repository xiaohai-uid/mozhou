import { useState } from 'react'

export interface AuthLicenseDrawerProps {
  initialEmail?: string
  onLoginSuccess: (name: string, email: string) => void
  onOpenLicense: () => void
}

export function AuthLicenseDrawer({
  initialEmail = 'daoxuan@mozhou.ai',
  onLoginSuccess,
  onOpenLicense,
}: AuthLicenseDrawerProps): JSX.Element {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('••••••••••••')

  const handleLogin = () => {
    if (!email.trim()) return
    const authorName = email.includes('daoxuan') ? '道玄先生' : email.split('@')[0] ?? '创作者'
    onLoginSuccess(authorName, email)
    alert(`【登录成功】已连接创作者数据面，当前作品与凭证已归属至 ${email}！`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>创作者注册邮箱 / 账号</label>
        <input
          style={{
            width: '100%',
            background: 'var(--surface-core-mobile)',
            border: '1px solid var(--hairline-crisp-mobile)',
            borderRadius: 12,
            padding: '10px 14px',
            color: 'var(--fg-pure-mobile)',
            fontSize: 14,
            outline: 'none',
          }}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="请输入注册邮箱"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>登录密码</label>
        <input
          style={{
            width: '100%',
            background: 'var(--surface-core-mobile)',
            border: '1px solid var(--hairline-crisp-mobile)',
            borderRadius: 12,
            padding: '10px 14px',
            color: 'var(--fg-pure-mobile)',
            fontSize: 14,
            outline: 'none',
          }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
        />
      </div>

      <button
        type="button"
        className="mobile-action-btn"
        style={{
          width: '100%',
          justifyContent: 'center',
          padding: 10,
          background: 'var(--accent-mobile)',
          color: '#fff',
          border: 'none',
          marginTop: 6,
        }}
        onClick={handleLogin}
      >
        立即登录 / 切换
      </button>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'var(--fg-muted-mobile)',
          paddingTop: 4,
        }}
      >
        <button
          type="button"
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          onClick={() => alert('已通过本地数据面创建新创作者身份')}
        >
          注册新创作者
        </button>
        <button
          type="button"
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          onClick={onOpenLicense}
        >
          商业许可证激活 ›
        </button>
      </div>
    </div>
  )
}
