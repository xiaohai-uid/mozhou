/**
 * 装配看板（实现票 T42）：Context Receipt 列表 + 逐条装配分解 + 额度条 +
 * Replay Inputs + 续跑入口。
 *
 * 数据面（/api 中间件直出，组件 type-only 直引契约形状，零 any）：
 * - /api/receipts → 列表（id/章/tok/INV-R6 hash match 真伪）
 * - /api/receipt   → 详情（loadReceiptForResume 直出 + 会话投影续跑判态）
 *
 * 呈现纪律：
 * - hash match 徽标 = 服务端重算 inputsDigest 真伪（mismatch 显式告警，不静默）；
 * - 续跑入口显式呈现进行态（会话投影）：可恢复（sessionOpen）→ 指向工作台继续；
 *   无会话 → 显式「无开放生产会话」；绝不假装可续跑。
 * - 额度条四段 = reserved（两阶段预订，含 converge 收缩） / story（正文保底配额
 *   actual）/ fixed（structural 固定注入段）/ cap（contextWindow 天花板），
 *   全由 entries + replayInputs 纯函数聚合，不依赖任何估算。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReceiptDetailResponse, ReceiptListResponse } from '../../shared/api'
import { post } from '../lib/post'

const STAGE_TOK: Record<string, 'reserved' | 'story' | 'fixed'> = {
  structural: 'fixed',
  reserve: 'reserved',
  converge: 'reserved',
  story_text: 'story',
}

const STAGE_LABEL: Record<string, string> = {
  structural: 'fixed',
  reserve: 'reserved',
  converge: 'converge',
  story_text: 'story',
  recall_filter: 'recall_filter',
}

const CHANNEL_LABEL: Record<string, string> = {
  structural: '结构层注入',
  keyword: '关键词通道',
  graph_khop: '因果图 k-hop',
  embedding: '向量兜底通道',
  manual_pin: '作者手动钉选',
}

export function ReceiptPanel({
  root,
  onResume,
  initialReceiptId,
}: {
  root: string
  /** 续跑入口：会话可恢复时显示「回到工作台继续」，由 App 切 view 到工作台。 */
  onResume?: () => void
  /**
   * 正文侧「为什么这么写」带来的预选回执（T2）。
   *
   * 面板挂载即拉取该条详情，而不是等作者在列表里再点一次；切章不会改写它——
   * 父级每次换 id 才重新加载，换成 null 则回到「未选中」态。
   */
  initialReceiptId?: string | null | undefined
}): JSX.Element {
  const [list, setList] = useState<ReceiptListResponse['receipts']>([])
  const [detail, setDetail] = useState<ReceiptDetailResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadList = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const data = await post<ReceiptListResponse>('/api/receipts', { root })
      setList(data.receipts)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [root])

  const loadDetail = useCallback(
    async (receiptId: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const data = await post<ReceiptDetailResponse>('/api/receipt', { root, receiptId })
        setDetail(data)
        setSelectedId(receiptId)
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [root],
  )

  useEffect(() => { void loadList() }, [loadList])

  // T2：正文侧点「为什么这么写」带 id 进来时直接拉详情，不必在列表里再点一次。
  // 失败不回退成空态——错误走既有的 error 通道，作者看得到「读不到」而不是「没有」。
  useEffect(() => {
    if (initialReceiptId === null || initialReceiptId === undefined) return
    void loadDetail(initialReceiptId)
  }, [initialReceiptId, loadDetail])

  const budget = useMemo(() => {
    if (detail === null) return null
    const entries = detail.receipt.entries
    let reserved = 0
    let story = 0
    let fixed = 0
    for (const entry of entries) {
      const kind = STAGE_TOK[entry.stage]
      const tokens = entry.tokens ?? 0
      if (kind === 'reserved') reserved += tokens
      else if (kind === 'story') story += tokens
      else if (kind === 'fixed') fixed += tokens
    }
    const cap = detail.receipt.replayInputs.contextWindowTokens
    const used = reserved + story + fixed
    const slack = cap - used
    return { reserved, story, fixed, cap, used, slack }
  }, [detail])

  const selectedRow = list.find((row) => row.receiptId === selectedId) ?? null

  return (
    <section aria-label="receipt-panel">
      <div className="panel-head">
        <div>
          <h2>装配看板</h2>
          <p>Context Receipt · 可确定性重算</p>
        </div>
        <span className="tag">{list.length} receipts</span>
      </div>

      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => { void loadList() }} disabled={busy}>
          {busy ? '读取中…' : '刷新'}
        </button>
        <span className="mono muted" style={{ alignSelf: 'center' }}>
          ReadReceipt 读面 · INV-R6 hash match
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="wb-error">
          错误：{error}
        </p>
      )}

      <div className="card-shell" data-testid="receipt-list">
        <div className="card">
          <div className="card-title">
            <b>Receipt 列表</b>
            <span className="muted">点击查看详情</span>
          </div>
          {!busy && list.length === 0 && (
            <p className="muted" data-testid="receipts-empty" style={{ margin: 0 }}>
              暂无 Context Receipt——完成一次装配（compile）后出现在这里。
            </p>
          )}
          {list.map((row) => (
            <button
              key={row.receiptId}
              type="button"
              className="receipt-row"
              data-receipt-id={row.receiptId}
              aria-pressed={row.receiptId === selectedId}
              onClick={() => { void loadDetail(row.receiptId) }}
            >
              <span>
                {row.chapterIndex === null ? '·' : 'ch' + row.chapterIndex} · {row.receiptId}
              </span>
              <code>{row.totalTokens} tok</code>
              <b className={row.hashMatch ? 'verdict pass' : 'verdict blocking'}>
                {row.hashMatch ? 'hash match' : 'hash mismatch'}
              </b>
            </button>
          ))}
        </div>
      </div>

      {detail !== null && budget !== null && (
        <>
          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>额度分配</b>
                <span className="mono muted">cap {budget.cap.toLocaleString()}</span>
              </div>
              <div className="budget" data-testid="receipt-budget">
                <span className="reserved" style={{ flexGrow: budget.reserved }} />
                <span className="story" style={{ flexGrow: budget.story }} />
                <span className="fixed" style={{ flexGrow: budget.fixed }} />
                <span style={{ flexGrow: budget.slack }} />
              </div>
              <div className="mono muted" data-testid="receipt-budget-text">
                reserved {budget.reserved.toLocaleString()} · story {budget.story.toLocaleString()} · fixed {budget.fixed.toLocaleString()} · slack {budget.slack.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>通道贡献</b>
                <span className="muted">哪条召回把什么送进了窗口</span>
              </div>
              <div data-testid="receipt-channel-summary">
                {(detail.receipt.channelSummary ?? []).length === 0 && (
                  <p className="muted" style={{ margin: 0 }}>
                    本次回执没有通道汇总——多为装配早于该字段的旧回执。
                  </p>
                )}
                {(detail.receipt.channelSummary ?? []).map((row) => (
                  <div className="receipt-row" key={row.channel} data-channel={row.channel}>
                    <span>
                      {CHANNEL_LABEL[row.channel] ?? row.channel}
                      {row.exclusionReasons.length > 0 && (
                        <em className="muted" style={{ display: 'block', fontStyle: 'normal' }}>
                          落选 {row.exclusionReasons
                            .map((reason) => reason.reason + '×' + reason.count)
                            .join(' · ')}
                        </em>
                      )}
                    </span>
                    <code>
                      入 {row.included}/{row.entries} · {(row.tokens).toLocaleString()} tok
                    </code>
                    <b className={row.excluded > 0 ? 'verdict blocking' : 'verdict pass'}>
                      落选 {row.excluded}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>逐条装配分解</b>
                <span className="muted">按 desirability</span>
              </div>
              <div data-testid="receipt-entries">
                {detail.receipt.entries.map((entry) => (
                  <div className="receipt-row" key={entry.order} data-entry-stage={entry.stage}>
                    <span>
                      {entry.identifier}
                      {!entry.included && entry.exclusionReason !== undefined && (
                        <em className="muted" style={{ display: 'block', fontStyle: 'normal' }}>
                          excluded · {entry.exclusionReason}
                        </em>
                      )}
                    </span>
                    <code>{STAGE_LABEL[entry.stage] ?? entry.stage}</code>
                    <b>{(entry.tokens ?? 0).toLocaleString()}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card-shell">
            <div className="card">
              <div className="card-title">
                <b>Replay Inputs</b>
                <span className={detail.hashMatch ? 'verdict pass' : 'verdict blocking'}>
                  {detail.hashMatch ? 'hash match' : 'hash mismatch'}
                </span>
              </div>
              <div className="replay mono" data-testid="receipt-replay">
                <div>
                  tokenizer
                  <br />
                  {detail.receipt.replayInputs.tokenizerVersion}
                </div>
                <div>
                  compiler
                  <br />
                  {detail.receipt.replayInputs.configVersion.slice(0, 12)}
                </div>
                <div>
                  candidates
                  <br />
                  {detail.receipt.replayInputs.candidates.length} ordered
                </div>
                <div>
                  digest
                  <br />
                  {detail.receipt.inputsDigest.slice(0, 4)}…{detail.receipt.inputsDigest.slice(-4)}
                </div>
              </div>
              <div className="mono muted" style={{ marginTop: 8 }}>
                assembledBy {detail.receipt.assembledBy} · taskType {detail.receipt.taskType}
              </div>

              <div className="resume" data-testid="receipt-resume">
                {detail.resume.sessionOpen ? (
                  <>
                    <span className="status-dot" style={{ background: 'var(--success)' }} />
                    <span>
                      可恢复：会话在 {detail.resume.currentStep ?? '?'} 步（last receipt {detail.resume.lastReceiptId ?? '—'}）——继续写作将在工作台续接本轮。
                    </span>
                  </>
                ) : detail.resume.committed ? (
                  <>
                    <span className="status-dot" style={{ background: 'var(--text-faint)' }} />
                    已提交：本章正典已提交，无开放生产会话。
                  </>
                ) : (
                  <>
                    <span className="status-dot" />
                    无开放生产会话：该 Receipt 未与当前任何章节窗口关联。
                  </>
                )}
              </div>
              {detail.resume.sessionOpen && (
                <>
                  <p className="mono muted" style={{ margin: '6px 0 0' }}>
                    续跑语义：readReceiptForResume 按 receiptId 取回产物（不重编译），
                    您可回到工作台继续本章生产。
                  </p>
                  {onResume !== undefined && (
                    <button className="btn" style={{ marginTop: 8 }} onClick={onResume}>
                      回到工作台继续
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
      {selectedRow !== null && detail === null && busy && (
        <p className="muted" style={{ margin: '8px 0 0' }}>
          读取 {selectedRow.receiptId}…
        </p>
      )}
    </section>
  )
}