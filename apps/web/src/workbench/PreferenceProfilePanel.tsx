/**
 * 作者偏好画像面板（CHG-20261006-06）。
 *
 * 呈现面：七维偏好画像、观测计数、物化状态、手动全量重建入口。
 * 诚实空态：无观测时明确提示冷启动先验，不伪造作者偏好已收敛。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'
import type { BookInfo } from '../shell/workbenchStorage'

export interface PreferenceProfileData {
  readonly cursor: number
  readonly obsCount: number
  readonly degradedWindows: number
  readonly dims: Record<string, {
    readonly mean: number
    readonly variance: number
    readonly nEffective: number
    readonly streak: number
  }>
}

export interface PreferenceResponse {
  readonly ok: boolean
  readonly materialized: boolean
  readonly profile: PreferenceProfileData
  readonly observationCount: number
  readonly error?: string
}

export interface PreferenceRebuildResponse {
  readonly ok: boolean
  readonly observationCount: number
  readonly profile: PreferenceProfileData
  readonly error?: string
}

const DIM_LABELS: Record<string, { name: string; desc: string }> = {
  sent_len_mean: { name: '句子均长', desc: '平均每句码点字符数（句号/感叹号/问号切分）' },
  sent_len_p90: { name: '长句峰值 (P90)', desc: '第 90 百分位句子长度，反映长难句偏好' },
  dlg_char_ratio: { name: '对白占比', desc: '引号内对白字符占全文字符比例' },
  ttr_win500: { name: '词汇丰富度', desc: '500 词元滑窗 Type-Token Ratio 词汇丰富度' },
  para_line_span: { name: '段落跨度', desc: '编辑与改写段落行数跨度' },
  cand_len_diff: { name: '候选长度差', desc: '采纳候选与弃用候选字数差，反映详略倾向' },
  level_ratio: { name: '语境层级比', desc: '光标级 (1) vs 选区级 (0) 动作偏好比例' },
}

export function PreferenceProfilePanel({ book }: { book: BookInfo | null }): JSX.Element {
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PreferenceResponse | null>(null)

  const fetchPreference = useCallback(async () => {
    if (book === null) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const resp = await post<PreferenceResponse>('/api/flywheel.preference', { root: book.root })
      setData(resp)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }, [book])

  useEffect(() => {
    void fetchPreference()
  }, [fetchPreference])

  const handleRebuild = async () => {
    if (book === null) return
    setRebuilding(true)
    setError(null)
    try {
      const resp = await post<PreferenceRebuildResponse>('/api/flywheel.preference.rebuild', { root: book.root })
      setData({
        ok: true,
        materialized: resp.profile.obsCount > 0,
        profile: resp.profile,
        observationCount: resp.observationCount,
      })
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setRebuilding(false)
    }
  }

  if (book === null) {
    return (
      <div className="card" data-testid="preference-profile-panel" style={{ padding: 14 }}>
        <p className="mono muted">未绑定作品，无法读取偏好画像。</p>
      </div>
    )
  }

  return (
    <div className="card" data-testid="preference-profile-panel" style={{ padding: 14 }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <b>作者偏好画像</b>
          <span className="mono muted" style={{ marginLeft: 8 }}>
            {data?.materialized ? `已物化 (${data.observationCount} 条观测)` : '冷启动先验'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            onClick={() => void fetchPreference()}
            disabled={loading || rebuilding}
            aria-label="刷新画像"
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            {loading ? '加载中…' : '刷新'}
          </button>
          <button
            className="btn"
            onClick={() => void handleRebuild()}
            disabled={loading || rebuilding}
            aria-label="重建画像"
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            {rebuilding ? '重算中…' : '全量重建'}
          </button>
        </div>
      </div>

      {error !== null && (
        <p className="wb-error" role="alert" style={{ marginBottom: 10 }}>
          读取失败：{error}
        </p>
      )}

      {data !== null && !data.materialized && data.observationCount === 0 && (
        <div
          data-testid="preference-empty-state"
          style={{
            padding: '12px 14px',
            backgroundColor: 'var(--bg-subtle, rgba(255,255,255,0.03))',
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 13,
            color: 'var(--text-muted, #888)',
          }}
        >
          <b>暂无作者行为观测（诚实空态）</b>
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>
            当前展示为冷启动通用网文先验。在正文保存（UserEdit）、选区 AI 采纳/放弃（Accept/Reject）以及章节定稿（Commit）后，飞轮将自动积累观测并物化你的个性化画像。
          </p>
        </div>
      )}

      {data?.profile?.dims !== undefined && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {Object.entries(data.profile.dims).map(([dimKey, dimState]) => {
            const meta = DIM_LABELS[dimKey] ?? { name: dimKey, desc: dimKey }
            return (
              <div
                key={dimKey}
                data-testid={`preference-dim-${dimKey}`}
                style={{
                  padding: 8,
                  border: '1px solid var(--border-subtle, #333)',
                  borderRadius: 4,
                  backgroundColor: 'var(--bg-canvas, rgba(0,0,0,0.2))',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{meta.name}</span>
                  <span className="mono" style={{ color: 'var(--accent, #3b82f6)' }}>
                    {dimState.mean.toFixed(3)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint, #666)', marginTop: 2 }} title={meta.desc}>
                  方差 {dimState.variance.toFixed(3)} · 样本权 {dimState.nEffective.toFixed(1)}
                  {dimState.streak !== 0 && ` · 连续漂移 ${dimState.streak}`}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
