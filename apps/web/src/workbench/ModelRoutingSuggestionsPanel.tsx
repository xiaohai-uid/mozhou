/**
 * 模型路由建议面板（CHG-20261006-06）。
 *
 * 呈现面：模型建议列表、资格门/样本量状态、显式重新评估入口。
 * 硬不变量（C6）：只建议，不自动改变模型路由（展示明确免责与说明）。
 * 诚实空态：无建议或样本不足时如实提示。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'
import type { BookInfo } from '../shell/workbenchStorage'

export interface RoutingSuggestionView {
  readonly suggestionId: string
  readonly createdAtUtc: string
  readonly cell: {
    readonly taskType: string
    readonly providerId: string
    readonly model: string
    readonly recipeVersion: string | null
  }
  readonly kind: 'promote' | 'demote' | 'watch'
  readonly proposedRoute: {
    readonly providerId: string
    readonly model: string
  }
  readonly basis: {
    readonly sampleSize: { readonly decisions: number; readonly chapterWindows: number }
    readonly challengerAcceptanceWilson: readonly [number, number]
    readonly incumbentAcceptanceWilson: readonly [number, number]
    readonly editRatioDeltaPct: number
    readonly benchmarkGatePassed: boolean
    readonly matrixRowRef: string | null
  }
  readonly status: 'sufficient_sample' | 'insufficient_sample' | 'benchmark_failed' | 'inconclusive'
}

export interface SuggestionsResponse {
  readonly ok: boolean
  readonly suggestions: readonly RoutingSuggestionView[]
  readonly count: number
  readonly error?: string
}

export interface EvaluatorStatusResponse {
  readonly ok: boolean
  readonly eligible: boolean
  readonly sampleSize: { readonly decisions: number; readonly chapterWindows: number }
  readonly thresholds: { readonly minDecisions: number; readonly minChapterWindows: number }
  readonly error?: string
}

export interface EvaluatorRunResponse {
  readonly ok: boolean
  readonly mode: 'evaluated' | 'watch_only'
  readonly bridgePresent: boolean
  readonly appendedCount: number
  readonly suggestions: readonly RoutingSuggestionView[]
  readonly notice?: string
  readonly error?: string
}

const KIND_BADGES: Record<string, { label: string; color: string }> = {
  promote: { label: '推荐晋级', color: '#10b981' },
  demote: { label: '建议降级', color: '#ef4444' },
  watch: { label: '持续观察', color: '#f59e0b' },
}

export function ModelRoutingSuggestionsPanel({ book }: { book: BookInfo | null }): JSX.Element {
  const [loading, setLoading] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<readonly RoutingSuggestionView[]>([])
  const [status, setStatus] = useState<EvaluatorStatusResponse | null>(null)

  const loadData = useCallback(async () => {
    if (book === null) {
      setSuggestions([])
      setStatus(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [sugResp, statResp] = await Promise.all([
        post<SuggestionsResponse>('/api/flywheel.suggestions', { root: book.root }),
        post<EvaluatorStatusResponse>('/api/flywheel.evaluator.status', { root: book.root }),
      ])
      setSuggestions(sugResp.suggestions ?? [])
      setStatus(statResp)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }, [book])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleEvaluate = async () => {
    if (book === null) return
    setEvaluating(true)
    setError(null)
    try {
      const runResp = await post<EvaluatorRunResponse>('/api/flywheel.evaluator.run', { root: book.root })
      setSuggestions(runResp.suggestions ?? [])
      // 重新拉取一次样本状态
      const statResp = await post<EvaluatorStatusResponse>('/api/flywheel.evaluator.status', { root: book.root })
      setStatus(statResp)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setEvaluating(false)
    }
  }

  if (book === null) {
    return (
      <div className="card" data-testid="model-suggestions-panel" style={{ padding: 14 }}>
        <p className="mono muted">未绑定作品，无法读取模型建议。</p>
      </div>
    )
  }

  return (
    <div className="card" data-testid="model-suggestions-panel" style={{ padding: 14 }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <b>模型路由建议</b>
          <span className="mono muted" style={{ marginLeft: 8 }}>
            {suggestions.length > 0 ? `(${suggestions.length} 项建议)` : '暂无建议'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            onClick={() => void loadData()}
            disabled={loading || evaluating}
            aria-label="刷新建议"
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            {loading ? '加载中…' : '刷新'}
          </button>
          <button
            className="btn"
            onClick={() => void handleEvaluate()}
            disabled={loading || evaluating}
            aria-label="重新评估"
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            {evaluating ? '评估中…' : '重新评估'}
          </button>
        </div>
      </div>

      {error !== null && (
        <p className="wb-error" role="alert" style={{ marginBottom: 10 }}>
          评估或读取失败：{error}
        </p>
      )}

      {/* 样本状态栏 */}
      {status?.sampleSize !== undefined && status?.thresholds !== undefined && (
        <div
          data-testid="evaluator-sample-status"
          style={{
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 4,
            backgroundColor: 'var(--bg-subtle, rgba(255,255,255,0.02))',
            border: '1px solid var(--border-subtle, #333)',
            marginBottom: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span>当前样本量：<b>{status.sampleSize.decisions}</b> 决策 · <b>{status.sampleSize.chapterWindows}</b> 章节窗</span>
            <span className="muted" style={{ marginLeft: 6 }}>
              (门槛: ≥{status.thresholds.minDecisions} 决策, ≥{status.thresholds.minChapterWindows} 章节)
            </span>
          </div>
          <div>
            {status.eligible ? (
              <span style={{ color: '#10b981', fontWeight: 600 }}>满足最小评估样本</span>
            ) : (
              <span style={{ color: 'var(--text-faint, #888)' }}>样本积累中 (观察模式)</span>
            )}
          </div>
        </div>
      )}

      {/* 不变量说明 */}
      <div
        data-testid="routing-invariant-notice"
        style={{
          fontSize: 11,
          color: 'var(--text-faint, #888)',
          padding: '6px 8px',
          backgroundColor: 'rgba(255,255,255,0.01)',
          borderLeft: '2px solid var(--accent, #3b82f6)',
          marginBottom: 10,
        }}
      >
        <b>硬不变量约定：</b>所有生成条目均为参考建议，墨舟绝不会自动修改当前模型路由配置，需作者根据建议人工决策。
      </div>

      {/* 诚实空态 */}
      {suggestions.length === 0 && (
        <div
          data-testid="suggestions-empty-state"
          style={{
            padding: '12px 14px',
            backgroundColor: 'var(--bg-subtle, rgba(255,255,255,0.03))',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--text-muted, #888)',
          }}
        >
          <b>当前暂无模型路由建议（诚实空态）</b>
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>
            当积累足够的章节创作与编辑采纳样本后，点击「重新评估」将基于 Wilson 置信区间与多维指标对比分析模型优劣并提出建议。
          </p>
        </div>
      )}

      {/* 建议列表 */}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suggestions.map((sug) => {
            const badge = KIND_BADGES[sug.kind] ?? { label: sug.kind, color: '#888' }
            return (
              <div
                key={sug.suggestionId}
                data-testid={`suggestion-item-${sug.suggestionId}`}
                style={{
                  padding: 10,
                  border: '1px solid var(--border-subtle, #333)',
                  borderRadius: 4,
                  backgroundColor: 'var(--bg-canvas, rgba(0,0,0,0.2))',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 3,
                        backgroundColor: badge.color,
                        color: '#fff',
                        fontWeight: 600,
                      }}
                    >
                      {badge.label}
                    </span>
                    <b style={{ fontSize: 13 }}>{sug.cell.taskType}</b>
                  </div>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {sug.createdAtUtc.slice(0, 19).replace('T', ' ')}
                  </span>
                </div>

                <div style={{ margin: '8px 0 4px', fontSize: 12 }}>
                  <span className="muted">当前现任：</span>
                  <code>{sug.cell.providerId}/{sug.cell.model}</code>
                  <span style={{ margin: '0 8px' }}>→</span>
                  <span className="muted">提议替代：</span>
                  <code style={{ fontWeight: 600 }}>{sug.proposedRoute.providerId}/{sug.proposedRoute.model || '(无)'}</code>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-faint, #888)', display: 'flex', gap: 12 }}>
                  <span>状态: <code>{sug.status}</code></span>
                  <span>决策样本: {sug.basis.sampleSize.decisions}</span>
                  <span>章节窗口: {sug.basis.sampleSize.chapterWindows}</span>
                  {sug.basis.editRatioDeltaPct !== 0 && (
                    <span>改写减少比: {(sug.basis.editRatioDeltaPct * 100).toFixed(1)}%</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
