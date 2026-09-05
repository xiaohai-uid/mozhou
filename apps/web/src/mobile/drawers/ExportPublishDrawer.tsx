export interface ExportPublishDrawerProps {
  onClose: () => void
}

export function ExportPublishDrawer({ onClose }: ExportPublishDrawerProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          导出尚未接入
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          全本 TXT 导出已在桌面工作台就绪；移动端暂不支持直接下载，不会显示虚构字数、预检或下载成功状态。
        </div>
      </div>
      <button type="button" className="mobile-action-btn" onClick={onClose}>关闭</button>
    </div>
  )
}
