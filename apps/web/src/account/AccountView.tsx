/**
 * 账号与设备管理中心 (AccountView · T08)。
 * - 账号登录 / 注册 / 密码找回 / 退出；
 * - Windows 与 Web 绑定设备管理（最多 3 台）；
 * - 明确边界：单机离线基本创作不需登录，首次登录不读取/上传本机作品，注销不误删本机作品。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'

interface UserProfile {
  readonly id: string
  readonly email: string
  readonly role?: string
  readonly plan?: string
}

interface BoundDeviceItem {
  readonly deviceId: string
  readonly name: string
  readonly boundAt: string
  readonly lastSeenAt: string
}

interface AccountSessionResponse {
  readonly ok: boolean
  readonly user?: UserProfile
  readonly devices?: readonly BoundDeviceItem[]
  readonly error?: string
}

export function AccountView(): JSX.Element {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [devices, setDevices] = useState<readonly BoundDeviceItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 表单状态
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset-confirm'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const loadAccount = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account')
      if (res.ok) {
        const data = (await res.json()) as AccountSessionResponse
        if (data.ok && data.user) {
          setProfile(data.user)
          setDevices(data.devices ?? [])
        } else {
          setProfile(null)
        }
      } else {
        setProfile(null)
      }
    } catch (cause) {
      setError((cause as Error).message)
      setProfile(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void loadAccount()
  }, [loadAccount])

  const handleLogin = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await post<{ ok: boolean; user: UserProfile; error?: string }>('/api/account/login', {
        email,
        password,
      })
      if (res.ok && res.user) {
        setMessage('登录成功')
        await loadAccount()
      } else {
        setError(res.error || '登录失败')
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await post<{ ok: boolean; user: UserProfile; error?: string }>('/api/account/register', {
        email,
        password,
      })
      if (res.ok && res.user) {
        setMessage('注册成功，请使用新账号登录')
        setMode('login')
      } else {
        setError(res.error || '注册失败')
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleRequestReset = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await post<{ ok: boolean; message: string; testResetCode?: string }>(
        '/api/account/reset-password-request',
        { email },
      )
      if (res.ok) {
        setMessage(res.message)
        if (res.testResetCode) {
          setResetCode(res.testResetCode)
        }
        setMode('reset-confirm')
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmReset = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await post<{ ok: boolean; message: string }>('/api/account/reset-password-confirm', {
        code: resetCode,
        newPassword,
      })
      if (res.ok) {
        setMessage('密码重置成功，请使用新密码登录')
        setMode('login')
        setPassword('')
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await post('/api/account/logout', {})
      setProfile(null)
      setDevices([])
      setMessage('已退出登录')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleUnbindDevice = async (deviceId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await post('/api/account/devices/unbind', { deviceId })
      setMessage('设备解绑成功')
      await loadAccount()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteAccount = async (): Promise<void> => {
    if (!window.confirm('确定要注销当前账号吗？注销将删除云端账号与设备关联。本机磁盘上的小说作品不会被删除。')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await post<{ ok: boolean; notice: string }>('/api/account/delete', {})
      if (res.ok) {
        setProfile(null)
        setDevices([])
        setMessage(res.notice)
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-view" aria-label="account-view" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <div className="chapterbar" style={{ marginBottom: 20 }}>
        <h1>账号与设备</h1>
        <span className="meta">墨舟 Novel OS · 身份与多端授权</span>
      </div>

      {busy && <p className="mono muted">处理中…</p>}
      {error && <p className="wb-error" role="alert" style={{ color: 'var(--error, #e5484d)', marginBottom: 12 }}>错误：{error}</p>}
      {message && <p className="wb-success" role="status" style={{ color: 'var(--success, #30a46c)', marginBottom: 12 }}>{message}</p>}

      {profile !== null ? (
        <div className="conversation" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 当前用户状态 */}
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>当前登录身份</b>
                <span className="cap-badge native">已验证</span>
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }} className="mono">
                <div>用户 ID：<span className="muted">{profile.id}</span></div>
                <div>电子邮箱：<span className="muted">{profile.email}</span></div>
                <div>当前方案：<span className="muted">{profile.plan || '社区版'}</span></div>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button type="button" className="btn secondary" onClick={() => { void handleLogout() }} disabled={busy}>
                  退出登录
                </button>
              </div>
            </div>
          </div>

          {/* 绑定设备列表 */}
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>授权设备 ({devices.length} / 3)</b>
                <span className="tag">最多 3 台有效绑定</span>
              </div>
              <p className="mono muted" style={{ margin: '8px 0 12px', fontSize: 12 }}>
                Windows 桌面端通过系统浏览器 PKCE 授权接入。解绑后原客户端刷新票据立即失效。离线基本创作无需登录。
              </p>

              {devices.length === 0 ? (
                <p className="mono muted" style={{ fontSize: 13 }}>暂无外部绑定设备</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {devices.map((d) => (
                    <div
                      key={d.deviceId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'var(--bg-subtle, rgba(0,0,0,0.03))',
                        borderRadius: 6,
                      }}
                    >
                      <div className="mono" style={{ fontSize: 13 }}>
                        <div><b>{d.name}</b></div>
                        <div className="muted" style={{ fontSize: 11 }}>绑定时间：{d.boundAt}</div>
                      </div>
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() => { void handleUnbindDevice(d.deviceId) }}
                        disabled={busy}
                      >
                        解绑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 隐私与安全边界说明 */}
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>本地作品安全声明</b>
              </div>
              <p className="mono muted" style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6 }}>
                墨舟严格保护创作者数据安全：登录仅同步账号权益与云端配额，绝不扫描、读取或向公网上传您的 Windows 本地小说目录。
              </p>
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => { void handleDeleteAccount() }}
                  disabled={busy}
                  style={{ color: '#e5484d', borderColor: '#e5484d' }}
                >
                  注销账号
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card-shell" style={{ maxWidth: 440, margin: '20px auto' }}>
          <div className="card">
            {mode === 'login' && (
              <form onSubmit={(e) => { e.preventDefault(); void handleLogin() }}>
                <div className="card-title" style={{ marginBottom: 16 }}>
                  <b>账号登录</b>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>电子邮箱</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>密码</label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 8 }}>
                    登录
                  </button>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12 }}>
                    <button type="button" className="btn link" onClick={() => { setMode('register'); setError(null) }}>
                      没有账号？立即注册
                    </button>
                    <button type="button" className="btn link" onClick={() => { setMode('forgot'); setError(null) }}>
                      忘记密码？
                    </button>
                  </div>
                </div>
              </form>
            )}

            {mode === 'register' && (
              <form onSubmit={(e) => { e.preventDefault(); void handleRegister() }}>
                <div className="card-title" style={{ marginBottom: 16 }}>
                  <b>注册墨舟账号</b>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>电子邮箱</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>密码（最少 6 位）</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 8 }}>
                    立即注册
                  </button>
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    <button type="button" className="btn link" onClick={() => { setMode('login'); setError(null) }}>
                      已有账号？返回登录
                    </button>
                  </div>
                </div>
              </form>
            )}

            {mode === 'forgot' && (
              <form onSubmit={(e) => { e.preventDefault(); void handleRequestReset() }}>
                <div className="card-title" style={{ marginBottom: 16 }}>
                  <b>找回密码</b>
                </div>
                <p className="mono muted" style={{ fontSize: 12, marginBottom: 12 }}>
                  请输入注册时使用的邮箱。重置码为一次性短期验证码。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>电子邮箱</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 8 }}>
                    发送重置指令
                  </button>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12 }}>
                    <button type="button" className="btn link" onClick={() => { setMode('login'); setError(null) }}>
                      返回登录
                    </button>
                    <button type="button" className="btn link" onClick={() => { setMode('reset-confirm'); setError(null) }}>
                      已有重置码？直接设置新密码
                    </button>
                  </div>
                </div>
              </form>
            )}

            {mode === 'reset-confirm' && (
              <form onSubmit={(e) => { e.preventDefault(); void handleConfirmReset() }}>
                <div className="card-title" style={{ marginBottom: 16 }}>
                  <b>设置新密码</b>
                </div>
                <p className="mono muted" style={{ fontSize: 12, marginBottom: 12 }}>
                  重置码仅限一次有效使用，输入后立即消费。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>重置码</label>
                    <input
                      type="text"
                      required
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      placeholder="rst_..."
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label className="mono" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>新密码（最少 6 位）</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}
                    />
                  </div>
                  <button type="submit" className="btn primary" disabled={busy} style={{ marginTop: 8 }}>
                    确认修改密码
                  </button>
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    <button type="button" className="btn link" onClick={() => { setMode('login'); setError(null) }}>
                      返回登录
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
