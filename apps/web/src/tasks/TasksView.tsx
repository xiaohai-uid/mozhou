/**
 * 任务中心（流水审计与 Traversal 历史）视图（实现票 T48）：
 * 直读 .mozhou/events.jsonl 账本事件流水与 .mozhou/impacts/ 影响分析历史，
 * 提供管线生产、遍历与审查的可观测审计看板。
 *
 * 数据面（/api/tasks 中间件直出，组件 type-only 直引契约形状）：
 * - POST /api/tasks {root} → TasksResponse
 *
 * 呈现纪律：未建书时显式空态引导；事件流水以倒序排列呈现；
 * Traversal 记录展示触发源、上游改动项与受影响章清单。
 */
import { useCallback, useEffect, useState } from 'react'
import type { TasksResponse, TaskEventSummary } from '../../server/api'
import { post } from '../lib/post'

const CATEGORY_LABELS: Record<TaskEventSummary['category'], { label: string; cls: string }> = {
  pipeline: { label: '管线生产', cls: 'cap-badge native' },
  traversal: { label: '影响遍历', cls: 'cap-badge pending' },
  review: { label: '质量审查', cls: 'verdict blocking' },
  canon: { label: '正史提交', cls: 'cap-badge native' },
  system: { label: '系统领域', cls: 'tag' },
}

export function TasksView({
  root,
  onGoToWorkbench,
}: {
  /** 当前书根（无书时为 null 显式引导）。 */
  root: string | null
  /** 前往工作台回调。 */
  onGoToWorkbench: () => void
}): JSX.Element {
  const [data, setData] = useState<TasksResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pipeline' | 'traversal' | 'review'>('all')

  const load = useCallback(async (): Promise<void> => {
    if (root === null) return
    setBusy(true)
    setError(null)
    try {
      const res = await post<TasksResponse>('/api/tasks', { root })
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
      <section className="center solo" aria-label="tasks-view">
        <div className="chapterbar">
          <h1>任务中心</h1>
        </div>
        <div className="conversation">
          <div className="card-shell">
            <div className="card" data-testid="tasks-empty">
              <div className="card-title">
                <b>任务中心暂不可用</b>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.8 }}>
                任务中心 = 当前作品的生产账本与 Traversal 影响审计：先在工作台建书并推进章节管线，事件流水将自动记录在此。
              </p>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn-primary" onClick={onGoToWorkbench}>
                  前往工作台
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const handleExportJsonl = (): void => {
    if (data === null || data.events.length === 0) return
    const content = data.events.map((ev) => JSON.stringify(ev)).join('\n')
    const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mozhou-events-${Date.now()}.jsonl`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const filteredEvents = data === null ? [] : data.events.filter((e) => {
    if (filter === 'all') return true
    return e.category === filter
  })

  return (
    <section className="center solo" aria-label="tasks-view">
      <div className="chapterbar">
        <h1>任务中心</h1>
        <span className="meta">
          {data !== null
            ? `账本事件 ${data.totalEvents} 条 · 影响遍历 ${data.totalTraversals} 次`
            : '加载中…'}
        </span>
        <div className="save" style={{ display: 'flex', gap: 6 }}>
          {data !== null && data.events.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={handleExportJsonl}
              style={{ fontSize: 10, padding: '4px 8px' }}
              aria-label="导出流水日志"
            >
              导出 JSONL
            </button>
          )}
          <button className="btn" onClick={() => { void load() }} disabled={busy} style={{ fontSize: 10, padding: '4px 8px' }}>
            {busy ? '刷新中…' : '刷新流水'}
          </button>
        </div>
      </div>

      <div className="conversation">
        {busy && data === null && (
          <p className="muted" style={{ margin: 0 }} data-testid="tasks-busy">
            读取任务账本与影响记录…
          </p>
        )}
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="tasks-error">
            错误：{error}
          </p>
        )}

        {data !== null && (
          <>
            {/* Traversal 影响遍历审计 */}
            <section className="wb-section" data-testid="tasks-traversals">
              <h2>影响遍历审计 ({data.traversals.length})</h2>
              {data.traversals.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  当前作品暂无 Traversal 记录——当修改正典上游并触发影响分析时将记录在此。
                </p>
              ) : (
                data.traversals.map((t) => (
                  <div className="card-shell" key={t.traversalId}>
                    <div className="card">
                      <div className="card-title">
                        <b>Traversal: {t.traversalId}</b>
                        <span className="cap-badge pending">
                          影响 {t.affectedChapters.length} 章
                        </span>
                      </div>
                      <div className="actions" style={{ marginTop: 4 }}>
                        <span className="mono muted">
                          触发源：{t.trigger.source} ({t.trigger.ref})
                        </span>
                        <span className="mono muted">
                          记录时间：{t.recordedAt}
                        </span>
                      </div>
                      <div className="mono muted" style={{ marginTop: 6 }}>
                        受影响章节：{t.affectedChapters.length > 0 ? t.affectedChapters.map((c) => `第${c}章`).join(', ') : '无'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </section>

            {/* 管线事件流水 */}
            <section className="wb-section" data-testid="tasks-events">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2>事件流水 ({filteredEvents.length})</h2>
                <div className="actions" style={{ marginTop: 0, gap: 6 }}>
                  {(['all', 'pipeline', 'traversal', 'review'] as const).map((f) => (
                    <button
                      key={f}
                      className={filter === f ? 'btn-primary' : 'btn'}
                      style={{ fontSize: 9, padding: '3px 7px' }}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all' ? '全部' : f === 'pipeline' ? '管线' : f === 'traversal' ? '遍历' : '审查'}
                    </button>
                  ))}
                </div>
              </div>

              {filteredEvents.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  暂无匹配的事件流水记录。
                </p>
              ) : (
                filteredEvents.map((ev) => {
                  const meta = CATEGORY_LABELS[ev.category]
                  return (
                    <div className="card-shell" key={ev.position}>
                      <div className="card">
                        <div className="card-title">
                          <b>{ev.type}</b>
                          <span className={meta.cls}>{meta.label}</span>
                        </div>
                        <p className="mono muted" style={{ margin: 0 }}>
                          #{ev.position} · {ev.summary}
                        </p>
                        {ev.timestamp !== undefined && (
                          <p className="mono muted" style={{ margin: '4px 0 0', fontSize: 9 }}>
                            时间：{ev.timestamp}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </section>
          </>
        )}
      </div>
    </section>
  )
}
