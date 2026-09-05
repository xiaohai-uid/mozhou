/**
 * 文学质量审查面板（ADR-0025 · 计划 Task 9；T40 换肤为 Ink Orbit 材质）。
 * 作者主权：pass 不触发任何自动动作；回炉只经「Apply rework」显式按钮；
 * 纠错经「Record my correction」显式提交。无自动循环。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'

export interface QualitySummary {
  readonly ok: boolean
  readonly hasReport?: boolean
  readonly verdict?: 'pass' | 'blocking_fail' | 'refused'
  readonly reportId?: string
  readonly draftRevision?: number
  readonly draftContentHash?: string
  readonly current?: boolean
  readonly reworkCount?: number
  readonly semanticReviewer?: 'unavailable' | 'attached'
  readonly blockingFailures?: readonly EvaluationView[]
  readonly advisories?: readonly EvaluationView[]
}

interface EvaluationView {
  readonly ruleId: string
  readonly ruleVersion: string
  readonly verdict: string
  readonly severity: 'blocking' | 'advisory'
  readonly evidence: readonly { readonly ruleId: string; readonly note: string; readonly excerpt?: string }[]
}

export interface ReviewResponse extends QualitySummary {
  readonly reportPath?: string
}

/** 与 packages/quality-engine/src/types.ts CORRECTION_REASONS 同源；
 * 不可直引包根——policy/review 模块携 node:crypto，进浏览器包必炸。
 * 词表漂移由 api.test.ts 的 400 未知原因契约测试兜底。 */
const CORRECTION_REASONS = [
  'outline_expansion',
  'character_toolization',
  'knowledge_overreach',
  'payoff_zeroed',
  'information_only_reward',
  'repeated_solution_algorithm',
  'forced_golden_line',
  'memory_anchor_misuse',
  'style_drift',
  'other',
] as const

const VERDICT_LABEL: Record<string, string> = {
  pass: 'PASS',
  blocking_fail: 'NEEDS REWORK',
  refused: 'REFUSED',
}

const VERDICT_CLASS: Record<string, string> = {
  pass: 'verdict pass',
  blocking_fail: 'verdict blocking',
  refused: 'verdict refused',
}

