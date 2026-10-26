/**
 * 章后回顾面板（#119 ②）：章节提交后自动触发的两查（章节事件 / 人物心理状态）
 * 候选事实在此逐项确认 / 编辑 / 拒绝。
 *
 * - 未决候选持续可见：待决列表来自 /api/facts.candidates，决断成功即刷新；
 * - 提交链自动触发（服务端 commit afterRecord 缝）的进度经 /api/facts.status 呈现：
 *   提取中 / 完成（新增 N 条）/ 失败（原因 + 重试入口）；未配置模型时显示明确
 *   失败与重试入口（provider 活探针，绝不假成功）；
 * - 交互镜像既有提案队列 confirm / reject / edit 三动作模式（#117/#118 决断面），
 *   幂等重放与现场作废（409）按服务端语义如实呈现；
 * - 视觉沿用检视塔面板 token（card-shell / cap-badge / wb-error / var(--*)）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { post } from '../lib/post'

interface FactCandidatePayloadView {
  readonly summary: string
  readonly detail?: string
  readonly character?: string
  readonly before?: string
  readonly after?: string
}

/** /api/facts.candidates 行视图（服务端 FactLedgerRecord JSON 同口径）。 */
interface FactCandidateView {
  readonly candidateId: string
  readonly kind: 'event' | 'psychological_state'
  readonly payload: FactCandidatePayloadView
  readonly evidence: string
  readonly chapterIndex: number
  readonly proseHash: string
}

/** /api/facts.status 的 extraction 行视图（服务端 FactExtractionEventRow 同口径）。 */
interface FactExtractionStatusRow {
  readonly type: 'FactExtractionStarted' | 'FactExtractionFinished' | 'FactExtractionFailed'
  readonly at: string
  readonly runId: string
  readonly trigger: 'auto_commit' | 'manual_retry'
  readonly inserted?: number
  readonly voided?: number
  readonly reason?: string
}

interface FactStatusResponse {
  readonly ok: boolean
  readonly extraction: FactExtractionStatusRow | null
  readonly pendingCount: number
  readonly provider: { readonly available: boolean; readonly reason?: string; readonly detail?: string }
}

interface EditDraft {
  readonly summary: string
  readonly character: string
  readonly before: string
  readonly after: string
}

const KIND_LABELS: Record<FactCandidateView['kind'], string> = {
  event: '章节事件',
  psychological_state: '人物心理状态',
}

/** 提交成功广播（QualityPanel / DialogueStream 发出）后的回查节奏：提交即刻 + 退避轮询，覆盖异步提取收口。 */
const ADOPTED_REFRESH_DELAYS_MS = [0, 1200, 2800, 5500, 9000] as const

