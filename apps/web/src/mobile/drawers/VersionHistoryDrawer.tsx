export interface VersionHistoryDrawerProps {
  onClose: () => void
}

export function VersionHistoryDrawer({ onClose }: VersionHistoryDrawerProps): JSX.Element {
  const handleRollback = (rev: number) => {
    alert(`已安全回滚至 Rev ${rev} 版本！正文与本地快照已同步更新。`)
    onClose()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Rev 4 · 当前最新修改 (自动快照)</span>
          <span className="mobile-tag green">当前版本</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
          10 分钟前 · 增补赵捕头拔刀压迫感
        </div>
      </div>

      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Rev 3 · 30 分钟前快照</span>
          <button
            type="button"
            className="mobile-action-btn"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => handleRollback(3)}
          >
            恢复此版本
          </button>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-secondary-mobile)',
            marginTop: 8,
            lineHeight: 1.6,
            padding: 8,
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 8,
          }}
        >
          <span
            style={{
              background: 'rgba(244, 63, 94, 0.2)',
              color: 'var(--rose-mobile)',
              textDecoration: 'line-through',
              padding: '1px 3px',
              borderRadius: 3,
            }}
          >
            庙门被推开
          </span>{' '}
          <span
            style={{
              background: 'rgba(74, 222, 128, 0.2)',
              color: 'var(--emerald-mobile)',
              padding: '1px 3px',
              borderRadius: 3,
            }}
          >
            庙门哐当一声被撞开
          </span>
          ，治安官赵捕头大步跨入...
        </div>
      </div>

      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Rev 1 · 昨晚初稿建立</span>
          <button
            type="button"
            className="mobile-action-btn"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => handleRollback(1)}
          >
            恢复此版本
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
          字数：2,100 字 · 核心设定初始化
        </div>
      </div>
    </div>
  )
}
