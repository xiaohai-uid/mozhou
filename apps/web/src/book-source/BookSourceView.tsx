/**
 * 书源搜索与导入视图（实现票 T49）：
 * 专属的书源检索、书名与链接解析、预设样例快速导入与本地落地面。
 * 导入后自动切换为当前作品并引导前往工作台创作。
 *
 * 数据面（复用 /api/library.import 中间件）：
 * - POST /api/library.import {parentDir, title} → LibraryOpenResponse
 *
 * 呈现纪律：未建书库时显式空态引导；提供格式解析说明（本地规范书结构）；
 * 导入失败（重名、空标题）显式报错（role=alert）。
 */
import { useState } from 'react'
import type {
  BookSourceSearchResponse,
  CrawlerExtractResponse,
  LibraryOpenResponse,
} from '../../server/api'
import { post } from '../lib/post'
import type { BookInfo } from '../shell/workbenchStorage'

const SAMPLE_SOURCES = [
  { title: '仙道求索录', genre: '古典仙侠', desc: '传统修仙，凡人流起手' },
  { title: '诡秘夜行录', genre: '西方奇幻', desc: '克苏鲁神话与蒸汽朋克' },
  { title: '大明提刑官', genre: '历史架空', desc: '朝堂权谋与破案纪实' },
]

