import React, { useCallback, useEffect, useState } from 'react'
import { exportCleanTxt, ChapterExportItem } from './txtCleanExporter'
import { exportSubmissionDocxHtml } from './docxExporter'
import { exportEpubBlob } from './epubExporter'

interface StructuredExportResponse {
  ok: boolean
  title: string
  chapters?: { index: number; title: string; content: string }[]
  error?: string
}

export interface PublicationExportModalProps {
  isOpen: boolean
  onClose: () => void
  /** 作品本地根目录（服务端 assertSafeBookRoot 校验）。 */
  root: string
  bookTitle: string
}

type ExportFormat = 'txt' | 'docx' | 'epub'

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const PublicationExportModal: React.FC<PublicationExportModalProps> = ({
  isOpen,
  onClose,
  root,
  bookTitle,
}) => {
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [chapters, setChapters] = useState<readonly ChapterExportItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const loadChapters = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/book.export-txt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, structured: true }),
      })
      const data = (await res.json()) as StructuredExportResponse
      if (!res.ok || !data.ok || data.chapters === undefined) {
        throw new Error(data.error ?? '导出数据请求失败（HTTP ' + res.status + '）')
      }
      setChapters(data.chapters)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [root])

  useEffect(() => {
    if (isOpen) void loadChapters()
  }, [isOpen, loadChapters])

  if (!isOpen) return null

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      if (format === 'txt') {
        const text = exportCleanTxt(bookTitle, chapters)
        triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `《${bookTitle}》_TXT.txt`)
        onClose()
      } else if (format === 'docx') {
        const html = exportSubmissionDocxHtml(bookTitle, '', chapters)
        triggerDownload(
          new Blob([html], { type: 'application/msword;charset=utf-8' }),
          `《${bookTitle}》_DOC.doc`
        )
        onClose()
      } else {
        const blob = await exportEpubBlob(bookTitle, '墨舟 Novel OS', chapters)
        triggerDownload(blob, `《${bookTitle}》_EPUB.epub`)
        onClose()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-indigo-500" />
            <h3 className="text-sm font-semibold text-zinc-100">出版与全格式分发中心</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm px-2 py-1 rounded-lg hover:bg-zinc-800"
            data-testid="pub-export-close"
          >
            ✕
          </button>
        </div>

        {error !== null && (
          <p className="text-xs text-red-400 bg-red-950/50 border border-red-900/60 rounded-xl px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div className="space-y-3 text-xs">
          <div className="text-zinc-400">选择导出格式：</div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'txt', label: '作家助手 TXT', desc: '起点/番茄规范排版' },
                { id: 'docx', label: '责编审稿 Doc', desc: 'Word 兼容排版' },
                { id: 'epub', label: '读者 EPUB', desc: 'EPUB 3 电子书' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFormat(item.id)}
                data-testid={`pub-format-${item.id}`}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  format === item.id
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-zinc-200 mb-1">{item.label}</div>
                <div className="text-[10px] text-zinc-500">{item.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
          <div>
            导出书目：<span className="text-zinc-200 font-medium">{bookTitle}</span>
          </div>
          <div>
            包含章节：
            {loading ? (
              <span className="text-zinc-500" data-testid="pub-chapters-loading">正在读取章节…</span>
            ) : (
              <span className="text-indigo-400 font-medium" data-testid="pub-chapters-count">{chapters.length} 章</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-xl"
          >
            取消
          </button>
          <button
            type="button"
            disabled={exporting || loading || chapters.length === 0}
            onClick={() => void handleExport()}
            data-testid="pub-export-run"
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {exporting ? '正在封装...' : '立即导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
