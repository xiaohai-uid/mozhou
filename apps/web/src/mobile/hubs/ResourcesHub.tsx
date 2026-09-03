import { useState } from 'react'
import { SearchIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { BookSourceSearchResponse, CrawledBook } from '../../../server/api'

export interface ResourcesHubProps {
  book: BookInfo | null
  onOpenDrawer: (type: ActiveDrawerType) => void
}

export function ResourcesHub({}: ResourcesHubProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [books, setBooks] = useState<readonly CrawledBook[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importingUrl, setImportingUrl] = useState<string | null>(null)

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim() || searching) return
    setSearching(true)
    setError(null)
    try {
      const res = await post<BookSourceSearchResponse>('/api/book-source.search', { query: query.trim() })
      setBooks(res.books ?? [])
      setSearched(true)
      if (res.degraded) setError(res.notes.join('；') || '部分书源当前不可用。')
    } catch (cause) {
      setBooks([])
      setSearched(true)
      setError((cause as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const handleImportBook = async (book: CrawledBook) => {
    if (!book.url) {
      alert('该检索结果没有可提取 URL。')
      return
    }
    setImportingUrl(book.url)
    try {
      const res = await post<{ ok: boolean; title?: string; error?: string }>('/api/crawler.extract', { url: book.url })
      if (res.ok) alert(`《${book.title}》内容提取成功。后续拆解能力尚未接入。`)
      else alert(`《${book.title}》提取失败：${res.error ?? '未知错误'}`)
    } catch (cause) {
      alert(`《${book.title}》提取失败：${(cause as Error).message}`)
    } finally {
      setImportingUrl(null)
    }
  }

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">源</div>
          <div>
            <h1 className="mobile-hub-title">资源与对标书库</h1>
            <div className="mobile-hub-subtitle">仅展示真实书源检索返回的数据</div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSearch} style={{ margin: '12px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-shell-mobile)', border: '1px solid var(--hairline-crisp-mobile)', borderRadius: 12, padding: '9px 14px' }}>
          <SearchIcon className="svg-icon" style={{ color: 'var(--fg-muted-mobile)' }} />
          <input
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--fg-pure-mobile)', fontSize: 13.5 }}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对标作品…"
          />
          <button type="submit" className="mobile-tag accent" style={{ border: 'none', cursor: 'pointer' }} disabled={searching || !query.trim()}>
            {searching ? '搜索中…' : '搜索'}
          </button>
        </div>
      </form>

      {error && <div className="mobile-card" style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>检索提示：{error}</div>}

      {books.map((book) => (
        <div key={book.bookId || book.url || book.title} className="mobile-card" style={{ display: 'flex', gap: 12, padding: 14 }}>
          <div style={{ width: 58, height: 78, borderRadius: 8, background: '#1e1b27', border: '1px solid var(--hairline-crisp-mobile)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-prose-mobile)', fontSize: 11.5, color: 'var(--fg-secondary-mobile)', textAlign: 'center', padding: 4, flexShrink: 0 }}>
            {book.title.slice(0, 6)}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--fg-pure-mobile)' }}>{book.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>
                {book.author} · {book.platformName || '来源未标注'} · {book.category || '分类未标注'}
              </div>
              {book.intro && <div style={{ fontSize: 11.5, color: 'var(--fg-secondary-mobile)', marginTop: 4 }}>{book.intro}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span className="mobile-tag gold">{book.status || '状态未标注'}</span>
              <button type="button" className="mobile-action-btn" style={{ padding: '3px 10px', fontSize: 11 }} disabled={!book.url || importingUrl === book.url} onClick={() => void handleImportBook(book)}>
                {importingUrl === book.url ? '提取中…' : '提取内容'}
              </button>
            </div>
          </div>
        </div>
      ))}

      {searched && !searching && books.length === 0 && (
        <div className="mobile-card">
          <b>未返回真实书源结果</b>
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
            不使用内置“推荐样例”补位，也不伪造榜单评分或热度。
          </div>
        </div>
      )}
    </>
  )
}
