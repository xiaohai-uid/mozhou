import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DocImportExecuteDtoResponse,
  DocImportFormat,
  DocImportPreviewChapterDto,
  DocImportPreviewDtoResponse,
  DocSplitMode,
} from '../../shared/api'
import { post } from '../lib/post'

export interface DocImportModalProps {
  isOpen: boolean
  parentDir?: string | null | undefined
  onClose: () => void
  onSuccess: (createdBook: { root: string; bookId: string; title: string }) => void
}

/** 辅助：浏览器端将 File 转 Base64 字符串（用于传输 DOCX 或二进制流） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1]! : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
}

/** 格式嗅探辅助 */
function detectFormatFromName(name: string): DocImportFormat {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md'
  return 'txt'
}

export function DocImportModal({
  isOpen,
  parentDir,
  onClose,
  onSuccess,
}: DocImportModalProps): JSX.Element | null {
  const [tab, setTab] = useState<'file' | 'text'>('file')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [rawText, setRawText] = useState('')
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState<DocImportFormat>('txt')
  const [splitMode, setSplitMode] = useState<DocSplitMode>('auto')
  const [threshold, setThreshold] = useState<number | ''>(3000)
  const [customParentDir, setCustomParentDir] = useState(parentDir ?? '')

  useEffect(() => {
    if (parentDir) setCustomParentDir(parentDir)
  }, [parentDir])

  const [preview, setPreview] = useState<DocImportPreviewDtoResponse | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ESC 键监听关闭
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, importing, onClose])

  // 重置现场
  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null)
      setFileBase64(null)
      setRawText('')
      setTitle('')
      setFormat('txt')
      setSplitMode('auto')
      setThreshold(3000)
      setPreview(null)
      setError(null)
      setParsing(false)
      setImporting(false)
    }
  }, [isOpen])

  // 处理文件选择
  const handleFileChange = async (file: File) => {
    setError(null)
    setSelectedFile(file)
    const fmt = detectFormatFromName(file.name)
    setFormat(fmt)

    // 默认书名取文件名去扩展名
    const defaultTitle = file.name.replace(/\.[^/.]+$/, '').trim()
    if (!title.trim()) {
      setTitle(defaultTitle)
    }

    try {
      if (fmt === 'docx') {
        const b64 = await fileToBase64(file)
        setFileBase64(b64)
      } else {
        const text = await file.text()
        setRawText(text)
        setFileBase64(null)
      }
    } catch (err) {
      setError(`读取文件失败: ${(err as Error).message}`)
    }
  }

  // 触发分章解析预览
  const triggerPreview = useCallback(async () => {
    const hasContent = (tab === 'file' && (fileBase64 || rawText)) || (tab === 'text' && rawText.trim().length > 0)
    if (!hasContent) {
      setPreview(null)
      return
    }

    setParsing(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        action: 'preview',
        previewOnly: true,
        title: title.trim() || '预览草稿',
        format: tab === 'text' ? 'txt' : format,
        splitOptions: {
          splitMode,
          wordCountThreshold: splitMode === 'word-count' ? (typeof threshold === 'number' ? threshold : 3000) : undefined,
        },
      }

      if (tab === 'file' && format === 'docx' && fileBase64) {
        payload['fileBase64'] = fileBase64
      } else {
        payload['content'] = rawText
      }

      const res = await post<DocImportPreviewDtoResponse>('/api/library.import.doc', payload)
      if (res.ok && res.preview) {
        setPreview(res)
      }
    } catch (err) {
      setError((err as Error).message)
      setPreview(null)
    } finally {
      setParsing(false)
    }
  }, [tab, fileBase64, rawText, title, format, splitMode, threshold])

  // 当文件或分章策略发生改变时自动拉取预览
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      void triggerPreview()
    }, 300)
    return () => clearTimeout(timer)
  }, [isOpen, triggerPreview])

  // 执行最终导入建书
  const handleExecuteImport = async () => {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('请输入作品标题')
      return
    }
    const effectiveParentDir = (parentDir || customParentDir).trim()
    if (!effectiveParentDir) {
      setError('请输入或指定书库存储目录 (Parent Directory)')
      return
    }
    if (!preview || preview.chapters.length === 0) {
      setError('当前没有可导入的章节，请先上传有效文档或提供文本')
      return
    }

    setImporting(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        title: cleanTitle,
        parentDir: effectiveParentDir,
        format: tab === 'text' ? 'txt' : format,
        splitOptions: {
          splitMode,
          wordCountThreshold: splitMode === 'word-count' ? (typeof threshold === 'number' ? threshold : 3000) : undefined,
        },
      }

      if (tab === 'file' && format === 'docx' && fileBase64) {
        payload['fileBase64'] = fileBase64
      } else {
        payload['content'] = rawText
      }

      const res = await post<DocImportExecuteDtoResponse>('/api/library.import.doc', payload)
      if (res.ok) {
        onSuccess({
          root: res.root,
          bookId: res.bookId,
          title: res.title,
        })
        onClose()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const totalWords = useMemo(() => {
    if (!preview) return 0
    return preview.chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
  }, [preview])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-import-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) onClose()
      }}
    >
      <div
        className="card-shell"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 10,
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* 标题栏 */}
        <div
          className="card-title"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '16px 20px 12px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div>
            <div className="mono muted" style={{ fontSize: 11, letterSpacing: '0.05em', color: 'var(--jade)' }}>
              既有稿件导入 · 支持 WORD / TXT / MARKDOWN
            </div>
            <h2 id="doc-import-dialog-title" style={{ margin: '4px 0 0', fontSize: 16, color: 'var(--foreground)' }}>
              导入已有书稿建书
            </h2>
          </div>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={importing}
            style={{ padding: '2px 8px' }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 主内容区（可滚动） */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 输入源 Tab 切换 */}
          <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--hairline)', paddingBottom: 8 }}>
            <button
              type="button"
              className={tab === 'file' ? 'btn-primary' : 'btn'}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setTab('file')}
            >
              文件选择与拖拽 (DOCX / TXT / MD)
            </button>
            <button
              type="button"
              className={tab === 'text' ? 'btn-primary' : 'btn'}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setTab('text')}
            >
              粘贴长文本
            </button>
          </div>

          {/* 文件通道 */}
          {tab === 'file' ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                data-testid="doc-import-file-input"
                accept=".docx,.txt,.md,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFileChange(f)
                }}
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) void handleFileChange(f)
                }}
                onClick={() => fileInputRef.current?.click()}
                data-testid="doc-import-dropzone"
                style={{
                  border: isDragging ? '2px dashed var(--gold)' : '2px dashed var(--hairline-strong)',
                  borderRadius: 8,
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: isDragging ? 'var(--surface-raised)' : 'var(--surface-sunken)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                {selectedFile ? (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                      📄 {selectedFile.name}
                    </div>
                    <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>
                      大小: {(selectedFile.size / 1024).toFixed(1)} KB · 格式: {format.toUpperCase()} · 点击重选
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--foreground)' }}>
                      拖拽 Word (.docx) / TXT / Markdown 文件到此处，或点击浏览文件
                    </div>
                    <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>
                      零外部依赖解析 · 严格离线解包 · 保证隐私安全
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <textarea
                className="control"
                placeholder="在此直接粘贴完整书稿或连载文本（包含『第X章』等章节标题最佳）…"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                style={{
                  width: '100%',
                  height: 120,
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: 'var(--serif)',
                  resize: 'vertical',
                }}
                aria-label="粘贴书稿内容"
              />
            </div>
          )}

          {/* 书名与分章策略配置 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
              作品名称 (Title)
              <input
                className="control"
                placeholder="如：沧海仙途"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                aria-label="作品名称"
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
              分章策略 (Split Mode)
              <select
                className="control"
                value={splitMode}
                onChange={(e) => setSplitMode(e.target.value as DocSplitMode)}
                aria-label="分章策略"
              >
                <option value="auto">智能识别 (首选标题，无标题自动后备)</option>
                <option value="title">章节标题 (严格匹配『第X章』/ Markdown)</option>
                <option value="blank-line">连续空行 (按两行以上空白换行切分)</option>
                <option value="word-count">字数阈值 (固定字数段落截断)</option>
              </select>
            </label>
          </div>

          {splitMode === 'word-count' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
              单章目标字数阈值 (默认 3000 字)
              <input
                type="number"
                className="control"
                min={500}
                max={30000}
                step={500}
                value={threshold}
                onChange={(e) => {
                  const val = e.target.value
                  setThreshold(val === '' ? '' : Number(val))
                }}
                aria-label="单章目标字数"
              />
            </label>
          )}

          {!parentDir && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
              书库存储目录 (Parent Directory)
              <input
                className="control"
                placeholder="指定新建书存放的父目录绝对路径…"
                value={customParentDir}
                onChange={(e) => setCustomParentDir(e.target.value)}
                required
                aria-label="书库存储目录"
              />
            </label>
          )}

          {/* 错误提示 */}
          {error && (
            <p className="wb-error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}

          {/* 分章实时预览区 */}
          <div style={{ border: '1px solid var(--hairline)', borderRadius: 8, padding: 12, background: 'var(--surface-sunken)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className="mono muted" style={{ fontSize: 12, fontWeight: 600 }}>
                分章解析预览
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {parsing && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--gold)' }}>
                    正在切分解析…
                  </span>
                )}
                {preview && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--jade)' }}>
                    共识别出 <b>{preview.chapterCount}</b> 章 · 合计 <b>{totalWords.toLocaleString()}</b> 字
                  </span>
                )}
              </div>
            </div>

            {preview && preview.chapters.length > 0 ? (
              <div
                style={{
                  maxHeight: 180,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingRight: 4,
                }}
                data-testid="doc-import-chapters-preview"
              >
                {preview.chapters.map((ch: DocImportPreviewChapterDto) => (
                  <div
                    key={ch.chapterIndex}
                    style={{
                      padding: '6px 10px',
                      background: 'var(--surface)',
                      borderRadius: 6,
                      border: '1px solid var(--hairline)',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--foreground)' }}>
                      <span>{ch.title}</span>
                      <span className="mono muted" style={{ fontSize: 11 }}>{ch.wordCount} 字</span>
                    </div>
                    {ch.preview && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ch.preview}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mono muted" style={{ textAlign: 'center', padding: '20px 0', fontSize: 11 }}>
                {parsing ? '分章解析中，请稍候…' : '选择文件或录入正文后，将在此呈现章节划分与前瞻预览'}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--hairline)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            background: 'var(--surface-raised)',
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={importing}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleExecuteImport()}
            disabled={importing || parsing || !preview || preview.chapters.length === 0 || !title.trim()}
          >
            {importing ? '正在原子建书与导入卷章…' : '确认导入建书 →'}
          </button>
        </div>
      </div>
    </div>
  )
}
