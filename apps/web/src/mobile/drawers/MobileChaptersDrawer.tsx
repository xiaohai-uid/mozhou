/**
 * 章节目录抽屉内容（Ink Realm · P1-3 链 1）：
 * 直读 /api/works 真实章节摘要；点章 → onSelectChapter + 关抽屉。
 * 无书/无章节时诚实空态，不伪造目录。
 */
import { useEffect, useState } from 'react'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { WorksChapterSummary } from '../../../server/api'

export interface MobileChaptersDrawerProps {
  book: BookInfo | null
  chapterIndex: number
  onSelectChapter: (index: number) => void
  onClose: () => void
}

export function MobileChaptersDrawer({
  book,
  chapterIndex,
  onSelectChapter,
  onClose,
}: MobileChaptersDrawerProps): JSX.Element {
  const [chapters, setChapters] = useState<readonly WorksChapterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (book === null) {
      setChapters(null)
      return
    }
    let mounted = true
    void post<{ ok: boolean; chapters: readonly WorksChapterSummary[] }>('/api/works', { root: book.root })
      .then((data) => {
        if (mounted) setChapters(data.chapters ?? [])
      })
      .catch((cause) => {
        if (mounted) setError((cause as Error).message)
      })
    return () => {
      mounted = false
    }
  }, [book])

  if (book === null) {
    return (
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>尚未建书</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          先在工作台建立作品，章节目录会在此呈现真实章节。
        </div>
      </div>
    )
  }

  if (error !== null) {
    return (
      <div className="mobile-inline-note err" style={{ margin: 0 }} role="alert">
        章节目录读取失败：{error}
      </div>
    )
  }

  if (chapters === null) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-muted-mobile)', padding: '8px 2px' }}>读取章节目录…</div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>当前作品尚无章节</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
          在创作 Hub 发送首段生成指令后，真实章节会出现在这里。
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="mobile-chapters-list">
      {chapters.map((ch) => {
        const isCurrent = ch.chapterIndex === chapterIndex
        return (
          <button
            key={ch.chapterIndex}
            type="button"
            className="mobile-card"
            style={{
              margin: 0,
              padding: '12px 14px',
              textAlign: 'left',
              cursor: 'pointer',
              background: isCurrent ? 'rgba(114, 201, 196, 0.08)' : 'var(--surface-core-mobile)',
              border: isCurrent ? '1px solid rgba(114, 201, 196, 0.5)' : '1px solid var(--hairline-subtle-mobile)',
            }}
            aria-current={isCurrent || undefined}
            data-testid="mobile-chapter-row"
            onClick={() => {
              onSelectChapter(ch.chapterIndex)
              onClose()
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
                第 {ch.chapterIndex} 章 · {ch.title}
              </span>
              <span
                className="mobile-tag"
                style={ch.phase === 'committed' ? { color: 'var(--emerald-mobile)' } : { color: 'var(--gold-mobile)' }}
              >
                {ch.phase === 'committed' ? '定稿' : '草稿'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
              {ch.wordCount} 字 · Rev {ch.revision}
            </div>
          </button>
        )
      })}
    </div>
  )
}