export function QualityPanel({ root, chapterIndex }: { root: string; chapterIndex: number }) {
  const [summary, setSummary] = useState<QualitySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedReason, setSelectedReason] = useState<string>('outline_expansion')
  const [note, setNote] = useState('')
  const [correctionSaved, setCorrectionSaved] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setSummary(await post<QualitySummary>('/api/chapter.quality', { root, chapterIndex }))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [root, chapterIndex])

  useEffect(() => { void refresh() }, [refresh])

  const runReview = async () => {
    setError(null)
    setCorrectionSaved(false)
    try {
      setSummary(await post<ReviewResponse>('/api/chapter.review', { root, chapterIndex }))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const applyRework = async () => {
    setError(null)
    setCorrectionSaved(false)
    try {
      await post<{ currentStep: string; reworkCount: number }>('/api/chapter.rework', { root, chapterIndex })
      await refresh()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const recordCorrection = async () => {
    setError(null)
    try {
      await post('/api/chapter.corrections', {
        root,
        chapterIndex,
        reasons: [selectedReason],
        ...(note === '' ? {} : { note }),
      })
      setCorrectionSaved(true)
      setNote('')
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const verdict = summary?.verdict
  const reworkCount = summary?.reworkCount ?? 0
  const hashShort = summary?.draftContentHash === undefined ? '' : summary.draftContentHash.slice(0, 12)

  return (
    <section aria-label="literary-quality-panel" className="card-shell">
      <div className="card">
        <div className="card-title">
          <b>文学质量审查</b>
          {verdict !== undefined && (
            <span className={VERDICT_CLASS[verdict] ?? 'verdict'}>{VERDICT_LABEL[verdict] ?? verdict}</span>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="wb-error" style={{ marginBottom: 10 }}>
            {error}
          </p>
        )}

        {verdict === undefined && (
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            {summary?.hasReport === false ? '尚未运行检查——点击下方按钮开始基础检查' : '—'}
          </p>
        )}
        {summary?.hasReport === true && summary?.current === false && (
          <p className="mono muted" style={{ margin: '6px 0 0', color: 'var(--warning)' }}>
            报告已 stale——正文在审查后变化，建议重新检查
          </p>
        )}
        {summary?.draftRevision !== undefined && (
          <p className="mono muted" style={{ margin: '6px 0 0' }}>
            Exact draft: revision {summary.draftRevision} · hash {hashShort}…
          </p>
        )}
        {summary?.hasReport === true && (
          <p className="mono muted" style={{ margin: '6px 0 0' }}>
            Rework attempt {Math.min(reworkCount, 2)}/2
          </p>
        )}

        {verdict === 'pass' && (
          <p style={{ margin: '8px 0 0', color: 'var(--success)', fontSize: 11 }}>
            审查通过，可进入作者编辑。
          </p>
        )}
        {verdict === 'refused' && (
          <p style={{ margin: '8px 0 0', color: 'var(--text-faint)', fontSize: 11 }}>
            语义审查提供方不可用——已显式拒绝，交作者处置。
          </p>
        )}

        {(summary?.blockingFailures?.length ?? 0) > 0 && (
          <div>
            <h4 className="mono muted" style={{ margin: '12px 0 4px' }}>BLOCKING FAILURES</h4>
            {summary?.blockingFailures?.map((evaluation) => (
              <div className="finding" key={evaluation.ruleId + ':' + evaluation.ruleVersion}>
                <b>
                  {evaluation.ruleId}（v{evaluation.ruleVersion}）
                </b>
                {evaluation.evidence.map((evidence, index) => (
                  <p key={index}>
                    {evidence.note}
                    {evidence.excerpt !== undefined && <q> {evidence.excerpt}</q>}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
        {(summary?.advisories?.length ?? 0) > 0 && (
          <div>
            <h4 className="mono muted" style={{ margin: '12px 0 4px' }}>ADVISORIES（建议，不阻断）</h4>
            {summary?.advisories?.map((evaluation) => (
              <div className="finding" key={evaluation.ruleId + ':' + evaluation.ruleVersion}>
                <p style={{ margin: 0 }}>
                  {evaluation.ruleId}（v{evaluation.ruleVersion}）：{evaluation.evidence[0]?.note}
                </p>
              </div>
            ))}
          </div>
        )}
        {summary?.semanticReviewer === 'unavailable' && (
          <p className="banner" style={{ marginTop: 10, marginBottom: 0 }}>
            已包含基础机检（字数/段落/格式/占位符）；未配置语义 Reviewer，不参与判定。
          </p>
        )}

        <div className="actions">
          <button className="btn-primary" onClick={() => { void runReview() }}>
            Run literary review
          </button>
          {verdict === 'blocking_fail' && (
            <button className="btn" onClick={() => { void applyRework() }} disabled={reworkCount >= 2}>
              Apply rework{reworkCount >= 2 ? '（已达上限）' : ''}
            </button>
          )}
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
          <h4 className="mono muted" style={{ margin: '0 0 8px' }}>RECORD MY CORRECTION</h4>
          <div className="actions" style={{ marginTop: 0, alignItems: 'center' }}>
            <select
              className="control"
              value={selectedReason}
              onChange={(event) => setSelectedReason(event.target.value)}
              aria-label="纠错原因"
            >
              {CORRECTION_REASONS.map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
            <input
              className="control"
              type="text"
              placeholder="纠错附注（原文只留本机）"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              style={{ flex: 1, minWidth: 140 }}
            />
            <button className="btn" onClick={() => { void recordCorrection() }}>保存纠错</button>
          </div>
          {correctionSaved && (
            <p className="mono" style={{ margin: '8px 0 0', color: 'var(--success)' }}>
              已记录（事件+失败记忆）
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
