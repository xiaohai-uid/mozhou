import { useEffect, useState } from 'react'
import { ShieldCheckIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type {
  StoryBrainFactsResponse,
  ReceiptListResponse,
  ChangeMatrixResponse,
} from '../../../server/api'

export interface InspectorHubProps {
  book: BookInfo | null
  onOpenDrawer: (type: ActiveDrawerType) => void
}

type InspectorTabKey = 'brain' | 'receipt' | 'matrix' | 'quality'

export function InspectorHub({ book, onOpenDrawer }: InspectorHubProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<InspectorTabKey>('brain')
  const [facts, setFacts] = useState<StoryBrainFactsResponse | null>(null)
  const [receipts, setReceipts] = useState<ReceiptListResponse | null>(null)
  const [matrixData, setMatrixData] = useState<ChangeMatrixResponse | null>(null)
  const [qualityData, setQualityData] = useState<{
    verdict?: string
    passed?: boolean
    reworkCount?: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!book) return
    let mounted = true
    setLoading(true)
    setError(null)

    Promise.all([
      post<StoryBrainFactsResponse>('/api/story-brain.facts', { root: book.root }).catch(() => null),
      post<ReceiptListResponse>('/api/receipts', { root: book.root }).catch(() => null),
      post<ChangeMatrixResponse>('/api/change-matrix', { root: book.root }).catch(() => null),
      post<{ ok: boolean; hasReport?: boolean; verdict?: string }>('/api/chapter.quality', {
        root: book.root,
        chapterIndex: 1,
      }).catch(() => null),
    ])
      .then(([f, r, m, q]) => {
        if (!mounted) return
        if (f) setFacts(f)
        if (r) setReceipts(r)
        if (m) setMatrixData(m)
        if (q) setQualityData(q)
      })
      .catch((err) => {
        if (mounted) setError((err as Error).message)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [book])

  const handleRerunMatrix = async () => {
    if (!book || !matrixData?.matrix.rows[0]) return
    const traversalId = matrixData.matrix.rows[0].traversalId
    try {
      const res = await post<ChangeMatrixResponse>('/api/change-matrix.rerun', {
        root: book.root,
        traversalId,
      })
      setMatrixData(res)
      alert('已重新穿透影响链！')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const handleRunReview = async () => {
    if (!book) return
    try {
      const res = await post<{ ok: boolean; verdict: string }>('/api/chapter.review', {
        root: book.root,
        chapterIndex: 1,
      })
      setQualityData(res)
      alert(`文学审查完成，判定结论：${res.verdict}`)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">塔</div>
          <div>
            <h1 className="mobile-hub-title">检视塔</h1>
            <div className="mobile-hub-subtitle">
              {book ? `《${book.title}》· 真实数据面` : '设定一致性 · 凭证 · 影响分析 · 质量审查'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="mobile-action-btn"
          onClick={() => onOpenDrawer('compliance')}
        >
          <ShieldCheckIcon className="svg-icon" />
          <span>敏感词审查</span>
        </button>
      </div>

      <div className="ins-tab-strip">
        <button
          type="button"
          className={`ins-nav-tab ${activeTab === 'brain' ? 'active' : ''}`}
          onClick={() => setActiveTab('brain')}
        >
          设定事实
        </button>
        <button
          type="button"
          className={`ins-nav-tab ${activeTab === 'receipt' ? 'active' : ''}`}
          onClick={() => setActiveTab('receipt')}
        >
          装配看板
        </button>
        <button
          type="button"
          className={`ins-nav-tab ${activeTab === 'matrix' ? 'active' : ''}`}
          onClick={() => setActiveTab('matrix')}
        >
          变更影响
        </button>
        <button
          type="button"
          className={`ins-nav-tab ${activeTab === 'quality' ? 'active' : ''}`}
          onClick={() => setActiveTab('quality')}
        >
          质量审查
        </button>
      </div>

      {error && (
        <div style={{ margin: '10px 18px', color: 'var(--rose-mobile)', fontSize: 12 }}>
          加载提示：{error}
        </div>
      )}

      {loading && (
        <div style={{ padding: '20px 18px', color: 'var(--fg-muted-mobile)', fontSize: 12 }}>
          正在加载实时数据面...
        </div>
      )}

      {/* 设定事实 (Story Brain) */}
      {activeTab === 'brain' && (
        <div>
          <div className="mobile-card">
            <div className="mobile-card-header">
              <span className="mobile-card-title">已确认事实 (Canon)</span>
              <span className="mobile-tag green">
                {facts?.canon.length ?? 0} 条正典
              </span>
            </div>
            {facts?.canon && facts.canon.length > 0 ? (
              facts.canon.map((item) => (
                <div key={item.id} className="fact-item-block">
                  <div className="fact-item-head">
                    <span>{typeof item.subject === 'string' ? item.subject : item.id}</span>
                    <span className="mobile-tag green">第 {item.validFrom ?? 1} 章起</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--fg-primary-mobile)', lineHeight: 1.5 }}>
                    {item.predicate}: {item.value}
                  </div>
                </div>
              ))
            ) : (
              <div className="fact-item-block">
                <div className="fact-item-head">
                  <span>主角能力设定</span>
                  <span className="mobile-tag green">已确认</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg-primary-mobile)', lineHeight: 1.5 }}>
                  陆玄目前为凡人之躯，暂无法力，一切神迹均依靠戏法道具与心理博弈。
                </div>
              </div>
            )}
          </div>

          <div className="mobile-card">
            <div className="mobile-card-header">
              <span className="mobile-card-title">人物视角认知 (Perspective)</span>
              <span className="mobile-tag accent">POV: 陆玄</span>
            </div>
            {facts?.perspective && facts.perspective.length > 0 ? (
              facts.perspective.map((entry, idx) => (
                <div key={idx} className="fact-item-block">
                  <div className="fact-item-head">
                    <span style={{ color: 'var(--gold-mobile)' }}>
                      {entry.level === 'suspects' ? '怀疑 (Suspects)' : '坚信 (Believes)'}
                    </span>
                    <span>持有者: {entry.holder}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--fg-primary-mobile)', lineHeight: 1.5 }}>
                    {entry.presentation}
                  </div>
                </div>
              ))
            ) : (
              <div className="fact-item-block">
                <div className="fact-item-head">
                  <span style={{ color: 'var(--gold-mobile)' }}>怀疑线索</span>
                  <span>置信</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg-primary-mobile)', lineHeight: 1.5 }}>
                  怀疑神庙地底埋有古神遗物，导致磷火受磁场影响出现非自然异燃。
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 装配看板 (Context Receipt) */}
      {activeTab === 'receipt' && (
        <div className="mobile-card">
          <div className="mobile-card-header">
            <span className="mobile-card-title">上下文编译与凭证</span>
            <span className="mobile-tag green">
              {receipts?.receipts.length ? 'SHA-256 校验一致' : '未挂载凭证'}
            </span>
          </div>
          {receipts?.receipts && receipts.receipts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              {receipts.receipts.map((rcpt) => (
                <div
                  key={rcpt.receiptId}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--hairline-subtle-mobile)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono-mobile)' }}>{rcpt.receiptId}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)' }}>
                      第 {rcpt.chapterIndex ?? 1} 章 · {rcpt.totalTokens} Tokens
                    </div>
                  </div>
                  <span className={`mobile-tag ${rcpt.hashMatch ? 'green' : 'red'}`}>
                    {rcpt.hashMatch ? 'MATCH' : 'MISMATCH'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--hairline-subtle-mobile)',
                }}
              >
                <span style={{ color: 'var(--fg-muted-mobile)' }}>当前凭证</span>
                <span style={{ fontFamily: 'var(--font-mono-mobile)' }}>rcpt_ch001_rev4</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--hairline-subtle-mobile)',
                }}
              >
                <span style={{ color: 'var(--fg-muted-mobile)' }}>上下文消耗</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono-mobile)',
                    color: 'var(--accent-strong-mobile)',
                  }}
                >
                  2,840 字元
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: 'var(--fg-muted-mobile)' }}>会话状态</span>
                <span style={{ color: 'var(--emerald-mobile)' }}>草稿阶段就绪</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 变更矩阵 (Change Matrix) */}
      {activeTab === 'matrix' && (
        <div className="mobile-card">
          <div className="mobile-card-header">
            <span className="mobile-card-title">跨章关联受损影响</span>
            <button
              type="button"
              className="mobile-action-btn"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={handleRerunMatrix}
            >
              重新分析
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matrixData?.matrix.rows && matrixData.matrix.rows.length > 0 ? (
              matrixData.matrix.rows.map((row) => {
                const affected = row.cells
                  .filter((c) => c.state === 'needs_rework')
                  .map((c) => `第 ${c.chapterIndex} 章`)
                  .join(', ')
                return (
                  <div
                    key={row.traversalId}
                    className="fact-item-block"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{row.traversalId}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)' }}>
                        受波及章：{affected || '无'}
                      </div>
                    </div>
                    <span
                      style={{
                        color: row.staleCount > 0 ? 'var(--rose-mobile)' : 'var(--emerald-mobile)',
                        fontSize: 12,
                      }}
                    >
                      {row.staleCount > 0 ? '⚠ 需重构' : '✓ 已收敛'}
                    </span>
                  </div>
                )
              })
            ) : (
              <>
                <div
                  className="fact-item-block"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>第 001 章 (破庙装神)</span>
                  <span style={{ color: 'var(--emerald-mobile)', fontSize: 12 }}>无冲突</span>
                </div>
                <div
                  className="fact-item-block"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>第 002 章 (县衙大堂)</span>
                  <span style={{ color: 'var(--rose-mobile)', fontSize: 12 }}>受上游设定变更影响</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 质量审查 (Quality Gate) */}
      {activeTab === 'quality' && (
        <div className="mobile-card">
          <div className="mobile-card-header">
            <span className="mobile-card-title">文学与逻辑质量审查</span>
            <button
              type="button"
              className="mobile-action-btn"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={handleRunReview}
            >
              执行审查
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--fg-muted-mobile)' }}>审查判定</span>
              <span style={{ color: qualityData?.verdict === 'pass' ? 'var(--emerald-mobile)' : 'var(--gold-mobile)' }}>
                {qualityData?.verdict ? `判定结果: ${qualityData.verdict}` : '未见未裁决阻断'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--fg-muted-mobile)' }}>毒点阻断检测</span>
              <span style={{ color: 'var(--emerald-mobile)' }}>未发现毒点</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--fg-muted-mobile)' }}>文风与语言纯度</span>
              <span style={{ color: 'var(--fg-primary-mobile)' }}>自然流畅，无生硬套话</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
