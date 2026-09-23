/**
 * 网文扫榜（RankScanView）视图（实现票 T52）：
 * 多平台榜单（番茄小说热读榜 / 起点畅销榜）透视、
 * 热门风向词云与题材金手指钩子分析看板。
 *
 * 数据面（/api/rank-scan 中间件直出）：
 * - POST /api/rank-scan {} → RankScanResponse
 */
import { useCallback, useEffect, useState } from 'react'
import type { RankScanResponse, RankBoard } from '../../server/api'
import { post } from '../lib/post'

export function RankScanView(): JSX.Element {
  const [data, setData] = useState<RankScanResponse | null>(null)
  const [activeBoardId, setActiveBoardId] = useState<string>('fanqie_hot')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await post<RankScanResponse>('/api/rank-scan', {})
      setData(res)
      if (res.boards.length > 0 && !res.boards.some((b) => b.id === activeBoardId)) {
        const firstBoard = res.boards[0]
        if (firstBoard !== undefined) setActiveBoardId(firstBoard.id)
      }
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [activeBoardId])

  useEffect(() => {
    void load()
  }, [load])

  const currentBoard: RankBoard | undefined = data?.boards.find((b) => b.id === activeBoardId)

  return (
    <section className="center solo" aria-label="rank-scan-view">
      <div className="chapterbar">
        <h1>网文扫榜</h1>
        <span className="meta">多平台热榜透视 · 题材风向分析</span>
        <div className="save">
          <button className="btn" onClick={() => { void load() }} disabled={busy} style={{ fontSize: 10, padding: '4px 8px' }}>
            {busy ? '更新中…' : '刷新榜单'}
          </button>
        </div>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="rank-error">
            错误：{error}
          </p>
        )}

        {data?.degraded && data.note && (
          <div
            className="wb-warning"
            role="status"
            style={{
              padding: '8px 12px',
              marginBottom: 12,
              borderRadius: 6,
              background: 'rgba(217, 166, 95, 0.1)',
              border: '1px solid var(--warning)',
              color: 'var(--warning)',
              fontSize: 12,
            }}
          >
            提示：{data.note}
          </div>
        )}

        {data !== null && (
          <>
            {/* 热门题材风向 */}
            <section className="wb-section" data-testid="rank-trending">
              <h2>热门题材风向词</h2>
              <div className="actions" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
                {data.trendingKeywords.map((kw) => (
                  <span key={kw.name} className="cap-badge native">
                    #{kw.name} (热度 {kw.heat})
                  </span>
                ))}
              </div>
            </section>

            {/* 平台榜单切换 Tabs */}
            <section className="wb-section" data-testid="rank-boards">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2>主流平台热榜</h2>
                <div className="actions" style={{ marginTop: 0, gap: 6 }}>
                  {data.boards.map((b) => (
                    <button
                      key={b.id}
                      className={activeBoardId === b.id ? 'btn-primary' : 'btn'}
                      style={{ fontSize: 10, padding: '4px 10px' }}
                      onClick={() => setActiveBoardId(b.id)}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>

              {currentBoard !== undefined && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="rank-items">
                  {currentBoard.items.length === 0 ? (
                    <div className="card-shell" style={{ marginBottom: 0 }}>
                      <div className="card" style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-muted)' }}>
                        该榜单暂无可解析数据（实时源不可达或通道维护中）
                      </div>
                    </div>
                  ) : currentBoard.items.map((item) => (
                    <div className="card-shell" key={item.rank} style={{ marginBottom: 0 }}>
                      <div className="card">
                        <div className="card-title">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              className="tag"
                              style={{
                                background: item.rank === 1 ? 'rgba(242, 139, 155, 0.2)' : undefined,
                                color: item.rank === 1 ? 'var(--danger)' : undefined,
                                fontWeight: 700,
                              }}
                            >
                              Top {item.rank}
                            </span>
                            <b style={{ fontSize: 13 }}>{item.title}</b>
                            <span className="mono muted">作者：{item.author}</span>
                          </div>
                          <span className="cap-badge pending">{item.hotScore}</span>
                        </div>

                        <div className="actions" style={{ marginTop: 4, gap: 6 }}>
                          <span className="mono muted">分类：{item.category}</span>
                          {item.tags.map((t) => (
                            <span key={t} className="tag" style={{ fontSize: 9, padding: '2px 5px' }}>
                              {t}
                            </span>
                          ))}
                        </div>

                        <div className="finding" style={{ marginTop: 8 }}>
                          <b>💡 金手指：</b>
                          <span style={{ fontSize: 11, marginLeft: 4 }}>{item.goldenFinger}</span>
                        </div>
                        <div className="finding">
                          <b>🎯 一句话钩子：</b>
                          <span style={{ fontSize: 11, marginLeft: 4 }}>{item.oneLineHook}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  )
}
