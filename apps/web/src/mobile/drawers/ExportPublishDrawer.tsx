import { useState } from 'react'
import { exportCleanTxt } from '../../export-suite/txtCleanExporter'
import { exportSubmissionDocx } from '../../export-suite/docxExporter'
import { exportSubmissionEpub } from '../../export-suite/epubExporter'

export interface ExportPublishDrawerProps {
  onClose: () => void
}

export function ExportPublishDrawer({ onClose }: ExportPublishDrawerProps): JSX.Element {
  const [format, setFormat] = useState<'txt' | 'docx' | 'epub'>('txt')
  const [title, setTitle] = useState('我的作品')
  const [sampleContent, setSampleContent] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const handleDownload = () => {
    try {
      const bookTitle = title.trim() || '未命名作品'
      const chapters = [
        {
          chapterIndex: 1,
          title: '第一章',
          content: sampleContent.trim() || '正文草稿内容',
        },
      ]
      let blob: Blob
      let ext = 'txt'
      if (format === 'txt') {
        const txt = exportCleanTxt(bookTitle, chapters)
        blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
        ext = 'txt'
      } else if (format === 'docx') {
        const buf = exportSubmissionDocx(bookTitle, '', chapters)
        blob = new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        ext = 'docx'
      } else {
        const buf = exportSubmissionEpub(bookTitle, '墨舟作者', chapters)
        blob = new Blob([buf], { type: 'application/epub+zip' })
        ext = 'epub'
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${bookTitle}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setStatus(`已成功下载 ${bookTitle}.${ext}`)
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
        <button
          type="button"
          className="mobile-action-btn"
          onClick={handleDownload}
          style={{ background: 'var(--accent-mobile, #4f46e5)', color: '#fff', fontWeight: 600 }}
        >
          打包并下载本地文件
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
