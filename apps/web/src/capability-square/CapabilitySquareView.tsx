/**
 * 技能广场（能力注册表）视图（实现票 T46 · Ink Realm 卡牌生态重写，ADR-0028）：
 * 17 项航道按组成墙——四态徽标（原生/需模型/需配置/需外部源）+ 证据行；
 * 点击任意卡成为 Hero 并展开右侧 detail Sheet：启用前提 / 真实不可用原因 /
 * 动作契约 / 视图落点。缺前提的航道保持显式占位，不假装可用（DESIGN.md §4.3）；
 * future enable/apply 只有真实 action contract 存在时才出现——当前 17 项均无，
 * 因此 Sheet 不提供任何假按钮。无 Level/稀有度/战力等无数据数值。
 */
import { useEffect, useState } from 'react'
import type { CapabilitySquareResponse, CapabilityStatus } from '../../server/api'
import { post } from '../lib/post'
import { useSheetA11y } from '../shell/useSheetA11y'
import { CAPABILITY_DETAILS, detailOf } from './capabilityDetails'
import type { CapabilityDetail } from './capabilityDetails'

const STATUS_LABELS: Record<CapabilityStatus, string> = {
  native: '原生可用',
  provider_required: '需要模型服务',
  configuration_required: '需要配置',
  external_source_required: '需要外部数据源',
}

const STATUS_CLASS: Record<CapabilityStatus, string> = {
  native: 'cap-badge native',
  provider_required: 'cap-badge pending st-provider',
  configuration_required: 'cap-badge pending st-config',
  external_source_required: 'cap-badge pending st-external',
}

export function CapabilitySquareView(): JSX.Element {
  const [data, setData] = useState<CapabilitySquareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const closeSheet = (): void => setSelectedId(null)
  const { panelRef } = useSheetA11y(selectedId !== null, closeSheet)

  const total = data?.groups.reduce((n, g) => n + g.entries.length, 0) ?? 0
  const selectedGroup = data?.groups.find((group) => group.entries.some((entry) => entry.id === selectedId))
  const selected = selectedGroup?.entries.find((entry) => entry.id === selectedId) ?? null

  return (
    <section className="center solo" aria-label="capability-square-view">
      <div className="chapterbar">
        <h1>技能广场</h1>
        <span className="meta">V1 能力注册表 · {data !== null ? total : '—'} 项</span>
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
                <h2>{group.group} · {group.entries.length} 项</h2>
                <div className="cap-wall">
                  {group.entries.map((entry) => {
                    const detail = detailOf(entry.id, entry.status)
                    const isSelected = entry.id === selectedId
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={'card-capability cap' + (isSelected ? ' selected' : '')}
                        aria-pressed={isSelected}
                        data-testid="capability-square-card"
                        data-capability-id={entry.id}
                        onClick={() => setSelectedId(isSelected ? null : entry.id)}
                      >
                        <span className="cap-statusbar">
                          <span className={STATUS_CLASS[entry.status]} data-testid="capability-square-badge">
                            {STATUS_LABELS[entry.status]}
                          </span>
                          <span className="cap-status-code">{entry.status}</span>
                        </span>
                        <b className="cap-label">{entry.label}</b>
                        <span className="cap-desc">{entry.description}</span>
                        <span className="cap-evidence">{entry.id} · {entry.evidence}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {selected !== null && (
        <aside
          ref={panelRef}
          className="capability-sheet mat-scene-glass"
          role="dialog"
          aria-label={`能力详情：${selected.label}`}
          data-testid="capability-square-sheet"
        >
          <div className="scene-sheet-head">
            <div>
              <div className="kicker">CAPABILITY DETAIL{selectedGroup !== undefined ? ` · ${selectedGroup.group}` : ''}</div>
              <b style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>{selected.label}</b>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <span className={STATUS_CLASS[selected.status]}>{STATUS_LABELS[selected.status]}</span>
                <span className="cap-badge pending">{selected.status}</span>
              </div>
            </div>
            <button type="button" className="quiet-btn" onClick={closeSheet} data-autofocus>
              收起 ✕
            </button>
          </div>
          <div className="scene-sheet-body">
            <div className="cap-kv">
              <div className="kicker">DESCRIPTION · 描述</div>
              <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{selected.description}</p>
            </div>
            <div className="cap-kv">
              <div className="kicker">EVIDENCE · 注册表证据（真实字段）</div>
              <p className="mono" style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
                {selected.id} · {selected.evidence}
              </p>
            </div>
            {(() => {
              const detail = detailOf(selected.id, selected.status)
              return (
                <>
                  <div className="cap-kv">
                    <div className="kicker">REQUIREMENT · 启用前提</div>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--text-muted)' }}>
                      {detail.requirement.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  {detail.unavailable !== undefined && (
                    <div className="cap-kv">
                      <div className="kicker">UNAVAILABLE · 当前不可用原因（真实服务端语义）</div>
                      <div className="ir-unavailable" style={{ marginTop: 6 }}>
                        {detail.unavailable.map((reason) => (
                          <p key={reason} style={{ margin: '0 0 6px' }}>{reason}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="cap-kv">
                    <div className="kicker">ACTION CONTRACT · 动作契约</div>
                    <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{detail.contract}</p>
                  </div>
                  <div className="cap-kv">
                    <div className="kicker">VIEW LANDING · 视图落点</div>
                    <p className="mono" style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{detail.landing}</p>
                  </div>
                </>
              )
            })()}
            <hr style={{ border: 'none', borderTop: '1px solid var(--hairline)', margin: '14px 0' }} />
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.8, margin: 0 }}>
              future enable/apply 只有真实 action contract 存在时才出现——当前 17 项均无，因此本 Sheet 不提供任何假按钮。
            </p>
          </div>
        </aside>
      )}
    </section>
  )
}
