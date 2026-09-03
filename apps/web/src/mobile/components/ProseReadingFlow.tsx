export interface ProseReadingFlowProps {
  title?: string
  wordCount?: number
  revision?: number
  proseParagraphs?: string[]
  onOpenFormat?: () => void
}

export function ProseReadingFlow({
  title,
  wordCount,
  revision,
  proseParagraphs = [],
  onOpenFormat,
}: ProseReadingFlowProps): JSX.Element {
  const hasProse = proseParagraphs.length > 0

  return (
    <div style={{ padding: '16px 20px 110px' }}>
      <h2
        style={{
          fontFamily: 'var(--font-prose-mobile)',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--fg-pure-mobile)',
          marginBottom: 6,
        }}
      >
        {title ?? '正文预览'}
      </h2>

      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-muted-mobile)',
          marginBottom: 20,
          paddingBottom: 10,
          borderBottom: '1px solid var(--hairline-subtle-mobile)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <span>{wordCount === undefined ? '字数未载入' : `${wordCount.toLocaleString()} 字`}</span>
          <span>{revision === undefined ? '版本未载入' : `修改版本：Rev ${revision}`}</span>
          <span>合规审查未接入</span>
        </div>
        <button
          type="button"
          className="mobile-tag"
          style={{ cursor: onOpenFormat ? 'pointer' : 'not-allowed', background: 'transparent', border: 'none' }}
          onClick={onOpenFormat}
          disabled={onOpenFormat === undefined}
        >
          排版未接入
        </button>
      </div>

      {hasProse ? (
        <div
          style={{
            fontFamily: 'var(--font-prose-mobile)',
            fontSize: 16.5,
            lineHeight: 2.0,
            color: 'var(--fg-primary-mobile)',
            textAlign: 'justify',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {proseParagraphs.map((paragraph) => <p key={paragraph.slice(0, 32)}>{paragraph}</p>)}
        </div>
      ) : (
        <div className="mobile-card" style={{ margin: 0 }}>
          <b>正文数据尚未载入移动端阅读面</b>
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
            Technical Preview 不使用示例小说冒充当前作品正文。请以作品数据面中的真实章节内容为准。
          </div>
        </div>
      )}
    </div>
  )
}
