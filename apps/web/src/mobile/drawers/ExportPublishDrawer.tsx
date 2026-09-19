import { useState } from 'react'
import type { BookInfo } from '../../shell/workbenchStorage'
import { downloadNovelExport, fetchBookChaptersForExport } from '../../export-suite/exportDownload'

export interface ExportPublishDrawerProps {
  book?: BookInfo | null | undefined
  onClose: () => void
}

export function ExportPublishDrawer({ book, onClose }: ExportPublishDrawerProps): JSX.Element {
  const [format, setFormat] = useState<'txt' | 'docx' | 'epub'>('txt')
  const [title, setTitle] = useState(book?.title ?? '我的作品')
  const [sampleContent, setSampleContent] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [exportRealBook, setExportRealBook] = useState(Boolean(book?.root))

  const handleDownload = async () => {
    try {
      const bookTitle = title.trim() || book?.title || '未命名作品'
      let chapters = [
        {
          chapterIndex: 1,
          title: '第一章',
          content: sampleContent.trim() || '正文草稿内容',
        },
      ]

      if (book?.root && exportRealBook) {
        setStatus('读取作品全量正典章节中…')
        const realChapters = await fetchBookChaptersForExport(book.root)
        if (realChapters.length > 0) {
          chapters = realChapters
        }
      }

      const { fileName } = downloadNovelExport({
        bookTitle,
        format,
        chapters,
      })
      setStatus(`已成功下载 ${fileName}（共 ${chapters.length} 章）`)
    } catch (e) {
      setStatus(`导出失败：${(e as Error).message}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          导出尚未接入（平台直发尚未接入）
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          Technical Preview 尚未实现一键向起点/番茄等外部平台直发；但已支持本地出版级多格式（TXT/DOCX/EPUB）离线打包与下载。
        </div>
      </div>

      <div
        className="mobile-card"
        style={{
          margin: 0,
          background: 'var(--surface-core-mobile)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
          本地出版级格式打包
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {(['txt', 'docx', 'epub'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setFormat(fmt)}
              style={{
                padding: '6px 4px',
                fontSize: 11,
                borderRadius: 6,
                background: format === fmt ? 'var(--accent-mobile, #4f46e5)' : 'var(--surface-sunken)',
                color: format === fmt ? '#fff' : 'var(--fg-muted-mobile)',
                border: '1px solid var(--hairline)',
              }}
            >
              {fmt === 'txt' ? '作家助手 TXT' : fmt === 'docx' ? '责编审稿 Docx' : '读者 EPUB'}
            </button>
          ))}
        </div>

        {book && (
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-muted-mobile)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={exportRealBook}
              onChange={(e) => setExportRealBook(e.target.checked)}
            />
            导出当前作品全量章节 (《{book.title}》)
          </label>
        )}

        <input
          type="text"
          placeholder="作品标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            padding: '6px 8px',
            fontSize: 12,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--hairline)',
            borderRadius: 6,
            color: 'var(--fg-pure-mobile)',
          }}
        />

        {(!book || !exportRealBook) && (
          <textarea
            rows={3}
            placeholder="输入正文段落（留空则生成默认样章模板）"
            value={sampleContent}
            onChange={(e) => setSampleContent(e.target.value)}
            style={{
              padding: '6px 8px',
              fontSize: 12,
              background: 'var(--surface-sunken)',
              border: '1px solid var(--hairline)',
              borderRadius: 6,
              color: 'var(--fg-pure-mobile)',
              resize: 'vertical',
            }}
          />
        )}

        <button
          type="button"
          className="mobile-action-btn"
          onClick={handleDownload}
          style={{ background: 'var(--accent-mobile, #4f46e5)', color: '#fff', fontWeight: 600 }}
        >
          {book && exportRealBook ? `打包全本《${book.title}》并下载` : '打包并下载本地文件'}
        </button>
        {status && (
          <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 2 }}>{status}</div>
        )}
      </div>

      <button type="button" className="mobile-action-btn" onClick={onClose}>
        关闭
      </button>
    </div>
  )
}
