/**
 * 中栏工作台（实现票 T40）：Ink Orbit 对话区骨架（真实对话流随 T44
 * 接入，输入区以 disabled 显式占位）+ 存量功能填充——建书卡 /
 * Story Brain 实体网格切片 / 账本可见，全部换肤为 Ink Orbit 材质。
 */
import { useState } from 'react'
import type { EntityCardScan } from '@mozhou/data-plane'
import { post } from '../lib/post'
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
  const [entityCards, setEntityCards] = useState<readonly EntityCardScan[]>([])
  const [entitiesLoaded, setEntitiesLoaded] = useState(false)
  const [entitiesBusy, setEntitiesBusy] = useState(false)
  const [entityError, setEntityError] = useState<string | null>(null)
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

  const handleRefreshEntities = async (): Promise<void> => {
    if (book === null) return
    setEntityError(null)
    setEntitiesBusy(true)
    try {
      const data = await post<{ cards: readonly EntityCardScan[] }>('/api/story-brain.entities', {
        root: book.root,
      })
      setEntityCards(data.cards)
      setEntitiesLoaded(true)
    } catch (cause) {
      setEntityError((cause as Error).message)
    } finally {
      setEntitiesBusy(false)
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

  const entityGroups = new Map<EntityCardScan['cardType'], EntityCardScan[]>()
  for (const card of entityCards) {
    const group = entityGroups.get(card.cardType)
    if (group === undefined) {
      entityGroups.set(card.cardType, [card])
    } else {
      group.push(card)
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
        <div className="date-rule">CHAPTER PRODUCTION SESSION · 对话流随 T44 接入</div>

        <div className="msg ai" data-testid="dialogue-skeleton">
          <div className="avatar">舟</div>
          <div className="bubble">
            写作对话流（墨舟先问 · 气泡流 · 草稿流片段）将在中栏对话票 T44 接入，当前为骨架。
            <span className="hint">
              中栏暂以存量功能填充：建书卡 / Story Brain 实体网格 / 账本可见。
            </span>
          </div>
        </div>

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

        <section className="wb-section" data-testid="story-brain-entities">
          <h2>Story Brain · 实体网格</h2>
          <div className="actions">
            <button
              className="btn"
              onClick={() => void handleRefreshEntities()}
              disabled={book === null || entitiesBusy}
            >
              {entitiesBusy ? '读取中…' : '刷新实体'}
            </button>
            <span className="mono muted" style={{ alignSelf: 'center' }}>
              三区面板随 T41 迁入检视塔
            </span>
          </div>
          {entityError !== null && (
            <p className="wb-error" role="alert">
              错误：{entityError}
            </p>
          )}
          {entitiesLoaded && entityCards.length === 0 && <p className="muted">暂无实体卡</p>}
          {Array.from(entityGroups.entries()).map(([cardType, cards]) => (
            <div key={cardType} style={{ marginTop: 14 }}>
              <div className="mono muted" style={{ marginBottom: 6 }}>
                {cardType}
              </div>
              <div className="entity-grid">
                {cards.map((card) => (
                  <article key={card.ref} className="entity" data-entity-ref={card.ref}>
                    <strong>{card.name}</strong>
                    <small>{card.ref}</small>
                    {card.brief !== null && <p style={{ margin: 0 }}>{card.brief}</p>}
                  </article>
                ))}
              </div>
            </div>
          ))}
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

      <div className="composer-wrap">
        <div className="composer-shell">
          <div className="composer">
            <textarea
              placeholder="对话流将在 T44 接入——此处为骨架占位，不假装可用"
              disabled
              aria-label="写作对话输入（T44 接入前占位）"
            />
            <button className="send" disabled aria-label="发送（T44 接入前占位）">
              ↑
            </button>
            <div className="composer-foot">
              <span>COMPOSER · SKELETON</span>
              <span>对话流 · T44</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
