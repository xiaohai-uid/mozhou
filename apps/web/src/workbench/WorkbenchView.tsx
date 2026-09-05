/**
 * 中栏工作台（实现票 T40 · ADR-0027）。
 * 对话区骨架 + 建书/账本 + 创作辅助工具。所有状态文案必须来自真实数据；
 * 未接入的数据指标不得以示例数值伪装成当前用户状态。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'
import { DialogueStream } from './DialogueStream'
import { DesktopToolModals, type DesktopModalType } from '../shell/DesktopToolModals'
import type { BookInfo } from '../shell/workbenchStorage'
import type { ChapterReadResponse, ChapterSaveResponse } from '../../server/api'
import { NovelEditorCanvas } from './editor/NovelEditorCanvas'

interface BookCreated {
  ok: true
  root: string
  bookId: string
}

interface LedgerRow {
  kind: string
  event?: { type?: string; taskRef?: string }
  type?: string
}

export function WorkbenchView({
  book,
  onBookCreated,
  chapterIndex = 1,
  onChapterIndexChange,
}: {
  book: BookInfo | null
  onBookCreated: (book: BookInfo) => void
  chapterIndex?: number
  onChapterIndexChange?: (chapterIndex: number) => void
}): JSX.Element {
  const [title, setTitle] = useState('未命名之书')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [events, setEvents] = useState<readonly string[]>([])
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [activeModal, setActiveModal] = useState<DesktopModalType>(null)

  const [proseBody, setProseBody] = useState('')
  const [proseHash, setProseHash] = useState<string | null>(null)
  const [proseRevision, setProseRevision] = useState(0)
  const [proseWordCount, setProseWordCount] = useState(0)
  const [proseTitle, setProseTitle] = useState('第一章')
  const [proseDirty, setProseDirty] = useState(false)
  const [proseBusy, setProseBusy] = useState(false)
  const [proseStatusText, setProseStatusText] = useState<string | null>(null)
  const [proseError, setProseError] = useState<string | null>(null)

  const loadProse = useCallback(async (): Promise<void> => {
    if (book === null) return
    setProseBusy(true)
    setProseError(null)
    try {
      const res = await post<ChapterReadResponse>('/api/chapter.read', {
        root: book.root,
        chapterIndex,
      })
      setProseBody(res.body)
      setProseHash(res.hash)
      setProseRevision(res.revision)
      setProseWordCount(res.wordCount)
      setProseTitle(res.title)
      setProseDirty(false)
      setProseStatusText(`已同步磁盘 (Rev ${res.revision})`)
    } catch (err) {
      setProseError((err as Error).message)
    } finally {
      setProseBusy(false)
    }
  }, [book, chapterIndex])

  useEffect(() => {
    void loadProse()
  }, [loadProse])

  const handleSaveProse = async (): Promise<void> => {
    if (book === null) return
    setProseBusy(true)
    setProseError(null)
    setProseStatusText('正在保存…')
    try {
      const res = await post<ChapterSaveResponse>('/api/chapter.save', {
        root: book.root,
        chapterIndex,
        body: proseBody,
        baseHash: proseHash ?? undefined,
      })
      setProseHash(res.hash)
      setProseRevision(res.revision)
      setProseWordCount(res.wordCount)
      setProseDirty(false)
      setProseStatusText(`保存成功 (Rev ${res.revision} · ${res.wordCount} 字)`)
    } catch (err) {
      setProseError((err as Error).message)
      setProseStatusText('保存失败')
    } finally {
      setProseBusy(false)
    }
  }

  const handleCreateBook = async (): Promise<void> => {
    setCreateError(null)
    setCreateBusy(true)
    try {
      const data = await post<BookCreated>('/api/book', { title })
      onBookCreated({ root: data.root, bookId: data.bookId, title })
    } catch (cause) {
      setCreateError((cause as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  const handleRefreshLedger = async (): Promise<void> => {
    if (book === null) return
    setLedgerError(null)
    try {
      const data = await post<{ events: readonly LedgerRow[] }>('/api/ledger', { root: book.root })
      setEvents(
        data.events.map((row) =>
          row.kind === 'task' ? (row.event?.type ?? 'task') : (row.type ?? row.kind),
        ),
      )
    } catch (cause) {
      setLedgerError((cause as Error).message)
    }
  }

  return (
    <section className="center">
      <div className="chapterbar">
        <h1>{book === null ? '未命名之书' : `《${book.title}》`}</h1>
        <span className="meta">{book === null ? '尚未建书' : 'BOOK ' + book.bookId.slice(0, 8)}</span>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          {book !== null && (
            <label className="mono muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              当前章
              <input
                className="control"
                aria-label="当前章节"
                type="number"
                min={1}
                step={1}
                value={chapterIndex}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10)
                  if (Number.isInteger(value) && value >= 1) onChapterIndexChange?.(value)
                }}
                style={{ width: 74, padding: '4px 6px' }}
              />
            </label>
          )}
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setActiveModal('history')}>
            ⏱ 时光机 Diff
          </button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setActiveModal('inspiration')}>
            🎲 灵感工坊
          </button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setActiveModal('export')}>
            📦 导出排版
          </button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setActiveModal('compliance')}>
            🛡️ 敏感词审查
          </button>
        </div>
      </div>

      <div className="conversation">
        <DialogueStream book={book} chapterIndex={chapterIndex} />

        {book !== null && (
          <section className="wb-section" data-testid="prose-editor">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>第 {chapterIndex} 章 · {proseTitle}</h2>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {proseWordCount} 字 · Rev {proseRevision}
                </span>
                {proseDirty && (
                  <span className="tag" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
                    未保存
                  </span>
                )}
                {proseStatusText !== null && (
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {proseStatusText}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => void loadProse()}
                  disabled={proseBusy}
                  data-testid="reload-prose-btn"
                >
                  重新读取
                </button>
                <button
                  className="btn-primary"
                  style={{ fontSize: 11, padding: '3px 12px' }}
                  onClick={() => void handleSaveProse()}
                  disabled={proseBusy || !proseDirty}
                  data-testid="save-prose-btn"
                >
                  {proseBusy ? '处理中…' : '保存正文'}
                </button>
              </div>
            </div>

            {proseError !== null && (
              <p className="wb-error" role="alert" data-testid="prose-error" style={{ marginBottom: 8 }}>
                {proseError}
              </p>
            )}

            <NovelEditorCanvas
              value={proseBody}
              onChange={(val) => {
                setProseBody(val)
                setProseDirty(true)
                setProseWordCount(val.length)
              }}
              placeholder="在此处撰写或手工修改正文，点击保存正文写入磁盘…"
            />
          </section>
        )}

        <section className="wb-section" data-testid="create-book">
          <h2>建书</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>新建作品</b>
                {book !== null && <span className="mono muted">已建</span>}
              </div>
              <div className="actions">
                <input
                  className="control"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={createBusy}
                  aria-label="作品名"
                  style={{ flex: 1, minWidth: 160 }}
                />
                <button className="btn-primary" onClick={() => void handleCreateBook()} disabled={createBusy}>
                  {createBusy ? '创建中…' : '创建'}
                </button>
              </div>
              {book !== null && (
                <p data-testid="created-book" className="mono muted" style={{ margin: '10px 0 0' }}>
                  已建：根 {book.root} · 书 {book.bookId}
                </p>
              )}
              {createError !== null && <p className="wb-error" role="alert">错误：{createError}</p>}
            </div>
          </div>
        </section>

        <section className="wb-section" data-testid="ledger">
          <h2>账本</h2>
          <div className="actions">
            <button className="btn" onClick={() => void handleRefreshLedger()} disabled={book === null}>
              刷新账本
            </button>
            <span className="mono muted" style={{ alignSelf: 'center' }}>
              Phase 5 遍历 / 风格学习事件会出现在这里
            </span>
          </div>
          {ledgerError !== null && <p className="wb-error" role="alert">错误：{ledgerError}</p>}
          {events.length > 0 && (
            <div className="card-shell" style={{ marginTop: 10 }}>
              <div className="card">
                <div className="mono muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {events.map((ev, index) => <div key={index}>• {ev}</div>)}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <DesktopToolModals activeModal={activeModal} onClose={() => setActiveModal(null)} book={book} />
    </section>
  )
}
