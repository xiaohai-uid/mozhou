/**
 * 文学质量审查面板（ADR-0025 · 计划 Task 9）。
 * 作者主权：pass 不触发任何自动动作；回炉只经「Apply rework」显式按钮；
 * 纠错经「Record my correction」显式提交。无自动循环。
 */
import { useCallback, useEffect, useState } from 'react'

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

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string; code?: string } & T
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error ?? '请求失败 (HTTP ' + res.status + ')')
    error.name = data.code ?? 'RequestError'
    throw error
  }
  return data
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
    <section aria-label="literary-quality-panel" style={{ border: '1px solid #444', padding: 12, marginTop: 12 }}>
      <h3>文学质量审查</h3>
      {error !== null && <p role="alert" style={{ color: '#c0392b' }}>{error}</p>}
      <p>
        Literary Review:{' '}
        <strong>{verdict === undefined ? (summary?.hasReport === false ? '（尚无报告）' : '—') : VERDICT_LABEL[verdict]}</strong>
        {summary?.current === false && <em>（报告已 stale——正文在审查后变化）</em>}
      </p>
      {summary?.draftRevision !== undefined && (
        <p>Exact draft: revision {summary.draftRevision} · hash {hashShort}…</p>
      )}
      {summary?.hasReport !== false && (
        <p>Rework attempt {Math.min(reworkCount, 2)}/2</p>
      )}

      {verdict === 'pass' && <p style={{ color: '#27ae60' }}>审查通过，可进入作者编辑。</p>}
      {verdict === 'refused' && <p style={{ color: '#7f8c8d' }}>语义审查提供方不可用——已显式拒绝，交作者处置。</p>}

      {(summary?.blockingFailures?.length ?? 0) > 0 && (
        <div>
          <h4>Blocking failures</h4>
          <ul>
            {summary?.blockingFailures?.map((evaluation) => (
              <li key={evaluation.ruleId + ':' + evaluation.ruleVersion}>
                <strong>{evaluation.ruleId}</strong>（v{evaluation.ruleVersion}）
                <ul>
                  {evaluation.evidence.map((evidence, index) => (
                    <li key={index}>
                      {evidence.note}
                      {evidence.excerpt !== undefined && <q>{evidence.excerpt}</q>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(summary?.advisories?.length ?? 0) > 0 && (
        <div>
          <h4>Advisories（建议，不阻断）</h4>
          <ul>
            {summary?.advisories?.map((evaluation) => (
              <li key={evaluation.ruleId + ':' + evaluation.ruleVersion}>
                {evaluation.ruleId}（v{evaluation.ruleVersion}）：{evaluation.evidence[0]?.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary?.semanticReviewer === 'unavailable' && (
        <p style={{ color: '#7f8c8d' }}>语义审查提供方未接入（Gate 3）：语义规则将使审查显式 REFUSED，而非静默放行。</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={() => { void runReview() }}>Run literary review</button>
        {verdict === 'blocking_fail' && (
          <button onClick={() => { void applyRework() }} disabled={reworkCount >= 2}>
            Apply rework{reworkCount >= 2 ? '（已达上限）' : ''}
          </button>
        )}
      </div>

      <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
        <h4>Record my correction</h4>
        <select value={selectedReason} onChange={(event) => setSelectedReason(event.target.value)}>
          {CORRECTION_REASONS.map((reason) => (
            <option key={reason} value={reason}>{reason}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="纠错附注（原文只留本机）"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          style={{ marginLeft: 8 }}
        />
        <button style={{ marginLeft: 8 }} onClick={() => { void recordCorrection() }}>保存纠错</button>
        {correctionSaved && <span style={{ marginLeft: 8, color: '#27ae60' }}>已记录（事件+失败记忆）</span>}
      </div>
    </section>
  )
}
