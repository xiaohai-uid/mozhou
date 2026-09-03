/**
 * 会员与授权中心（MembershipView）视图（实现票 T55）：
 * 商业化形态与许可证状态看板。
 * 展示当前授权方案、权益矩阵对比与离线密钥激活面。
 *
 * 数据面（/api/membership 与 /api/membership.activate 中间件）：
 * - POST /api/membership {} → MembershipResponse
 * - POST /api/membership.activate {key} → MembershipResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { MembershipResponse } from '../../server/api'
import { post } from '../lib/post'

export function MembershipView(): JSX.Element {
  const [data, setData] = useState<MembershipResponse | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activateSuccess, setActivateSuccess] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await post<MembershipResponse>('/api/membership', {})
      setData(res)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleActivate = async (): Promise<void> => {
    const key = keyInput.trim()
    if (key.length === 0 || activating) return
    setActivating(true)
    setError(null)
    setActivateSuccess(false)
    try {
      const res = await post<MembershipResponse>('/api/membership.activate', { key })
      setData(res)
      setActivateSuccess(true)
      setKeyInput('')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setActivating(false)
    }
  }

  return (
    <section className="center solo" aria-label="membership-view">
      <div className="chapterbar">
        <h1>会员与授权中心</h1>
        <span className="meta">许可证管理 · 商业化权益方案</span>
        <div className="save">
          <span className="cap-badge native">● 终身买断已激活</span>
        </div>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="membership-error">
            错误：{error}
          </p>
        )}

        {activateSuccess && (
          <div className="banner" data-testid="membership-success">
            许可证密钥激活成功！当前已解锁全部 Pro 终身专业版权益。
          </div>
        )}

        {/* 当前许可证卡片 */}
        {data?.license && (
          <section className="wb-section" data-testid="membership-license-card">
            <h2>当前许可证状态</h2>
            <div className="card-shell">
              <div className="card">
                <div className="card-title">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b style={{ fontSize: 14 }}>{data.license.planName}</b>
                    <span className="cap-badge native">状态: 永久生效</span>
                  </div>
                  <span className="mono muted">有效期: {data.license.expiresAt}</span>
                </div>
                <div className="actions" style={{ marginTop: 6, gap: 12 }}>
                  <span className="mono muted">授权密钥：{data.license.licenseKey}</span>
                  <span className="mono muted">激活日期：{data.license.activatedAt}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 未激活付费许可证时的诚实提示 */}
        {data && data.license === null && (
          <section className="wb-section" data-testid="membership-no-license">
            <h2>当前许可证状态</h2>
            <div className="card-shell">
              <div className="card">
                <div className="card-title">
                  <b>社区免费版</b>
                  <span className="tag">未激活付费许可证</span>
                </div>
                <p className="mono muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
                  当前以社区免费版运行。正式购买与激活服务尚未上线，Pro 权益不对外宣称已解锁。
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 商业化方案矩阵 */}
        {data?.plans && data.plans.length > 0 && (
          <section className="wb-section" data-testid="membership-plans-section">
            <h2>版本方案与权益矩阵</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {data.plans.map((plan) => (
                <div
                  className="card-shell"
                  key={plan.id}
                  style={{
                    marginBottom: 0,
                    boxShadow: plan.current ? 'inset 0 0 0 1.5px var(--accent-strong)' : undefined,
                  }}
                >
                  <div className="card">
                    <div className="card-title">
                      <b>{plan.name}</b>
                      <span className={plan.current ? 'cap-badge native' : 'tag'}>
                        {plan.price}
                      </span>
                    </div>
                    {plan.tag && (
                      <p className="mono" style={{ margin: '0 0 8px', color: 'var(--accent-strong)', fontSize: 10 }}>
                        {plan.tag}
                      </p>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {plan.features.map((feat) => (
                        <div key={feat} className="mono muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--success)' }}>✓</span>
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 激活新密钥 */}
        <section className="wb-section" data-testid="membership-activate-section">
          <h2>激活许可证</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>输入许可证密钥（License Key）</b>
                <span className="mono muted">离线校验 · 即时解锁</span>
              </div>
              <div className="actions">
                <input
                  className="control"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="例如：MOZHOU-PRO-LIFETIME-XXXX-YYYY"
                  style={{ flex: 1, minWidth: 220 }}
                  aria-label="许可证密钥输入"
                />
                <button
                  className="btn-primary"
                  onClick={() => { void handleActivate() }}
                  disabled={activating || keyInput.trim().length === 0}
                >
                  {activating ? '激活中…' : '激活授权'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
