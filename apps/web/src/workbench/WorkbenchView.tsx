/**
 * 中栏工作台（实现票 T40）：Ink Orbit 对话区骨架（真实对话流随 T44
 * 接入，输入区以 disabled 显式占位）+ 存量功能填充——建书卡 / 账本可见，
 * 全部换肤为 Ink Orbit 材质。Story Brain 实体网格切片已随 T41 迁入
 * 右侧检视塔（apps/web/src/story-brain/StoryBrainPanel.tsx）。
 */
import { useState } from 'react'
import { post } from '../lib/post'
import { DialogueStream } from './DialogueStream'
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
        <span className="save">
          <i className="status-dot" />
          本地书库
        </span>
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
          <ul className="mono muted" style={{ maxHeight: 240, overflow: 'auto', margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {events.map((type, index) => (
              <li key={index} style={{ padding: '4px 0', boxShadow: 'inset 0 -1px var(--hairline)' }}>
                {type}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}
