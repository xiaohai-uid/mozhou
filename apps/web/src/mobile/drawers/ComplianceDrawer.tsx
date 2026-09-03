export function ComplianceDrawer(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          合规审查尚未接入
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 尚未接入可验证的平台规则库或审核引擎，因此不会宣称“检测通过”、合规率或某年度最新词库结果。
        </div>
      </div>
    </div>
  )
}
