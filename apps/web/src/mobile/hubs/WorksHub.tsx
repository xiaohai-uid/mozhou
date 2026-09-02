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
    if (!book) return
    let mounted = true
    setLoading(true)
    setError(null)

    post<WorksOverviewResponse>('/api/works', { root: book.root })
      .then((res) => {
        if (mounted) setData(res)
      })
      .catch((err) => {
        if (mounted) setError((err as Error).message)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [book])

  const totalWords = data?.stats.totalWords ?? 3420
  const chapterCount = data?.stats.totalChapters ?? 1
  const entityCount = data?.stats.entityCount ?? 14

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">卷</div>
          <div>
            <h1 className="mobile-hub-title">作品管理</h1>
            <div className="mobile-hub-subtitle">
              {book ? `《${book.title}》· 分卷与导出` : '分卷目录 · 篇章规划 · 导出排版'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="mobile-action-btn"
            onClick={() => onOpenDrawer('export')}
          >
            <ExportIcon className="svg-icon" />
            <span>导出</span>
          </button>
          <button
            type="button"
            className="mobile-action-btn"
            onClick={() => alert('新建章节已在本地书库就绪')}
          >
            <span>加章</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ margin: '10px 18px', color: 'var(--rose-mobile)', fontSize: 12 }}>
          提示：{error}
        </div>
      )}

      {loading && (
        <div style={{ padding: '10px 18px', color: 'var(--fg-muted-mobile)', fontSize: 12 }}>
          正在加载作品全景目录...
        </div>
      )}

      {/* 统计三格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          margin: '12px 18px',
        }}
      >
        <div
          style={{
            background: 'var(--surface-shell-mobile)',
            border: '1px solid var(--hairline-subtle-mobile)',
            borderRadius: 14,
            padding: '12px 8px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono-mobile)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--fg-pure-mobile)',
            }}
          >
            {totalWords.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
            正文字数
          </div>
        </div>

        <div
          style={{
            background: 'var(--surface-shell-mobile)',
            border: '1px solid var(--hairline-subtle-mobile)',
            borderRadius: 14,
            padding: '12px 8px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono-mobile)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--fg-pure-mobile)',
            }}
          >
            {chapterCount}/80
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
            已写/规划章
          </div>
        </div>

        <div
          style={{
            background: 'var(--surface-shell-mobile)',
            border: '1px solid var(--hairline-subtle-mobile)',
            borderRadius: 14,
            padding: '12px 8px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono-mobile)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--fg-pure-mobile)',
            }}
          >
            {entityCount}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
            角色与设定卡
          </div>
        </div>
      </div>

      {/* 文风画像入口 */}
      <div
        className="mobile-card"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
            篇章文风分析画像
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
            对白占比 42.8% · 快节奏叙事
          </div>
        </div>
        <button
          type="button"
          className="mobile-action-btn"
          onClick={() => onOpenDrawer('distill')}
        >
          查看画像
        </button>
      </div>

      {/* 目录列表 */}
      <div className="mobile-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--hairline-subtle-mobile)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {book ? `《${book.title}》章节目录` : '第一卷 · 龙国夜行篇'}
        </div>

        {data?.chapters && data.chapters.length > 0 ? (
          data.chapters.map((ch, idx) => (
            <div
              key={ch.chapterIndex}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                borderBottom:
                  idx === data.chapters.length - 1
                    ? 'none'
                    : '1px solid var(--hairline-subtle-mobile)',
                background: 'var(--surface-shell-mobile)',
                cursor: 'pointer',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-prose-mobile)',
                    fontSize: 14.5,
                    color: 'var(--fg-pure-mobile)',
                  }}
                >
                  第 {String(ch.chapterIndex).padStart(3, '0')} 章 {ch.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
                  {ch.wordCount.toLocaleString()} 字 · Rev {ch.revision}
                </div>
              </div>
              <span
                className={`mobile-tag ${
                  ch.phase === 'committed'
                    ? 'green'
                    : ch.phase === 'draft'
                      ? 'gold'
                      : 'accent'
                }`}
              >
                {ch.phase === 'committed' ? '定稿' : ch.phase === 'draft' ? '草稿' : '规划'}
              </span>
            </div>
          ))
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                borderBottom: '1px solid var(--hairline-subtle-mobile)',
                background: 'var(--surface-shell-mobile)',
                cursor: 'pointer',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-prose-mobile)',
                    fontSize: 14.5,
                    color: 'var(--fg-pure-mobile)',
                  }}
                >
                  第 001 章 破庙装神与显灵契机
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
                  3,420 字 · 已定稿
                </div>
              </div>
              <span className="mobile-tag green">定稿</span>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                background: 'var(--surface-shell-mobile)',
                cursor: 'pointer',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-prose-mobile)',
                    fontSize: 14.5,
                    color: 'var(--fg-primary-mobile)',
                  }}
                >
                  第 002 章 县衙大堂上的测灵镜
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
                  规划 3,200 字 · 细纲就绪
                </div>
              </div>
              <span className="mobile-tag gold">细纲</span>
            </div>
          </>
        )}
      </div>
    </>
  )
}
