import { useState } from 'react'
import type { EntityCardScan } from '@mozhou/data-plane'
import { QualityPanel } from './quality/QualityPanel'

interface BookCreated { ok: true; root: string; bookId: string }
interface LedgerRow { kind: string; event?: { type?: string; taskRef?: string }; type?: string }

export function App(): JSX.Element {
  const [title, setTitle] = useState('未命名之书')
  const [book, setBook] = useState<{ root: string; bookId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<readonly string[]>([])
  const [entityCards, setEntityCards] = useState<readonly EntityCardScan[]>([])
  const [entitiesLoaded, setEntitiesLoaded] = useState(false)
  const [entitiesBusy, setEntitiesBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string } & T
    if (!res.ok || data.ok === false) {
      throw new Error(data.error ?? '请求失败 (HTTP ' + res.status + ')')
    }
    return data
  }

  const handleCreateBook = async () => {
    setError(null)
    setBusy(true)
    try {
      const data = await post<BookCreated>('/api/book', { title })
      setBook({ root: data.root, bookId: data.bookId })
      setEntityCards([])
      setEntitiesLoaded(false)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleRefreshEntities = async () => {
    setError(null)
    if (book === null) return
    setEntitiesBusy(true)
    try {
      const data = await post<{ cards: readonly EntityCardScan[] }>('/api/story-brain.entities', { root: book.root })
      setEntityCards(data.cards)
      setEntitiesLoaded(true)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setEntitiesBusy(false)
    }
  }

  const handleRefreshLedger = async () => {
    setError(null)
    if (book === null) return
    try {
      const data = await post<{ events: readonly LedgerRow[] }>('/api/ledger', { root: book.root })
      setEvents(
        data.events.map((row) =>
          row.kind === 'task' ? (row.event?.type ?? 'task') : (row.type ?? row.kind),
        ),
      )
    } catch (cause) {
      setError((cause as Error).message)
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
    <main style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 28 }}>墨舟 · 新手引导台</h1>
      {error !== null && <p style={{ color: '#b3261e', background: '#fdecea', padding: 8 }}>错误：{error}</p>}
      <section style={{ marginTop: 24, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <h2>第 1 步：建书</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={() => void handleCreateBook()} disabled={busy} style={{ padding: '8px 16px' }}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
        {book !== null && (
          <p data-testid="created-book" style={{ color: '#1a7f37' }}>
            已建：根 {book.root} · 书 {book.bookId}
          </p>
        )}
      </section>
      {book !== null && <QualityPanel root={book.root} chapterIndex={1} />}
      <section
        data-testid="story-brain-entities"
        style={{ marginTop: 24, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}
      >
        <h2>Story Brain · 实体网格</h2>
        <button
          onClick={() => void handleRefreshEntities()}
          disabled={book === null || entitiesBusy}
          style={{ padding: '8px 16px' }}
        >
          {entitiesBusy ? '读取中…' : '刷新实体'}
        </button>
        {entitiesLoaded && entityCards.length === 0 && <p>暂无实体卡</p>}
        {Array.from(entityGroups.entries()).map(([cardType, cards]) => (
          <div key={cardType} style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>{cardType}</h3>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {cards.map((card) => (
                <article
                  key={card.ref}
                  data-entity-ref={card.ref}
                  style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}
                >
                  <strong>{card.name}</strong>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{card.ref}</div>
                  {card.brief !== null && <p style={{ marginBottom: 0 }}>{card.brief}</p>}
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section style={{ marginTop: 24, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <h2>账本可见（Phase 5 遍历/风格学习事件会出现在这里）</h2>
        <button onClick={() => void handleRefreshLedger()} disabled={book === null} style={{ padding: '8px 16px' }}>
          刷新账本
        </button>
        <ul style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
          {events.map((type, i) => (
            <li key={i}>{type}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
