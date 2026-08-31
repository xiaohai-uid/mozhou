/**
 * 变更矩阵面板（实现票 T43）：行 = Traversal（上游变更 + stale 计数）、
 * 列 = 受影响章，单元格三态（红 needs_rework / 绿 resolved / — not_affected），
 * 行级「重跑」按钮调 runTraversal（幂等覆盖，不产生重复副作用）。
 *
 * 数据面（/api 中间件直出，组件 type-only 直引契约形状，零 any）：
 * - /api/change-matrix      → assembleChangeMatrix 只读投影
 * - /api/change-matrix.rerun → runTraversal 幂等重跑（同 traversalId 覆盖）
 *
 * 呈现纪律：
 * - 单元格三态用 Ink Orbit 语义色（红/绿/—），data-cell 契约保留；
 * - 重跑按钮仅对仍有 needs_rework 的行可用；重跑后重投影刷新；
 * - 空矩阵（无 impact 记录）显式空态，不假装有变更。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ChangeMatrix, ChangeMatrixRow } from '@mozhou/data-plane'
import type { ChangeMatrixResponse } from '../../server/api'
import { post } from '../lib/post'

const CELL_LABEL: Record<ChangeMatrixRow['cells'][number]['state'], string> = {
  needs_rework: '需重写',
  resolved: '已消解',
  not_affected: '—',
}

/** 上游变更的行名摘要：首个变更的 kind:id 集合，供 rowname 列展示。 */
function summarizeChanges(changes: ChangeMatrixRow['upstreamChanges']): string {
  if (changes.length === 0) return '（无上游变更）'
  return changes.map((entry) => `${entry.kind}:${entry.id}`).join(' · ')
}

export function ChangeMatrixPanel({ root }: { root: string }): JSX.Element {
  const [matrix, setMatrix] = useState<ChangeMatrix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rerunningId, setRerunningId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const data = await post<ChangeMatrixResponse>('/api/change-matrix', { root })
      setMatrix(data.matrix)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [root])

  const handleRerun = async (traversalId: string): Promise<void> => {
    setRerunningId(traversalId)
    setError(null)
    try {
      const data = await post<ChangeMatrixResponse>('/api/change-matrix.rerun', { root, traversalId })
      setMatrix(data.matrix)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setRerunningId(null)
    }
  }

  useEffect(() => { void load() }, [load])

  const columns = matrix?.columns ?? []
  const rows = matrix?.rows ?? []
  const totalStale = rows.reduce((sum, row) => sum + row.staleCount, 0)

  return (
    <section aria-label="change-matrix-panel">
      <div className="panel-head">
        <div>
          <h2>变更矩阵</h2>
          <p>Traversal × 受影响章</p>
        </div>
        <span className={totalStale > 0 ? 'verdict blocking' : 'verdict pass'}>
          stale {totalStale}
        </span>
      </div>

      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => { void load() }} disabled={busy}>
          {busy ? '读取中…' : '刷新'}
        </button>
        <span className="mono muted" style={{ alignSelf: 'center' }}>
          红=需重写 · 绿=已消解 · — 无涉
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="wb-error">
          错误：{error}
        </p>
      )}

      <div className="card-shell" data-testid="change-matrix">
        <div className="card">
          {!busy && rows.length === 0 && (
            <p className="muted" data-testid="matrix-empty" style={{ margin: 0 }}>
              暂无变更——上游改动经 Traversal 传播后会在这里形成影响矩阵。
            </p>
          )}
          {rows.length > 0 && (
            <table className="matrix" data-testid="matrix-table">
              <thead>
                <tr>
                  <th>上游变更</th>
                  {columns.map((chapter) => (
                    <th key={chapter}>ch{chapter}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.traversalId} data-traversal-id={row.traversalId}>
                    <td className="rowname" title="Traversal" data-testid="matrix-rownames">
                      {summarizeChanges(row.upstreamChanges)}
                      <em style={{ display: 'block', fontStyle: 'normal', color: 'var(--text-faint)' , fontSize: 8 }}>
                        {row.traversalId}
                      </em>
                    </td>
                    {columns.map((chapter) => {
                      const cell = row.cells.find((c) => c.chapterIndex === chapter)
                      const state = cell?.state ?? 'not_affected'
                      return (
                        <td
                          key={chapter}
                          className={state === 'not_affected' ? '' : state === 'resolved' ? 'green' : 'red'}
                          data-cell={state}
                          data-chapter={chapter}
                        >
                          {CELL_LABEL[state]}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card-shell">
          <div className="card">
            <div className="card-title">
              <b>Traversal 详情</b>
              <span className="mono muted">{rows.length} rows</span>
            </div>
            {rows.map((row) => (
              <div key={row.traversalId} className="receipt-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
                <span>
                  <b>{row.traversalId}</b>
                  <em className="muted" style={{ display: 'block', fontStyle: 'normal' }}>
                    {row.taskRef} · {row.trigger.source}:{row.trigger.ref} · {row.recordedAt.slice(0, 19).replace('T', ' ')}
                  </em>
                  <em className="muted" style={{ display: 'block', fontStyle: 'normal' }}>
                    {summarizeChanges(row.upstreamChanges)}
                  </em>
                </span>
                <code>{row.cells.filter((c) => c.state === 'needs_rework').length} stale</code>
                <button
                  className="btn"
                  data-testid="matrix-rerun"
                  data-traversal-rerun={row.traversalId}
                  disabled={rerunningId !== null || row.staleCount === 0}
                  onClick={() => { void handleRerun(row.traversalId) }}
                >
                  {rerunningId === row.traversalId ? '重跑中…' : '重跑此遍历'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}