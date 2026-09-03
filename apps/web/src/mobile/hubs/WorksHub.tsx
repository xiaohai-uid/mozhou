import { useEffect, useState } from 'react'
import { ExportIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { WorksOverviewResponse } from '../../../server/api'

export interface WorksHubProps {
  book: BookInfo | null
  onOpenDrawer: (type: ActiveDrawerType) => void
}

export function WorksHub({ book, onOpenDrawer }: WorksHubProps): JSX.Element {
  const [data, setData] = useState<WorksOverviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!book) {
      setData(null)
      return
    }
    let mounted = true
    setLoading(true)
    setError(null)
    post<WorksOverviewResponse>('/api/works', { root: book.root })
      .then((res) => { if (mounted) setData(res) })
      .catch((err) => { if (mounted) setError((err as Error).message) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [book])

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">卷</div>
          <div>
            <h1 className="mobile-hub-title">作品管理</h1>
            <div className="mobile-hub-subtitle">
              {book ? `《${book.title}》· 真实作品数据` : '先建立作品后查看章节与统计'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="mobile-action-btn" onClick={() => onOpenDrawer('export')}>
            <ExportIcon className="svg-icon" />
            <span>导出</span>
          </button>
          <button type="button" className="mobile-action-btn" disabled title="移动端加章尚未接入">
            <span>加章未接入</span>
          </button>
        </div>
      </div>

      {error && <div style={{ margin: '10px 18px', color: 'var(--rose-mobile)', fontSize: 12 }}>加载失败：{error}</div>}
      {loading && <div style={{ padding: '10px 18px', color: 'var(--fg-muted-mobile)', fontSize: 12 }}>正在加载作品数据…</div>}

      {data !== null ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '12px 18px' }}>
            <Stat value={data.stats.totalWords.toLocaleString()} label="正文字数" />
            <Stat value={String(data.stats.totalChapters)} label="已有章节" />
            <Stat value={String(data.stats.entityCount)} label="角色与设定卡" />
          </div>

          <div className="mobile-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>篇章文风分析画像</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>移动端画像详情尚未接入。</div>
            </div>
            <button type="button" className="mobile-action-btn" onClick={() => onOpenDrawer('distill')}>查看状态</button>
          </div>

          <div className="mobile-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline-subtle-mobile)', fontSize: 13, fontWeight: 600 }}>
              《{book?.title ?? data.book.title}》章节目录
            </div>
            {data.chapters.length > 0 ? data.chapters.map((ch, idx) => (
              <div
                key={ch.chapterIndex}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 16px',
                  borderBottom: idx === data.chapters.length - 1 ? 'none' : '1px solid var(--hairline-subtle-mobile)',
                  background: 'var(--surface-shell-mobile)',
                }}
              >
                <div>
                  <div style={{ fontFamily: 'var(--font-prose-mobile)', fontSize: 14.5, color: 'var(--fg-pure-mobile)' }}>
                    第 {String(ch.chapterIndex).padStart(3, '0')} 章 {ch.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
                    {ch.wordCount.toLocaleString()} 字 · Rev {ch.revision}
                  </div>
                </div>
                <span className={`mobile-tag ${ch.phase === 'committed' ? 'green' : ch.phase === 'draft' ? 'gold' : 'accent'}`}>
                  {ch.phase === 'committed' ? '定稿' : ch.phase === 'draft' ? '草稿' : '规划'}
                </span>
              </div>
            )) : (
              <div style={{ padding: 16, color: 'var(--fg-muted-mobile)', fontSize: 12 }}>当前作品尚无章节。</div>
            )}
          </div>
        </>
      ) : !loading && !error ? (
        <div className="mobile-card">
          <b>作品数据尚未载入</b>
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
            Technical Preview 不使用示例字数、章节、设定卡或文风指标作为当前作品数据。
          </div>
        </div>
      ) : null}
    </>
  )
}

function Stat({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div style={{ background: 'var(--surface-shell-mobile)', border: '1px solid var(--hairline-subtle-mobile)', borderRadius: 14, padding: '12px 8px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono-mobile)', fontSize: 18, fontWeight: 700, color: 'var(--fg-pure-mobile)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>{label}</div>
    </div>
  )
}
