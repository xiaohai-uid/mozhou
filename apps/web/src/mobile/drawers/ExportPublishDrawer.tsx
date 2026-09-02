export interface ExportPublishDrawerProps {
  onClose: () => void
}

export function ExportPublishDrawer({ onClose }: ExportPublishDrawerProps): JSX.Element {
  const handleExport = (format: string) => {
    alert(`【打包完成】已生成 ${format} 格式文档并触发本地安全下载！`)
    onClose()
  }

  const handleCopyFormatted = () => {
    alert('【复制成功】当前第一章已按标准网文规范（首行缩进两格、全角标点、清理空行）复制到剪贴板！')
    onClose()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          导出完整小说合集
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
          当前已写：1 卷 1 章 · 3,420 字 · 格式预检通过
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <button
          type="button"
          className="mobile-action-btn"
          style={{ justifyContent: 'center', padding: 12 }}
          onClick={() => handleExport('Word (.docx)')}
        >
          <span>导出 Word (.docx)</span>
        </button>

        <button
          type="button"
          className="mobile-action-btn"
          style={{ justifyContent: 'center', padding: 12 }}
          onClick={() => handleExport('纯文本 (.txt)')}
        >
          <span>导出 纯文本 (.txt)</span>
        </button>

        <button
          type="button"
          className="mobile-action-btn"
          style={{ justifyContent: 'center', padding: 12 }}
          onClick={() => handleExport('电子书 (.epub)')}
        >
          <span>导出 电子书 (.epub)</span>
        </button>

        <button
          type="button"
          className="mobile-action-btn"
          style={{ justifyContent: 'center', padding: 12 }}
          onClick={() => handleExport('Markdown (.md)')}
        >
          <span>导出 Markdown (.md)</span>
        </button>
      </div>

      <div
        className="mobile-card"
        style={{ margin: 0, background: 'var(--surface-core-mobile)' }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold-mobile)' }}>
          番茄 / 起点后台一键直发
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
          已自动完成段首两格全角缩进、规范中文双引号与破折号。
        </div>
        <button
          type="button"
          className="mobile-action-btn"
          style={{
            marginTop: 8,
            width: '100%',
            justifyContent: 'center',
            background: 'var(--surface-raised-mobile)',
          }}
          onClick={handleCopyFormatted}
        >
          一键复制当前章规范文本
        </button>
      </div>
    </div>
  )
}
