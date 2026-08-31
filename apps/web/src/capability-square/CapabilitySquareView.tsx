/**
 * 技能广场（能力注册表）视图（实现票 T46）：中栏直读 /api/capability-square
 * 的 V1 能力注册表——17 项航道逐条声明真实状态（原生可用 / 需要模型服务 /
 * 需要配置 / 需要外部数据源）与证据，缺前提的航道保持显式占位，不假装可用
 * （DESIGN.md §4.3）。providerAvailable 翻转时写作对话补充「已接入」标记。
 */
import { useEffect, useState } from 'react'
import type { CapabilitySquareResponse, CapabilityStatus } from '../../server/api'
import { post } from '../lib/post'

const STATUS_LABELS: Record<CapabilityStatus, string> = {
  native: '原生可用',
  provider_required: '需要模型服务',
  configuration_required: '需要配置',
  external_source_required: '需要外部数据源',
}

export function CapabilitySquareView(): JSX.Element {
  const [data, setData] = useState<CapabilitySquareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setBusy(true)
      setError(null)
      try {
        const payload = await post<CapabilitySquareResponse>('/api/capability-square', {})
        if (!cancelled) setData(payload)
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message)
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <section className="center solo" aria-label="capability-square-view">
      <div className="chapterbar">
        <h1>技能广场</h1>
        <span className="meta">V1 能力注册表 · {data?.groups.reduce((n, g) => n + g.entries.length, 0) ?? '—'} 项</span>
      </div>

      <div className="conversation">
        {busy && (
          <p className="muted" style={{ margin: 0 }} data-testid="capability-square-busy">
            读取能力注册表…
          </p>
        )}
        {!busy && error !== null && (
          <p className="wb-error" role="alert" data-testid="capability-square-error">
            错误：{error}
          </p>
        )}
        {data !== null && (
          <>
            {data.providerAvailable && (
              <p className="banner" data-testid="capability-square-provider">
                草稿生成 provider 已配置——写作对话可流式出稿（Gate 3 已开）。
              </p>
            )}
            {data.groups.map((group) => (
              <section className="wb-section" key={group.group} data-testid="capability-square-group">
                <h2>{group.group}</h2>
                {group.entries.map((entry) => (
                  <div className="card-shell" key={entry.id}>
                    <div className="card">
                      <div className="card-title">
                        <b>{entry.label}</b>
                        <span
                          className={
                            'cap-badge' + (entry.status === 'native' ? ' native' : ' pending')
                          }
                          data-testid="capability-square-badge"
                        >
                          {STATUS_LABELS[entry.status]}
                        </span>
                      </div>
                      <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.8 }}>
                        {entry.description}
                      </p>
                      <p className="mono muted" style={{ margin: '6px 0 0' }}>
                        {entry.id} · {entry.evidence}
                      </p>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </section>
  )
}
