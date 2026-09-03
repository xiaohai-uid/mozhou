/**
 * 会员与授权中心（MembershipView）视图（实现票 T55）。
 * Technical Preview 仅展示当前社区免费版与未来方案；购买/激活服务未上线时
 * 不渲染可操作的许可证激活入口，不宣称任何付费授权已生效。
 */
import { useCallback, useEffect, useState } from 'react'
import type { MembershipResponse } from '../../server/api'
import { post } from '../lib/post'

export function MembershipView(): JSX.Element {
  const [data, setData] = useState<MembershipResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <section className="center solo" aria-label="membership-view">
      <div className="chapterbar">
        <h1>版本与授权</h1>
        <span className="meta">Technical Preview · 社区免费版</span>
        <div className="save">
          <span className="cap-badge native">● 社区免费版</span>
        </div>
      </div>

      <div className="conversation">
        {busy && data === null && <p className="mono muted">正在读取版本状态…</p>}

        {error !== null && (
          <p className="wb-error" role="alert" data-testid="membership-error">
            错误：{error}
          </p>
        )}

        {data?.license && (
          <section className="wb-section" data-testid="membership-license-card">
            <h2>当前许可证状态</h2>
            <div className="card-shell">
              <div className="card">
                <div className="card-title">
                  <b>{data.license.planName}</b>
                  <span className="cap-badge native">{data.license.status}</span>
                </div>
                <div className="actions" style={{ marginTop: 6, gap: 12 }}>
                  <span className="mono muted">授权密钥：{data.license.licenseKey}</span>
                  <span className="mono muted">激活日期：{data.license.activatedAt}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {data && data.license === null && (
          <section className="wb-section" data-testid="membership-no-license">
            <h2>当前版本</h2>
            <div className="card-shell">
              <div className="card">
                <div className="card-title">
                  <b>社区免费版</b>
                  <span className="tag">Technical Preview</span>
                </div>
                <p className="mono muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
                  当前以社区免费版运行。正式购买与激活服务尚未上线，Pro 权益不对外宣称已解锁。
                </p>
              </div>
            </div>
          </section>
        )}

        {data?.plans && data.plans.length > 0 && (
          <section className="wb-section" data-testid="membership-plans-section">
            <h2>版本方案</h2>
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
                      <span className={plan.current ? 'cap-badge native' : 'tag'}>{plan.price}</span>
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

        <section className="wb-section" data-testid="membership-activate-section">
          <h2>购买与激活</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>尚未开放</b>
                <span className="tag">不会接受或保存许可证密钥</span>
              </div>
              <p className="mono muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
                Technical Preview 不提供支付、离线密钥校验或许可证激活。功能上线前，此处只显示状态，不制造激活成功结果。
              </p>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