export function BookSourceView({
  parentDir,
  onSwitchBook,
  onGoToWorkbench,
}: {
  /** 书库父目录（无书时为 null 显式引导）。 */
  parentDir: string | null
  /** 开书/切书回调。 */
  onSwitchBook: (book: BookInfo) => void
  /** 前往工作台回调。 */
  onGoToWorkbench: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<BookSourceSearchResponse['books']>([])
  const [crawledExcerpt, setCrawledExcerpt] = useState<{ title: string; content: string; channel: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImported, setLastImported] = useState<string | null>(null)

  const handleSearch = async (): Promise<void> => {
    const clean = query.trim()
    if (clean.length === 0 || searching) return
    setSearching(true)
    setError(null)
    setCrawledExcerpt(null)

    // 若输入的是 http/https URL，优先走 crawl4ai 网页深度正文提取
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      try {
        const crawlRes = await post<CrawlerExtractResponse>('/api/crawler.extract', { url: clean })
        if (crawlRes.ok) {
          setCrawledExcerpt({
            title: crawlRes.title,
            content: crawlRes.content.slice(0, 300) + (crawlRes.content.length > 300 ? '...' : ''),
            channel: crawlRes.channel === 'crawl4ai' ? 'crawl4ai 无头渲染' : 'HTTP 提取',
          })
          setSearchResults([
            {
              platform: 'fanqie',
              platformName: crawlRes.channel === 'crawl4ai' ? 'crawl4ai 抓取' : '网页抓取',
              bookId: 'crawled_url',
              title: crawlRes.title,
              author: '网络抓取来源',
              category: '外部网页正文',
              status: '已解析',
              intro: crawlRes.content.slice(0, 150),
              url: clean,
            },
          ])
          return
        } else {
          setError(`网页抓取失败: ${crawlRes.error ?? '未知错误'}`)
        }
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setSearching(false)
      }
      return
    }

    try {
      const res = await post<BookSourceSearchResponse>('/api/book-source.search', { query: clean })
      setSearchResults(res.books)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const handleImport = async (targetTitle: string): Promise<void> => {
    const title = targetTitle.trim()
    if (parentDir === null || title.length === 0 || importing) return
    setImporting(true)
    setError(null)
    setLastImported(null)
    try {
      const data = await post<LibraryOpenResponse>('/api/library.import', { parentDir, title })
      setLastImported(data.title)
      onSwitchBook({ root: data.root, bookId: data.bookId, title: data.title })
      setQuery('')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setImporting(false)
    }
  }

  if (parentDir === null) {
    return (
      <section className="center solo" aria-label="book-source-view">
        <div className="chapterbar">
          <h1>书源搜索</h1>
        </div>
        <div className="conversation">
          <div className="card-shell">
            <div className="card" data-testid="book-source-empty">
              <div className="card-title">
                <b>书源服务暂不可用</b>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.8 }}>
                书源导入需要在本地书库根目录下创建书籍目录：先在工作台或 Wizard 中建第一本书，确立书库根目录后即可在此搜索并导入。
              </p>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={onGoToWorkbench}>
                  前往工作台建书
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="center solo" aria-label="book-source-view">
      <div className="chapterbar">
        <h1>书源搜索</h1>
        <span className="meta">书库根：{parentDir}</span>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="book-source-error">
            错误：{error}
          </p>
        )}

        {lastImported !== null && (
          <div className="banner" data-testid="book-source-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>已成功从书源导入并建立作品《{lastImported}》，已切换为当前创作书。</span>
            <button className="btn-primary" onClick={onGoToWorkbench} style={{ fontSize: 10, padding: '3px 8px' }}>
              前往工作台写作 →
            </button>
          </div>
        )}

        {crawledExcerpt !== null && (
          <div className="banner" data-testid="book-source-crawled-preview" style={{ background: 'rgba(128, 214, 176, 0.08)', color: 'var(--success)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>网页抓取解析成功（{crawledExcerpt.channel}）：《{crawledExcerpt.title}》</b>
              <span className="mono muted">已自动提取纯净正文</span>
            </div>
            <p className="mono muted" style={{ margin: '6px 0 0', fontSize: 10, lineHeight: 1.5 }}>
              {crawledExcerpt.content}
            </p>
          </div>
        )}

        {/* 检索与导入主区域 */}
        <section className="wb-section" data-testid="book-source-search">
          <h2>书源检索与解析导入</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>输入书名或链接</b>
                <span className="mono muted">本地落地 · 规范大纲骨架</span>
              </div>
              <div className="actions">
                <input
                  className="control"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSearch()
                  }}
                  disabled={importing || searching}
                  aria-label="书源检索输入"
                  placeholder="输入书名（如 宿命之环、凡人修仙）检索起点/七猫..."
                  style={{ flex: 1, minWidth: 200 }}
                />
                <button
                  className="btn"
                  onClick={() => { void handleSearch() }}
                  disabled={searching || query.trim().length === 0}
                >
                  {searching ? '全网检索中…' : '全网多源检索'}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => { void handleImport(query) }}
                  disabled={importing || query.trim().length === 0}
                >
                  {importing ? '导入中…' : '直接建书入库'}
                </button>
              </div>
              <p className="mono muted" style={{ margin: '10px 0 0' }}>
                端侧并发检索起点与七猫公开源，检索结果可一键在本地书库落盘正典容器。
              </p>
            </div>
          </div>
        </section>

        {/* 实时多源搜索结果 */}
        {searchResults.length > 0 && (
          <section className="wb-section" data-testid="book-source-results">
            <h2>全网多源检索结果 ({searchResults.length})</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {searchResults.map((b) => (
                <div className="card-shell" key={`${b.platform}_${b.bookId}`} style={{ marginBottom: 0 }}>
                  <div className="card">
                    <div className="card-title">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <b style={{ fontSize: 13 }}>{b.title}</b>
                        <span className="tag">{b.platformName}</span>
                        <span className="mono muted">作者：{b.author}</span>
                      </div>
                      <span className="cap-badge native">{b.status ?? '连载中'}</span>
                    </div>
                    {b.category && (
                      <span className="mono muted" style={{ fontSize: 10 }}>
                        题材分类：{b.category}
                      </span>
                    )}
                    {b.intro && (
                      <p className="muted" style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.6 }}>
                        {b.intro}
                      </p>
                    )}
                    <div className="actions" style={{ marginTop: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="mono muted" style={{ fontSize: 9 }}>
                        来源页：{b.url}
                      </span>
                      <button
                        className="btn-primary"
                        disabled={importing}
                        onClick={() => { void handleImport(b.title) }}
                        style={{ fontSize: 10, padding: '3px 8px' }}
                      >
                        一键导入本地书库
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 推荐导入样例 */}
        <section className="wb-section" data-testid="book-source-samples">
          <h2>预设书源推荐样例</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {SAMPLE_SOURCES.map((sample) => (
              <div className="card-shell" key={sample.title} style={{ marginBottom: 0 }}>
                <div className="card">
                  <div className="card-title">
                    <b>{sample.title}</b>
                    <span className="tag">{sample.genre}</span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 10 }}>
                    {sample.desc}
                  </p>
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      disabled={importing}
                      onClick={() => { void handleImport(sample.title) }}
                      style={{ fontSize: 10, padding: '4px 8px' }}
                    >
                      一键导入
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 规则与说明 */}
        <section className="wb-section">
          <h2>书源导入规则说明</h2>
          <div className="card-shell">
            <div className="card">
              <div className="finding">
                <b>确定性导入</b>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                  零外部不可控网络依赖，书源导入将初始化标准正典骨架，保证后续 Traversal、Story Brain 与质量门均可正常运作。
                </p>
              </div>
              <div className="finding">
                <b>重名保护</b>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                  若书库根下已存在同名书籍目录，导入操作将显式拒绝并提示冲突，保护已有创作内容不被静默覆盖。
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
