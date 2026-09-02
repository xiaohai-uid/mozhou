/**
 * 书架（本地书库）视图：扫描父目录下含 book.json 的子目录为书库，
 * 支持开书（切到该书）与书源搜索导入（输入书名 → 本地建书落地）。
 *
 * 数据面（/api 中间件直出，组件 type-only 直引契约形状，零 any）：
 * - /api/library          {parentDir} → 书库扫描（root/bookId/title/chapterCount）
 * - /api/library.open     {root}      → 校验书根返回 BookInfo（切书）
 * - /api/library.import   {parentDir, title} → 书源导入建书
 *
 * 呈现纪律：无书库目录时显式空态 + 引导；导入书名空/重名冲突显式报错；
 * skipped（坏 book.json 书）显式提示，不静默。
 */
import { useCallback, useEffect, useState } from 'react'
import type { LibraryResponse, LibraryOpenResponse } from '../../server/api'
import { post } from '../lib/post'
import type { BookInfo } from '../shell/workbenchStorage'

export function BookshelfView({
  parentDir,
  currentRoot,
  onSwitchBook,
}: {
  /** 书库父目录（当前书父目录；无书时为 null 显式引导）。 */
  parentDir: string | null
  /** 当前打开的书根（列表高亮）。 */
  currentRoot: string | null
  /** 开书回调：App 切书并记忆。 */
  onSwitchBook: (book: BookInfo) => void
}): JSX.Element {
  const [books, setBooks] = useState<LibraryResponse['books']>([])
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importTitle, setImportTitle] = useState('')
  const [importing, setImporting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (parentDir === null) return
    setBusy(true)
    setError(null)
    try {
      const data = await post<LibraryResponse>('/api/library', { parentDir })
      setBooks(data.books)
      setSkipped(data.skipped.length)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [parentDir])

  useEffect(() => { void load() }, [load])

  const handleOpen = async (root: string): Promise<void> => {
    setError(null)
    try {
      const data = await post<LibraryOpenResponse>('/api/library.open', { root })
      onSwitchBook({ root: data.root, bookId: data.bookId, title: data.title })
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const handleImport = async (): Promise<void> => {
    const title = importTitle.trim()
    if (parentDir === null || title.length === 0 || importing) return
    setImporting(true)
    setError(null)
    try {
      const data = await post<LibraryOpenResponse>('/api/library.import', { parentDir, title })
      await load()
      onSwitchBook({ root: data.root, bookId: data.bookId, title: data.title })
      setImportTitle('')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setImporting(false)
    }
  }

  if (parentDir === null) {
    return (
      <section className="center solo" aria-label="bookshelf-view">
        <div className="chapterbar">
          <h1>书源书架</h1>
        </div>
        <div className="conversation">
          <div className="card-shell">
            <div className="card" data-testid="bookshelf-empty">
              <div className="card-title">
                <b>书架暂不可用</b>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.8 }}>
                书架 = 本地书库：先建书（工作台或 Wizard），书架会以该书所在目录为书库根，扫描并列出全部书籍。
              </p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="center solo" aria-label="bookshelf-view">
      <div className="chapterbar">
        <h1>书源书架</h1>
        <span className="meta">本地书库 · {books.length} 本</span>
      </div>

      <div className="conversation">
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn" onClick={() => { void load() }} disabled={busy}>
            {busy ? '扫描中…' : '刷新书库'}
          </button>
          <span className="mono muted" style={{ alignSelf: 'center' }}>
            书库根：{parentDir}
          </span>
        </div>
        {error !== null && (
          <p className="wb-error" role="alert">
            错误：{error}
          </p>
        )}
        {skipped > 0 && (
          <p className="wb-error" role="alert" data-testid="bookshelf-skipped">
            有 {skipped} 个目录 book.json 不可读已跳过——显式提示，不静默。
          </p>
        )}

        <section className="wb-section" data-testid="bookshelf-import">
          <h2>书源搜索导入</h2>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>从书源建书（本地落地）</b>
                <span className="mono muted">零外部抓取 · 书名为输入</span>
              </div>
              <div className="actions">
                <input
                  className="control"
                  value={importTitle}
                  onChange={(event) => setImportTitle(event.target.value)}
                  disabled={importing}
                  aria-label="书源书名"
                  placeholder="输入书名或书源 URL 中识别到的书名…"
                  style={{ flex: 1, minWidth: 180 }}
                />
                <button
                  className="btn-primary"
                  onClick={() => { void handleImport() }}
                  disabled={importing || importTitle.trim().length === 0}
                >
                  {importing ? '导入中…' : '导入书架'}
                </button>
              </div>
              <p className="mono muted" style={{ margin: '10px 0 0' }}>
                导入 = 在书库根新建本地书（book.json + 大纲骨架），随后可进工作台续写。
              </p>
            </div>
          </div>
        </section>

        <section className="wb-section" data-testid="bookshelf-list">
          <h2>本地书库</h2>
          {!busy && books.length === 0 && (
            <p className="muted" data-testid="bookshelf-none" style={{ margin: 0 }}>
              书库根下暂无书籍——用上方导入建第一本，或到工作台建书后回来自动收录。
            </p>
          )}
          {books.map((entry) => (
            <div className="card-shell" key={entry.root}>
              <div className="card">
                <div className="card-title">
                  <b>{entry.title}</b>
                  <span className="mono muted">{entry.chapterCount} 章</span>
                </div>
                <p className="mono muted" style={{ margin: '6px 0 0' }}>
                  {entry.bookId} · {entry.root}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button
                    className="btn"
                    data-testid="bookshelf-open"
                    data-root={entry.root}
                    onClick={() => { void handleOpen(entry.root) }}
                    disabled={entry.root === currentRoot}
                  >
                    {entry.root === currentRoot ? '当前打开' : '打开'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </section>
  )
}