export function ChapterReviewPanel({ root, chapterIndex }: { root: string; chapterIndex: number }): JSX.Element {
  const [candidates, setCandidates] = useState<readonly FactCandidateView[] | null>(null)
  const [status, setStatus] = useState<FactStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  /** 只在 id 变化时整面板重载；chapterIndex 变化经 key/副作用处理，不进 load 依赖。 */
  const loadRef = useRef<() => Promise<void>>(async () => {})

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const [statusRes, candidatesRes] = await Promise.all([
        post<FactStatusResponse>('/api/facts.status', { root, chapterIndex }),
        post<{ ok: boolean; candidates: readonly FactCandidateView[] }>('/api/facts.candidates', { root, chapterIndex }),
      ])
      setStatus(statusRes)
      setCandidates(candidatesRes.candidates)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [root, chapterIndex])
  loadRef.current = load

  useEffect(() => {
    void loadRef.current()
  }, [root, chapterIndex])

  // 提交成功（定稿 / AI 采纳落盘）后回查：异步提取几秒内收口，退避轮询覆盖。
  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const onAdopted = (event: Event): void => {
      const detail = (event as CustomEvent<{ chapterIndex?: number }>).detail
      if (detail?.chapterIndex !== undefined && detail.chapterIndex !== chapterIndex) return
      for (const delay of ADOPTED_REFRESH_DELAYS_MS) {
        timers.push(
          window.setTimeout(() => {
            if (!cancelled) void loadRef.current()
          }, delay),
        )
      }
    }
    window.addEventListener('mozhou:prose-adopted', onAdopted)
    return () => {
      cancelled = true
      for (const timer of timers) window.clearTimeout(timer)
      window.removeEventListener('mozhou:prose-adopted', onAdopted)
    }
  }, [root, chapterIndex])

  const decide = useCallback(
    async (candidateId: string, decision: 'confirmed' | 'rejected', payload?: FactCandidatePayloadView): Promise<void> => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const res = await post<{ ok: boolean; replayed?: boolean }>('/api/facts.decide', {
          root,
          chapterIndex,
          factCandidateId: candidateId,
          decision,
          ...(payload !== undefined ? { payload } : {}),
        })
        if (res.replayed === true) {
          setNotice('该候选此前已决断——本次按幂等重放返回首次结果，账本未变化。')
        }
        await load()
      } catch (cause) {
        const err = cause as Error & { name?: string }
        if (err.name === 'FACT_CANDIDATE_VOIDED') {
          setNotice('该候选已被新一次提取作废（同章重提取 = 新现场）——列表已刷新，旧现场不污染。')
          await load()
          return
        }
        setError(err.message)
      } finally {
        setBusy(false)
      }
    },
    [root, chapterIndex, load],
  )

  const startEdit = useCallback((candidate: FactCandidateView): void => {
    setEditingId(candidate.candidateId)
    setEditDraft({
      summary: candidate.payload.summary,
      character: candidate.payload.character ?? '',
      before: candidate.payload.before ?? '',
      after: candidate.payload.after ?? '',
    })
  }, [])

  const submitEdit = useCallback(
    async (candidate: FactCandidateView): Promise<void> => {
      const draft = editDraft
      if (draft === null) return
      const payload: FactCandidatePayloadView =
        candidate.kind === 'psychological_state'
          ? { summary: `${draft.character}：${draft.before} → ${draft.after}`, character: draft.character, before: draft.before, after: draft.after }
          : { summary: draft.summary }
      await decide(candidate.candidateId, 'confirmed', payload)
      setEditingId(null)
      setEditDraft(null)
    },
    [editDraft, decide],
  )

  const retryExtraction = useCallback(async (): Promise<void> => {
    setRetrying(true)
    setError(null)
    setNotice(null)
    try {
      const res = await post<{ ok: boolean; code?: string; error?: string; inserted?: number; voided?: number }>(
        '/api/facts.extract',
        { root, chapterIndex },
      )
      await load()
      setNotice(`提取完成：新增 ${res.inserted ?? 0} 条待决候选，作废旧待决 ${res.voided ?? 0} 条。`)
    } catch (cause) {
      // post() 契约：ok:false / 非 2xx 抛错，错误码在 name（PROVIDER_UNAVAILABLE 等）。
      const err = cause as Error & { name?: string }
      const message =
        err.name === 'PROVIDER_UNAVAILABLE'
          ? '未配置模型：候选事实提取需要配置写作模型（模型设置）。配置后点「重试提取」。'
          : err.message
      await load().catch(() => {})
      setError(message)
    } finally {
      setRetrying(false)
    }
  }, [root, chapterIndex, load])

  const extraction = status?.extraction ?? null
  const unconfigured = status !== null && !status.provider.available && status.provider.reason === 'no_provider_configured'
  const pendingCount = candidates?.length ?? 0

  return (
    <section aria-label="chapter-review-panel" className="card-shell" data-testid="chapter-review-panel">
      <div className="card">
        <div className="card-title">
          <b>章后回顾</b>
          <span className={'cap-badge ' + (pendingCount > 0 ? 'pending' : 'native')}>
            待决 {pendingCount}
          </span>
        </div>

        {error !== null && (
          <p role="alert" className="wb-error" data-testid="chapter-review-error" style={{ marginBottom: 8 }}>
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="mono" data-testid="chapter-review-notice" style={{ margin: '0 0 8px', color: 'var(--success)', fontSize: 11 }}>
            {notice}
          </p>
        )}

        {status === null && candidates === null ? (
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            读取提取状态与待决候选…
          </p>
        ) : (
          <>
            {unconfigured && (
              <div data-testid="chapter-review-unconfigured" className="banner" style={{ marginBottom: 10 }}>
                未配置模型：提交后的候选事实提取需要配置写作模型（模型设置）。配置后点「重试提取」——绝不假成功。
                <div className="actions" style={{ marginTop: 6 }}>
                  <button type="button" className="btn" onClick={() => void retryExtraction()} disabled={retrying} style={{ fontSize: 10, padding: '3px 8px' }}>
                    {retrying ? '重试中…' : '重试提取'}
                  </button>
                </div>
              </div>
            )}
            {extraction?.type === 'FactExtractionStarted' && (
              <p className="mono muted" data-testid="chapter-review-running" style={{ margin: '0 0 8px', fontSize: 11 }}>
                候选事实提取进行中（提交后自动触发，不阻塞写作）…
              </p>
            )}
            {extraction?.type === 'FactExtractionFailed' && !unconfigured && (
              <div data-testid="chapter-review-failed" style={{ marginBottom: 10 }}>
                <p role="alert" className="wb-error" style={{ margin: 0 }}>
                  提取失败：{extraction.reason}
                </p>
                <div className="actions" style={{ marginTop: 6 }}>
                  <button type="button" className="btn" onClick={() => void retryExtraction()} disabled={retrying} style={{ fontSize: 10, padding: '3px 8px' }}>
                    {retrying ? '重试中…' : '重试提取'}
                  </button>
                </div>
              </div>
            )}
            {extraction?.type === 'FactExtractionFinished' && (
              <p className="mono muted" data-testid="chapter-review-last-finished" style={{ margin: '0 0 8px', fontSize: 10 }}>
                上次提取：新增 {extraction.inserted ?? 0} 条候选 · 作废旧待决 {extraction.voided ?? 0} 条（进度同步记录在任务中心）
              </p>
            )}
            {extraction === null && !unconfigured && (
              <p className="mono muted" style={{ margin: '0 0 8px', fontSize: 10 }}>
                本章暂无提取记录——提交章节后自动提取两查（章节事件 / 人物心理状态）。
              </p>
            )}

            {candidates === null ? null : candidates.length === 0 ? (
              <p className="muted" data-testid="chapter-review-empty" style={{ margin: 0, fontSize: 11 }}>
                本章没有待决候选事实——账本只记你认可的事实。
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map((candidate) => {
                  const editing = editingId === candidate.candidateId
                  return (
                    <div className="card-shell" key={candidate.candidateId} data-testid="fact-candidate">
                      <div className="card" style={{ padding: 10 }}>
                        <div className="card-title" style={{ marginBottom: 4 }}>
                          <b style={{ fontSize: 12 }}>{KIND_LABELS[candidate.kind]}</b>
                          <span className="cap-badge pending">待决</span>
                        </div>
                        {!editing ? (
                          <>
                            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>{candidate.payload.summary}</p>
                            {candidate.payload.detail !== undefined && (
                              <p className="mono muted" style={{ margin: '4px 0 0', fontSize: 10 }}>
                                {candidate.payload.detail}
                              </p>
                            )}
                          </>
                        ) : editDraft !== null && candidate.kind === 'psychological_state' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="fact-edit-form">
                            <input
                              className="control"
                              value={editDraft.character}
                              onChange={(event) => setEditDraft({ ...editDraft, character: event.target.value })}
                              aria-label="人物"
                              placeholder="人物"
                            />
                            <input
                              className="control"
                              value={editDraft.before}
                              onChange={(event) => setEditDraft({ ...editDraft, before: event.target.value })}
                              aria-label="之前心理状态"
                              placeholder="之前心理状态"
                            />
                            <input
                              className="control"
                              value={editDraft.after}
                              onChange={(event) => setEditDraft({ ...editDraft, after: event.target.value })}
                              aria-label="之后心理状态"
                              placeholder="之后心理状态"
                            />
                          </div>
                        ) : editDraft !== null ? (
                          <input
                            className="control"
                            value={editDraft.summary}
                            onChange={(event) => setEditDraft({ ...editDraft, summary: event.target.value })}
                            aria-label="事件摘要"
                            placeholder="事件摘要"
                            data-testid="fact-edit-summary"
                          />
                        ) : null}
                        <p className="mono muted" style={{ margin: '6px 0 0', fontSize: 10 }}>
                          依据：{candidate.evidence} · 来源：第 {candidate.chapterIndex} 章
                        </p>
                        <div className="actions" style={{ marginTop: 8 }}>
                          {!editing ? (
                            <>
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={busy}
                                onClick={() => void decide(candidate.candidateId, 'confirmed')}
                                style={{ fontSize: 10, padding: '3px 8px' }}
                              >
                                确认
                              </button>
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => startEdit(candidate)}
                                style={{ fontSize: 10, padding: '3px 8px' }}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => void decide(candidate.candidateId, 'rejected')}
                                style={{ fontSize: 10, padding: '3px 8px' }}
                              >
                                拒绝
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={busy}
                                onClick={() => void submitEdit(candidate)}
                                style={{ fontSize: 10, padding: '3px 8px' }}
                              >
                                编辑后确认
                              </button>
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => {
                                  setEditingId(null)
                                  setEditDraft(null)
                                }}
                                style={{ fontSize: 10, padding: '3px 8px' }}
                              >
                                取消
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => void load()} disabled={busy} style={{ fontSize: 10, padding: '3px 8px' }}>
                刷新待决列表
              </button>
              <span className="mono muted" style={{ alignSelf: 'center', fontSize: 10 }}>
                确认 / 拒绝即写入书级候选事实账本（幂等，可翻旧账见任务中心）
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
