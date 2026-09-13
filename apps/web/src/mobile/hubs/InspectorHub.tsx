import { useEffect, useState } from 'react'
import { ShieldCheckIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { StoryBrainFactsResponse, ReceiptListResponse, ChangeMatrixResponse } from '../../../server/api'

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
  const [loading, setLoading] = useState(false)
  /** 内联反馈（规格 §25.3：alert → inline）。 */
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!book) {
      setFacts(null)
      setReceipts(null)
      setMatrixData(null)
      return
    }
    let mounted = true
    setLoading(true)
    void Promise.all([
      post<StoryBrainFactsResponse>('/api/story-brain.facts', { root: book.root }).catch(() => null),
      post<ReceiptListResponse>('/api/receipts', { root: book.root }).catch(() => null),
      post<ChangeMatrixResponse>('/api/change-matrix', { root: book.root }).catch(() => null),
    ]).then(([f, r, m]) => {
      if (!mounted) return
      setFacts(f)
      setReceipts(r)
      setMatrixData(m)
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [book])

  const handleRerunMatrix = async (): Promise<void> => {
    if (!book || !matrixData?.matrix.rows[0]) return
    try {
      const res = await post<ChangeMatrixResponse>('/api/change-matrix.rerun', {
        root: book.root,
        traversalId: matrixData.matrix.rows[0].traversalId,
      })
      setMatrixData(res)
    } catch (error) {
      setNotice({ kind: 'err', text: `重新分析失败：${(error as Error).message}` })
    }
  }

  return (
    <>
      {notice !== null && (
        <div
          role="alert"
          className={'mobile-inline-note err'}
          style={{ margin: '10px 18px 0' }}
          data-testid="inspector-notice"
        >
          {notice.text}
        </div>
      )}
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
        <button type="button" className="mobile-action-btn" onClick={() => onOpenDrawer('compliance')}>
          <ShieldCheckIcon className="svg-icon" /><span>敏感词审查</span>
        </button>
      </div>

      <div className="ins-tab-strip">
        <Tab active={activeTab === 'brain'} onClick={() => setActiveTab('brain')}>设定事实</Tab>
        <Tab active={activeTab === 'receipt'} onClick={() => setActiveTab('receipt')}>装配看板</Tab>
        <Tab active={activeTab === 'matrix'} onClick={() => setActiveTab('matrix')}>变更影响</Tab>
        <Tab active={activeTab === 'quality'} onClick={() => setActiveTab('quality')}>质量审查</Tab>
      </div>

      {loading && <div style={{ padding: '20px 18px', color: 'var(--fg-muted-mobile)', fontSize: 12 }}>正在加载真实数据面…</div>}

      {activeTab === 'brain' && (
        <div>
          <div className="mobile-card">
            <div className="mobile-card-header"><span className="mobile-card-title">已确认事实 (Canon)</span><span className="mobile-tag green">{facts?.canon.length ?? 0} 条</span></div>
            {facts?.canon.length ? facts.canon.map((item) => (
              <div key={item.id} className="fact-item-block">
                <div className="fact-item-head"><span>{typeof item.subject === 'string' ? item.subject : item.id}</span><span className="mobile-tag green">第 {item.validFrom ?? 1} 章起</span></div>
                <div style={{ fontSize: 13, color: 'var(--fg-primary-mobile)', lineHeight: 1.5 }}>{item.predicate}: {item.value}</div>
              </div>
            )) : <Empty text="当前没有已加载的 Canon 事实；不展示示例人物或设定。" />}
          </div>
          <div className="mobile-card">
            <div className="mobile-card-header"><span className="mobile-card-title">人物视角认知 (Perspective)</span><span className="mobile-tag accent">真实记录</span></div>
            {facts?.perspective.length ? facts.perspective.map((entry, idx) => (
              <div key={`${entry.holder}-${idx}`} className="fact-item-block">
                <div className="fact-item-head"><span>{entry.level === 'suspects' ? '怀疑' : '坚信'}</span><span>持有者: {entry.holder}</span></div>
                <div style={{ fontSize: 13, color: 'var(--fg-primary-mobile)', lineHeight: 1.5 }}>{entry.presentation}</div>
              </div>
            )) : <Empty text="当前没有已加载的 POV 认知记录。" />}
          </div>
        </div>
      )}

      {activeTab === 'receipt' && (
        <div className="mobile-card">
          <div className="mobile-card-header"><span className="mobile-card-title">上下文编译与凭证</span><span className="mobile-tag green">{receipts?.receipts.length ?? 0} 条</span></div>
          {receipts?.receipts.length ? receipts.receipts.map((receipt) => (
            <div key={receipt.receiptId} className="fact-item-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontFamily: 'var(--font-mono-mobile)' }}>{receipt.receiptId}</div><div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)' }}>第 {receipt.chapterIndex ?? '-'} 章 · {receipt.totalTokens} Tokens</div></div>
              <span className={`mobile-tag ${receipt.hashMatch ? 'green' : 'red'}`}>{receipt.hashMatch ? 'MATCH' : 'MISMATCH'}</span>
            </div>
          )) : <Empty text="当前没有真实 Context Receipt；不显示伪造凭证、Token 消耗或会话状态。" />}
        </div>
      )}

      {activeTab === 'matrix' && (
        <div className="mobile-card">
          <div className="mobile-card-header">
            <span className="mobile-card-title">跨章关联受损影响</span>
            <button type="button" className="mobile-action-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => void handleRerunMatrix()} disabled={!matrixData?.matrix.rows[0]}>重新分析</button>
          </div>
          {matrixData?.matrix.rows.length ? matrixData.matrix.rows.map((row) => {
            const affected = row.cells.filter((cell) => cell.state === 'needs_rework').map((cell) => `第 ${cell.chapterIndex} 章`).join(', ')
            return (
              <div key={row.traversalId} className="fact-item-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontWeight: 600 }}>{row.traversalId}</div><div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)' }}>受波及章：{affected || '无'}</div></div>
                <span style={{ color: row.staleCount > 0 ? 'var(--rose-mobile)' : 'var(--emerald-mobile)', fontSize: 12 }}>{row.staleCount > 0 ? '需重构' : '已收敛'}</span>
              </div>
            )
          }) : <Empty text="当前没有真实变更遍历记录；不展示示例冲突。" />}
        </div>
      )}

      {activeTab === 'quality' && (
        <div className="mobile-card">
          <div className="mobile-card-header"><span className="mobile-card-title">文学与逻辑质量审查</span><span className="mobile-tag">移动端未接入</span></div>
          <Empty text="移动端尚未接入当前章节选择与质量报告，因此不宣称审查通过、无毒点或文风合格。请使用桌面检视塔中的真实质量门。" />
        </div>
      )}
    </>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }): JSX.Element {
  return <button type="button" className={`ins-nav-tab ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="fact-item-block" style={{ color: 'var(--fg-muted-mobile)', fontSize: 12, lineHeight: 1.6 }}>{text}</div>
}
