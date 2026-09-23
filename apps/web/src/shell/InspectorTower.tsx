/**
 * 右侧检视塔（实现票 T40 · Ink Realm 摘要轨，ADR-0028）：
 * 顶部只读 summary rail——每个数字必须有真实来源（shellTelemetry 推导），
 * 没有则显示 '—'；四 tab：质量门 / Story Brain / 装配看板 / 变更矩阵。
 */
import type { ReactNode } from 'react'
import type { InspectorSummary } from './shellTelemetry'

export type { InspectorSummary }

export const INSPECTOR_TABS = [
  { id: 'quality', label: '质量门' },
  { id: 'story-brain', label: 'Story Brain' },
  { id: 'context-receipt', label: '装配看板' },
  { id: 'change-matrix', label: '变更矩阵' },
] as const

export type InspectorTabId = (typeof INSPECTOR_TABS)[number]['id']

function SummaryCell({ label, value }: { label: string; value: string }): JSX.Element {
  const tone =
    value === '—'
      ? 'var(--text-faint)'
      : value === 'STALE'
        ? 'var(--warning)'
        : value === 'NEEDS REWORK' || value === 'MISMATCH' || value === 'REFUSED'
          ? 'var(--danger)'
          : value === 'PASS' || value === 'HASH MATCH' || value === 'CURRENT'
            ? 'var(--success)'
            : 'var(--foreground)'
  return (
    <div>
      <div className="kicker" style={{ fontSize: 9, letterSpacing: '0.14em' }}>{label}</div>
      <div
        className={value === '—' ? '' : 'mono'}
        style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3, color: tone, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {value}
      </div>
    </div>
  )
}

/** 未接入面板的显式占位卡（不假装可用）。 */
export function InspectorPlaceholder({
  title,
  ticket,
  note,
}: {
  title: string
  ticket: string
  note: string
}): JSX.Element {
  return (
    <div className="card-shell">
      <div className="card" data-testid="inspector-placeholder">
        <div className="card-title">
          <b>{title}</b>
          <span className="tag">{ticket}</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.7 }}>
          {note}
        </p>
        <p className="mono muted" style={{ margin: '8px 0 0' }}>
          未实现 · 显式占位
        </p>
      </div>
    </div>
  )
}

/** 建书前的质量门空态。 */
export function InspectorEmpty({ note }: { note: string }): JSX.Element {
  return (
    <div className="card-shell">
      <div className="card" data-testid="inspector-empty">
        <div className="card-title">
          <b>暂无可检视内容</b>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.7 }}>
          {note}
        </p>
      </div>
    </div>
  )
}

export function InspectorTower({
  activeTab,
  onTabChange,
  panels,
  summary,
}: {
  activeTab: InspectorTabId
  onTabChange: (tab: InspectorTabId) => void
  panels: Readonly<Record<InspectorTabId, ReactNode>>
  /** 摘要轨（shellTelemetry 推导）；undefined = 不渲染（如移动端）。 */
  summary?: InspectorSummary
}): JSX.Element {
  return (
    <aside className="inspector" aria-label="检视塔">
      {summary !== undefined && (
        <div
          className="sumrail"
          data-testid="inspector-summary"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1px',
            margin: '10px 10px 0',
            border: '1px solid var(--hairline)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--hairline)',
          }}
        >
          <div style={{ background: 'var(--surface-sunken)', padding: '8px 10px' }}>
            <SummaryCell label="CURRENT CHAPTER" value={summary.chapter} />
          </div>
          <div style={{ background: 'var(--surface-sunken)', padding: '8px 10px' }}>
            <SummaryCell label="QUALITY" value={summary.quality} />
          </div>
          <div style={{ background: 'var(--surface-sunken)', padding: '8px 10px' }}>
            <SummaryCell label="CANON" value={summary.canon} />
          </div>
          <div style={{ background: 'var(--surface-sunken)', padding: '8px 10px' }}>
            <SummaryCell label="CONTEXT" value={summary.context} />
          </div>
          <div style={{ background: 'var(--surface-sunken)', padding: '8px 10px' }}>
            <SummaryCell label="CHANGE IMPACT" value={summary.changeImpact} />
          </div>
          <div style={{ background: 'var(--surface-sunken)', padding: '8px 10px' }}>
            <SummaryCell label="TOKENS · RECEIPT" value={summary.tokens} />
          </div>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="检视面板">
        {INSPECTOR_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab}
            className={'tab' + (tab.id === activeTab ? ' active' : '')}
            data-tab={tab.id}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {INSPECTOR_TABS.map((tab) => (
        <section
          key={tab.id}
          role="tabpanel"
          aria-label={tab.label}
          className={'panel' + (tab.id === activeTab ? ' active' : '')}
          data-panel={tab.id}
        >
          {panels[tab.id]}
        </section>
      ))}
    </aside>
  )
}
