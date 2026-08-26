import { useState } from 'react'

interface BookCreated { ok: true; root: string; bookId: string }
interface LedgerRow { kind: string; event?: { type?: string; taskRef?: string }; type?: string }

export function App(): JSX.Element {
  const [title, setTitle] = useState('未命名之书')
  const [book, setBook] = useState<{ root: string; bookId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<readonly string[]>([])
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
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
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
        {book !== null && <p style={{ color: '#1a7f37' }}>已建：根 {book.root} · 书 {book.bookId}</p>}
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
