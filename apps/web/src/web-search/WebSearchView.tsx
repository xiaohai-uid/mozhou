/**
 * 联网搜索（WebSearchView）视图（实现票 T53）：
 * 创作资料检索、历史民俗背景、修仙神话体系与桥段灵感速查看板。
 *
 * 数据面（/api/web-search 中间件直出）：
 * - POST /api/web-search {query?} → WebSearchResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { WebSearchResponse } from '../../server/api'
import { post } from '../lib/post'

export function WebSearchView(): JSX.Element {
  const [data, setData] = useState<WebSearchResponse | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleSearch = useCallback(async (searchQuery: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await post<WebSearchResponse>('/api/web-search', { query: searchQuery })
      setData(res)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void handleSearch('')
  }, [handleSearch])

  const handleCopySnippet = (id: string, text: string): void => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <section className="center solo" aria-label="web-search-view">
      <div className="chapterbar">
        <h1>联网搜索</h1>
        <span className="meta">创作资料库 · 设定背景速查</span>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="search-error">
            错误：{error}
          </p>
        )}

        {/* 检索输入框 */}
        <section className="wb-section" data-testid="search-input-section">
          <h2>设定资料检索</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>输入关键词检索历史/神话/体系设定</b>
                <span className="mono muted">百科 · 古籍 · 设定速查</span>
              </div>
              <div className="actions">
                <input
                  className="control"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSearch(query)
                  }}
                  placeholder="搜索唐代官制、山海经、金丹品阶、克苏鲁神话…"
                  style={{ flex: 1, minWidth: 200 }}
                  aria-label="资料检索输入"
                />
                <button
                  className="btn-primary"
                  onClick={() => { void handleSearch(query) }}
                  disabled={busy}
                >
                  {busy ? '检索中…' : '搜索资料'}
                </button>
              </div>

              {data?.ok && data.hotQueries && (
                <div className="actions" style={{ marginTop: 10, alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <span className="mono muted">热门检索：</span>
                  {data.hotQueries.map((hq) => (
                    <button
                      key={hq}
                      className="btn"
                      style={{ fontSize: 9, padding: '2px 6px' }}
                      onClick={() => {
                        setQuery(hq)
                        void handleSearch(hq)
                      }}
                    >
                      {hq}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 501 / 未配置状态提示 */}
        {data !== null && !data.ok && (
          <section className="wb-section" data-testid="search-unavailable-section">
            <div className="card-shell">
              <div className="card" style={{ borderColor: 'var(--border-warn, #eab308)' }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-muted, #a1a1aa)' }}>
                  ⚠️ {data.error}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 搜索结果列表 */}
        {data !== null && data.ok && (
          <section className="wb-section" data-testid="search-results-section">
            <h2>检索结果 ({data.results.length})</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="search-results-list">
              {data.results.map((item) => (
                <div className="card-shell" key={item.id} style={{ marginBottom: 0 }}>
                  <div className="card">
                    <div className="card-title">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <b style={{ fontSize: 13 }}>{item.title}</b>
                        <span className="tag">{item.category}</span>
                      </div>
                      <span className="mono muted">来源: {item.source}</span>
                    </div>

                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.6 }}>
                      {item.snippet}
                    </p>

                    <div className="finding" style={{ marginTop: 8 }}>
                      <b>📖 详尽资料：</b>
                      <span style={{ fontSize: 11, marginLeft: 4 }}>{item.detail}</span>
                    </div>

                    <div className="actions" style={{ marginTop: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {item.tags.map((t) => (
                          <span key={t} className="cap-badge pending" style={{ fontSize: 9 }}>
                            #{t}
                          </span>
                        ))}
                      </div>
                      <button
                        className="btn"
                        style={{ fontSize: 9, padding: '3px 8px' }}
                        onClick={() => handleCopySnippet(item.id, `${item.title}：${item.detail}`)}
                      >
                        {copiedId === item.id ? '已复制 ✓' : '摘录资料'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
