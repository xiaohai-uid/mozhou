/**
 * 右侧检视塔（实现票 T40）：质量门 / Story Brain / 装配看板 / 变更矩阵
 * 四 tab 框架。质量门 tab 承载真实 QualityPanel；其余三 tab 为显式占位，
 * 随 T41/T42/T43 逐票迁入（spec #84 检视塔架构）。
 */
import type { ReactNode } from 'react'

export const INSPECTOR_TABS = [
  { id: 'quality', label: '质量门' },
  { id: 'story-brain', label: 'Story Brain' },
  { id: 'context-receipt', label: '装配看板' },
  { id: 'change-matrix', label: '变更矩阵' },
] as const

export type InspectorTabId = (typeof INSPECTOR_TABS)[number]['id']

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
}: {
  activeTab: InspectorTabId
  onTabChange: (tab: InspectorTabId) => void
  panels: Readonly<Record<InspectorTabId, ReactNode>>
}): JSX.Element {
  return (
    <aside className="inspector" aria-label="检视塔">
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
