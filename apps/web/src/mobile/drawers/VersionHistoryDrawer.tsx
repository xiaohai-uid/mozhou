export interface VersionHistoryDrawerProps {
  onClose: () => void
}

export function VersionHistoryDrawer({ onClose }: VersionHistoryDrawerProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          版本历史尚未接入（云端时光机尚未接入）
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 不生成虚构快照、不展示不存在的 Diff。本地各章节版本修订与状态已由 LocalDataPlane 守护。
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
          本地正典章节守护状态
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
          • 本地修订序号：每章以严格 revision 递增，防外部覆盖冲突
          <br />
          • 写前哈希校验：保障正文保存前磁盘内容未被第三方静默改写
          <br />
          • 全量快照：可随时在「云同步与备份」中生成 C5 安全 ZIP 归档
        </div>
      </div>

      <button type="button" className="mobile-action-btn" onClick={onClose}>
        关闭
      </button>
    </div>
  )
}
