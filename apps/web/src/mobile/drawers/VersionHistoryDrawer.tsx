export interface VersionHistoryDrawerProps {
  onClose: () => void
}

export function VersionHistoryDrawer({ onClose }: VersionHistoryDrawerProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          版本历史尚未接入
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 不生成虚构快照、不展示不存在的 Diff，也不会模拟回滚成功。接入真实版本数据面后再开放恢复操作。
        </div>
      </div>
      <button type="button" className="mobile-action-btn" onClick={onClose}>关闭</button>
    </div>
  )
}
