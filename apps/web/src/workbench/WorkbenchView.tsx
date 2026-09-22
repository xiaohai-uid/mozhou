/**
 * 中栏工作台（实现票 T40 · ADR-0027）。
 * 对话区骨架 + 建书/账本 + 创作辅助工具。所有状态文案必须来自真实数据；
 * 未接入的数据指标不得以示例数值伪装成当前用户状态。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'
import { DialogueStream } from './DialogueStream'
import { ProseEditorPanel } from './editor/ProseEditorPanel'
import { syncSha256Hex } from './lib/sha256'
import { DesktopToolModals, type DesktopModalType } from '../shell/DesktopToolModals'
import type { BookInfo } from '../shell/workbenchStorage'
import type { WorksChapterSummary } from '../../server/api'

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
  chapters,
}: {
  book: BookInfo | null
  onBookCreated: (book: BookInfo) => void
  chapterIndex?: number
  onChapterIndexChange?: (chapterIndex: number) => void
  /** 章节轨数据（/api/works 真实章节摘要）；未提供时不渲染（测试/无书面）。 */
  chapters?: readonly WorksChapterSummary[] | undefined
}): JSX.Element {
  const [title, setTitle] = useState('未命名之书')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [events, setEvents] = useState<readonly string[]>([])
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [activeModal, setActiveModal] = useState<DesktopModalType>(null)
  const [editorSelection, setEditorSelection] = useState<{
    from: number
    to: number
    selectedTextHash: string
  } | undefined>(undefined)

  // 切书或切章时清空选区
  useEffect(() => {
    setEditorSelection(undefined)
  }, [book?.bookId, book?.root, chapterIndex])

  const handleSelectionChange = useCallback(
    (sel: { from: number; to: number; selectedText: string } | null) => {
      if (sel === null || sel.from >= sel.to || sel.selectedText.length === 0) {
        setEditorSelection(undefined)
      } else {
        const hash = syncSha256Hex(sel.selectedText)
        setEditorSelection({ from: sel.from, to: sel.to, selectedTextHash: hash })
      }
    },
    [],
  )

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

  const currentChapter = chapters?.find((chapter) => chapter.chapterIndex === chapterIndex)
  const chapterWordTotal = chapters?.reduce((total, chapter) => total + chapter.wordCount, 0) ?? 0

  return (
    <section className="center">
      <div className="chapterbar">
        <div className="chapterbar-title">
          <span className="chapterbar-kicker">
            {book === null ? 'NOVEL STUDIO' : currentChapter !== undefined ? `CH ${String(chapterIndex).padStart(2, '0')} · ${currentChapter.title}` : `CH ${String(chapterIndex).padStart(2, '0')}`}
          </span>
          <h1>{book === null ? '未命名之书' : `《${book.title}》`}</h1>
        </div>
        <span className="meta">
          {book === null
            ? 'AI 负责生成与校验，你负责方向与最终裁决'
            : currentChapter !== undefined
              ? `${currentChapter.wordCount} 字 · r${currentChapter.revision} · ${currentChapter.phase === 'committed' ? '已定稿' : currentChapter.phase === 'draft' ? '草稿' : '规划'}`
              : 'BOOK ' + book.bookId.slice(0, 8)}
        </span>

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
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setActiveModal('history')}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z" /></svg>
            时光机 Diff
          </button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setActiveModal('inspiration')}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
            灵感工坊
          </button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setActiveModal('export')}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>
            导出排版
          </button>
          <button className="btn" style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setActiveModal('compliance')}>
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>
            敏感词审查
          </button>
        </div>
      </div>

      <div className="conversation studio-conversation">
        <div className={'studio-workbench' + (book !== null ? '' : ' no-chapters')}>
          {book !== null && (
            <aside className="chapter-dock" aria-label="章节目录">
              <div className="chapter-dock-head">
                <div>
                  <span>CHAPTERS</span>
                  <strong>章节</strong>
                </div>
                <b>{chapters?.length ?? 0}</b>
              </div>
              <div className="chap-rail" data-testid="chapter-rail">
                {chapters?.map((ch) => (
                  <button
                    key={ch.chapterIndex}
                    type="button"
                    className={'chap-card' + (ch.chapterIndex === chapterIndex ? ' current' : '')}
                    aria-current={ch.chapterIndex === chapterIndex || undefined}
                    onClick={() => onChapterIndexChange?.(ch.chapterIndex)}
                  >
                    <span className="cn">{String(ch.chapterIndex).padStart(2, '0')}</span>
                    <span className="ct">{ch.title}</span>
                    <span className="cm">
                      {ch.wordCount} 字 · {ch.phase === 'committed' ? '已定稿' : ch.phase === 'draft' ? '草稿' : '规划'}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="chap-card chap-add"
                  aria-label="新建下一章"
                  onClick={() => {
                    const maxIndex = chapters && chapters.length > 0 ? Math.max(...chapters.map((c) => c.chapterIndex)) : 0
                    onChapterIndexChange?.(maxIndex + 1)
                  }}
                  style={{
                    border: '1px dashed var(--hairline-strong)',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span className="cn">+</span>
                  <span className="ct">新建第 {(chapters && chapters.length > 0 ? Math.max(...chapters.map((c) => c.chapterIndex)) : 0) + 1} 章</span>
                  <span className="cm">开启新章草稿</span>
                </button>
              </div>
              <div className="chapter-dock-foot">
                <span>{chapterWordTotal.toLocaleString('zh-CN')} 字</span>
                <span>故事仍在生长</span>
              </div>
            </aside>
          )}

          <div className="studio-canvas">
            <div className="studio-editor-scroll">
              <header className="studio-canvas-head">
                <div>
                  <span className="studio-eyebrow">ACTIVE DRAFT · CH {String(chapterIndex).padStart(2, '0')}</span>
                  <h2>{currentChapter?.title ?? (book === null ? '从一个念头开始' : `第 ${chapterIndex} 章`)}</h2>
                </div>
                <p>正文是作品本体，AI 只在需要时进入。</p>
              </header>

              <ProseEditorPanel book={book} chapterIndex={chapterIndex} onSelectionChange={handleSelectionChange} />

            {book === null ? (
              <section className="wb-section studio-create-book" data-testid="create-book">
            <div className="card-shell" style={{ maxWidth: 580, margin: '24px auto' }}>
              <div className="card" style={{ padding: '28px 32px', textAlign: 'center' }}>
                <div className="create-book-mark" aria-hidden="true">墨</div>
                <h2 className="create-book-title">建立 AI 长篇创作空间</h2>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 18px', lineHeight: 1.6 }}>
                  给出故事方向、边界与目标，墨舟负责生成候选、维护连续性与质量证据，你保留最终裁决。
                </p>
                <div className="actions" style={{ maxWidth: 420, margin: '0 auto', display: 'flex', gap: 8 }}>
                  <input
                    className="control"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={createBusy}
                    aria-label="作品名"
                    placeholder="输入小说书名 (如：假神真显灵、万道祖师...)"
                    style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13 }}
                  />
                  <button className="btn-primary" onClick={() => void handleCreateBook()} disabled={createBusy} style={{ padding: '8px 18px', fontSize: 13, whiteSpace: 'nowrap' }}>
                    {createBusy ? '创建中…' : '创建'}
                  </button>
                </div>
                {createError !== null && <p className="wb-error" role="alert" style={{ marginTop: 10 }}>错误：{createError}</p>}
              </div>
            </div>
            <div data-testid="ledger" style={{ display: 'none' }}>
              <button className="btn" onClick={() => void handleRefreshLedger()} disabled>刷新账本</button>
            </div>
              </section>
            ) : (
              <details className="card-shell studio-ledger" style={{ marginTop: 24, cursor: 'pointer' }}>
            <summary style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-faint)', outline: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>作品管理与本地账本记录</span>
              <span style={{ fontSize: 10 }}>展开 ▾</span>
            </summary>
            <div style={{ padding: '10px 14px' }}>
              <section className="wb-section" data-testid="create-book" style={{ border: 'none', padding: 0 }}>
                <div className="card" style={{ padding: 14 }}>
                  <div className="card-title">
                    <b>作品元数据</b>
                    <span className="mono muted">已建</span>
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
                  <p data-testid="created-book" className="mono muted" style={{ margin: '10px 0 0' }}>
                    已建：根 {book.root} · 书 {book.bookId}
                  </p>
                  {createError !== null && <p className="wb-error" role="alert">错误：{createError}</p>}
                </div>
              </section>

              <section className="wb-section" data-testid="ledger" style={{ border: 'none', padding: '12px 0 0' }}>
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
              </details>
            )}
            </div>

            <section className="ai-console" aria-labelledby="ai-production-title">
              <div className="ai-console-head">
                <div>
                  <span className="ai-production-kicker">MOZHOU · AI COPILOT</span>
                  <h2 id="ai-production-title">把下一步交给墨舟</h2>
                </div>
                <div className="ai-production-flow" aria-label="AI 创作流程">
                  <span>意图</span><i aria-hidden="true">→</i>
                  <span>候选</span><i aria-hidden="true">→</i>
                  <span>采纳</span><i aria-hidden="true">→</i>
                  <span>质量门</span>
                </div>
              </div>
              <div id="dialogue-panel" data-testid="dialogue-panel" className="ai-console-body">
                <DialogueStream book={book} chapterIndex={chapterIndex} selection={editorSelection} />
              </div>
            </section>
          </div>
        </div>
      </div>

      <DesktopToolModals activeModal={activeModal} onClose={() => setActiveModal(null)} />
    </section>
  )
}
