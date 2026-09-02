export function ComplianceDrawer(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--emerald-mobile)' }}>
            ✓ 未发现严重违禁词
          </span>
          <span className="mobile-tag green">合规率 100%</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
          比对库：阅文/番茄 2026 最新网文敏感词库
        </div>
      </div>

      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary-mobile)' }}>
          提词建议与架空规范
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fg-secondary-mobile)',
            marginTop: 6,
            lineHeight: 1.6,
          }}
        >
          • 官方机构名已规范使用「龙国特事治安局」，规避现实机关撞名；<br />
          • 暴力与冲突描写尺度适中，符合全年龄段过审规范；<br />
          • 正文未检测到被平台拦截的低俗或涉政词汇。
        </div>
      </div>
    </div>
  )
}
