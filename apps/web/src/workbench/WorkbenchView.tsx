/**
 * 中栏工作台（实现票 T40 · ADR-0027 · 商业化全景闭环）：
 * 对话区骨架 + 存量建书/账本 + 6 大商业化工具（时光机 Diff、每日码字目标、
 * 灵感起名工坊、全格式导出、平台敏感词审查）。
 */
import { useState } from 'react'
import { post } from '../lib/post'
import { DialogueStream } from './DialogueStream'
import { DesktopToolModals, type DesktopModalType } from '../shell/DesktopToolModals'
import type { BookInfo } from '../shell/workbenchStorage'

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
}: {
  book: BookInfo | null
  onBookCreated: (book: BookInfo) => void
}): JSX.Element {
  const [title, setTitle] = useState('未命名之书')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [events, setEvents] = useState<readonly string[]>([])
  const [ledgerError, setLedgerError] = useState<string | null>(null)

  // 商业化工具模态窗
  const [activeModal, setActiveModal] = useState<DesktopModalType>(null)

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
      {/* 顶栏与码字目标 */}
      <div className="chapterbar">
        <h1>{book === null ? '未命名之书' : `《${book.title}》`}</h1>
        <span className="meta">{book === null ? '尚未建书' : 'BOOK ' + book.bookId.slice(0, 8)}</span>

        {/* 商业化快捷微工具 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <span className="cap-badge native" style={{ cursor: 'pointer' }} title="今日码字进度">
            🎯 3,420 / 4,000 字 (85%) · 连更12天
          </span>
          <button
            className="btn"
            style={{ padding: '4px 8px', fontSize: 12 }}
            onClick={() => setActiveModal('history')}
          >
            ⏱ 时光机 Diff
          </button>
          <button
            className="btn"
            style={{ padding: '4px 8px', fontSize: 12 }}
            onClick={() => setActiveModal('inspiration')}
          >
            🎲 灵感工坊
          </button>
          <button
            className="btn"
            style={{ padding: '4px 8px', fontSize: 12 }}
            onClick={() => setActiveModal('export')}
          >
            📦 导出排版
          </button>
          <button
            className="btn"
            style={{ padding: '4px 8px', fontSize: 12 }}
            onClick={() => setActiveModal('compliance')}
          >
            🛡️ 敏感词审查
          </button>
        </div>
      </div>

      <div className="conversation">
        <DialogueStream book={book} />

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
                <button
                  className="btn-primary"
                  onClick={() => void handleCreateBook()}
                  disabled={createBusy}
                >
                  {createBusy ? '创建中…' : '创建'}
                </button>
              </div>
              {book !== null && (
                <p data-testid="created-book" className="mono muted" style={{ margin: '10px 0 0' }}>
                  已建：根 {book.root} · 书 {book.bookId}
                </p>
              )}
              {createError !== null && (
                <p className="wb-error" role="alert">
                  错误：{createError}
                </p>
              )}
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
          {ledgerError !== null && (
            <p className="wb-error" role="alert">
              错误：{ledgerError}
            </p>
          )}
          {events.length > 0 && (
            <div className="card-shell" style={{ marginTop: 10 }}>
              <div className="card">
                <div className="mono muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {events.map((ev, index) => (
                    <div key={index}>• {ev}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 桌面端模态窗 */}
      <DesktopToolModals activeModal={activeModal} onClose={() => setActiveModal(null)} />
    </section>
  )
}
