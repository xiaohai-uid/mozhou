/**
 * 我的作品（作品概览与章节目录）视图（实现票 T47）：
 * 读当前作品的结构化元信息、大纲骨架、章节目录与创作进度统计，
 * 支持一键前往工作台写作与章节状态透视。
 *
 * 数据面（/api/works 中间件直出，组件 type-only 直引契约形状）：
 * - POST /api/works {root} → WorksOverviewResponse
 *
 * 呈现纪律：未建书时显式空态与引导；章节列表呈现章序号、标题、
 * 相位（草稿/已提交）与字数统计；统计面板展示总字数、章数与实体数。
 */
import { useCallback, useEffect, useState } from 'react'
import type { WorksOverviewResponse } from '../../server/api'
import { post } from '../lib/post'

export function WorksView({
  root,
  onGoToWorkbench,
}: {
  /** 当前书根（无书时为 null 显式引导）。 */
  root: string | null
  /** 前往工作台回调。 */
  onGoToWorkbench: () => void
}): JSX.Element {
  const [data, setData] = useState<WorksOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (root === null) return
    setBusy(true)
    setError(null)
    try {
      const res = await post<WorksOverviewResponse>('/api/works', { root })
      setData(res)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  if (root === null) {
    return (
      <section className="center solo" aria-label="works-view">
        <div className="chapterbar">
          <h1>我的作品</h1>
        </div>
        <div className="conversation">
          <div className="card-shell">
            <div className="card" data-testid="works-empty">
              <div className="card-title">
                <b>尚未选择或建立作品</b>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.8 }}>
                我的作品 = 当前作品概览与章节全景：先在工作台或 Wizard 中建书，再回到本面板查看完整目录与统计。
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
    <section className="center solo" aria-label="works-view">
      <div className="chapterbar">
        <h1>我的作品</h1>
        <span className="meta">
          {data !== null ? `${data.book.title} · ${data.stats.totalChapters} 章 · ${data.stats.totalWords} 字` : '加载中…'}
        </span>
        <div className="save">
          <button className="btn" onClick={onGoToWorkbench} style={{ fontSize: 10, padding: '4px 8px' }}>
            前往工作台写作 →
          </button>
        </div>
      </div>

      <div className="conversation">
        {busy && data === null && (
          <p className="muted" style={{ margin: 0 }} data-testid="works-busy">
            读取作品概览…
          </p>
        )}
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="works-error">
            错误：{error}
          </p>
        )}

        {data !== null && (
          <>
            {/* 作品元信息与统计看板 */}
            <section className="wb-section" data-testid="works-overview">
              <h2>作品信息</h2>
              <div className="card-shell">
                <div className="card">
                  <div className="card-title">
                    <b>{data.book.title}</b>
                    <span className="mono muted">ID: {data.book.id}</span>
                  </div>
                  <div className="actions" style={{ marginTop: 4, gap: 16 }}>
                    <span className="mono muted">
                      题材：{data.book.genres.length > 0 ? data.book.genres.join(' / ') : '通用网文'}
                    </span>
                    <span className="mono muted">
                      创建时间：{data.book.createdAt.slice(0, 10)}
                    </span>
                    <span className="mono muted">
                      实体卡：{data.stats.entityCount} 个
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: 10,
                      marginTop: 12,
                      padding: '10px 0 0',
                      borderTop: '1px solid var(--hairline)',
                    }}
                  >
                    <div>
                      <div className="mono muted">总字数</div>
                      <b style={{ fontSize: 16 }}>{data.stats.totalWords}</b>
                    </div>
                    <div>
                      <div className="mono muted">总章数</div>
                      <b style={{ fontSize: 16 }}>{data.stats.totalChapters}</b>
                    </div>
                    <div>
                      <div className="mono muted">已定稿</div>
                      <b style={{ fontSize: 16, color: 'var(--success)' }}>
                        {data.stats.committedChapters}
                      </b>
                    </div>
                    <div>
                      <div className="mono muted">草稿中</div>
                      <b style={{ fontSize: 16, color: 'var(--warning)' }}>
                        {data.stats.draftChapters}
                      </b>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 大纲骨架节点 */}
            <section className="wb-section" data-testid="works-outlines">
              <h2>大纲骨架</h2>
              <div className="card-shell">
                <div className="card">
                  <div className="card-title">
                    <b>大纲节点</b>
                    <span className="mono muted">{data.outlineNodes.length} 个节点</span>
                  </div>
                  {data.outlineNodes.map((node) => (
                    <div key={node.id} className="finding" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <b>{node.title}</b>
                        <span className="mono muted" style={{ marginLeft: 8 }}>
                          [{node.nodeType}]
                        </span>
                      </div>
                      <span className="tag">{node.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 章节全景列表 */}
            <section className="wb-section" data-testid="works-chapters">
              <h2>章节目录 ({data.chapters.length})</h2>
              {data.chapters.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  作品尚未创建正文章节，前往工作台即可开始撰写第一章。
                </p>
              ) : (
                data.chapters.map((ch) => (
                  <div className="card-shell" key={ch.chapterIndex}>
                    <div className="card">
                      <div className="card-title">
                        <b>
                          第 {ch.chapterIndex} 章 · {ch.title}
                        </b>
                        <span
                          className={
                            'cap-badge' + (ch.phase === 'committed' ? ' native' : ' pending')
                          }
                        >
                          {ch.phase === 'committed' ? '已定稿' : '草稿中'}
                        </span>
                      </div>
                      <div className="actions" style={{ marginTop: 6 }}>
                        <span className="mono muted">字数：{ch.wordCount} 字</span>
                        <span className="mono muted">修订版本：r{ch.revision}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </section>
  )
}
