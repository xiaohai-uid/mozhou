import { useEffect, useState } from 'react'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'

export interface VersionHistoryDrawerProps {
  onClose: () => void
  book?: BookInfo | null
  chapterIndex?: number
  onReverted?: (newRevision: number) => void
}

export interface ChapterRevisionSummary {
  revision: number
  wordCount: number
  sha256: string
  savedAt: string
  title?: string | undefined
}

export interface ParagraphDiffItem {
  kind: 'added' | 'removed' | 'unchanged'
  text: string
  index: number
}

export function VersionHistoryDrawer({
  onClose,
  book,
  chapterIndex = 1,
  onReverted,
}: VersionHistoryDrawerProps): JSX.Element {
  const [revisions, setRevisions] = useState<readonly ChapterRevisionSummary[]>([])
  const [currentRevision, setCurrentRevision] = useState<number | null>(null)
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const [diffBaseRevision, setDiffBaseRevision] = useState<number | null>(null)
  const [diffs, setDiffs] = useState<readonly ParagraphDiffItem[] | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [reverting, setReverting] = useState(false)

  // 加载版本历史
  useEffect(() => {
    if (!book) {
      setRevisions([])
      setCurrentRevision(null)
      return
    }
    let mounted = true
    post<{
      ok: boolean
      chapterIndex: number
      currentRevision: number
      revisions: readonly ChapterRevisionSummary[]
    }>('/api/chapter.history', {
      root: book.root,
      chapterIndex,
    })
      .then((data) => {
        if (!mounted) return
        if (data && data.ok) {
          setRevisions(data.revisions || [])
          setCurrentRevision(data.currentRevision)
          if (data.revisions && data.revisions.length > 1) {
            setSelectedRevision(data.revisions[1]?.revision ?? null)
            setDiffBaseRevision(data.currentRevision)
          } else if (data.revisions && data.revisions.length === 1) {
            setSelectedRevision(data.revisions[0]?.revision ?? null)
            setDiffBaseRevision(data.currentRevision)
          }
        }
      })
      .catch(() => {
        if (mounted) setRevisions([])
      })

    return () => {
      mounted = false
    }
  }, [book, chapterIndex])

  // 当选择不同版本时计算段落 Diff
  useEffect(() => {
    if (!book || selectedRevision === null || diffBaseRevision === null || selectedRevision === diffBaseRevision) {
      setDiffs(null)
      return
    }
    let mounted = true
    setDiffLoading(true)
    post<{
      ok: boolean
      chapterIndex: number
      fromRevision: number
      toRevision: number
      diffs: readonly ParagraphDiffItem[]
    }>('/api/chapter.history.diff', {
      root: book.root,
      chapterIndex,
      fromRevision: selectedRevision,
      toRevision: diffBaseRevision,
    })
      .then((data) => {
        if (!mounted) return
        if (data && data.ok) {
          setDiffs(data.diffs)
        }
      })
      .catch(() => {
        if (mounted) setDiffs(null)
      })
      .finally(() => {
        if (mounted) setDiffLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [book, chapterIndex, selectedRevision, diffBaseRevision])

  // 执行恢复操作：创建新版本
  const handleRestore = async (targetRev: number) => {
    if (!book || reverting) return
    setReverting(true)
    setStatusMsg(null)
    try {
      const res = await post<{
        ok: boolean
        chapterIndex: number
        restoredFromRevision: number
        newRevision: number
        revision: number
      }>('/api/chapter.history.restore', {
        root: book.root,
        chapterIndex,
        targetRevision: targetRev,
      })
      if (res && res.ok) {
        setStatusMsg({
          kind: 'ok',
          text: `恢复成功：已创建新版本 Rev ${res.newRevision}（基于 Rev ${targetRev}），历史版本完整保留。`,
        })
        setCurrentRevision(res.newRevision)
        onReverted?.(res.newRevision)
        const updated = await post<{
          ok: boolean
          revisions: readonly ChapterRevisionSummary[]
          currentRevision: number
        }>('/api/chapter.history', {
          root: book.root,
          chapterIndex,
        })
        if (updated && updated.ok) {
          setRevisions(updated.revisions)
          setCurrentRevision(updated.currentRevision)
        }
      }
    } catch (error) {
      setStatusMsg({ kind: 'err', text: `恢复失败：${(error as Error).message}` })
    } finally {
      setReverting(false)
    }
  }

  // 诚实未接入/无数据判定：只有真实接入并获取到修订历史版本后才移除未接入标注
  if (!book || revisions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
            版本历史尚未接入（云端时光机尚未接入）
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
            Technical Preview 不生成虚构快照、不展示不存在的 Diff。本地各章节版本修订与状态已由 LocalDataPlane 守护。
          </div>
        </div>

        <div
          className="mobile-card"
          style={{
            margin: 0,
            background: 'var(--surface-core-mobile)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
            本地正典章节守护状态
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', lineHeight: 1.6 }}>
            • 本地修订序号：每章以严格 revision 递增，防外部覆盖冲突
            <br />
            • 写前哈希校验：保障正文保存前磁盘内容未被第三方静默改写
            <br />
            • 全量快照：可随时在「云同步与备份」中生成 C5 安全 ZIP 归档
          </div>
        </div>

        <button type="button" className="mobile-action-btn" onClick={onClose}>
          关闭
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {statusMsg && (
        <div className={`mobile-inline-note ${statusMsg.kind}`} style={{ margin: 0 }}>
          {statusMsg.text}
        </div>
      )}

      {/* 真实接入后的版本时光机 */}
      <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
            第 {chapterIndex} 章 · 版本时光机
          </div>
          <span className="mobile-tag accent">
            当前 Rev {currentRevision ?? '—'}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
          查看历史段落 Diff 对比；恢复将创建递增新版本并永久保留历史。
        </div>

        {/* 版本时间线列表 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary-mobile)', marginBottom: 6 }}>
            历史版本列表
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {revisions.map((rev) => (
              <button
                type="button"
                key={rev.revision}
                className={`history-rev-chip ${selectedRevision === rev.revision ? 'selected' : ''}`}
                onClick={() => setSelectedRevision(rev.revision)}
                data-testid={`history-chip-r${rev.revision}`}
              >
                Rev {rev.revision} ({rev.wordCount}字)
              </button>
            ))}
          </div>
        </div>

        {/* 选定版本操作 */}
        {selectedRevision !== null && (
          <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--surface-raised-mobile)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--fg-primary-mobile)' }}>
                选中版本: <b>Rev {selectedRevision}</b>
              </span>
              {selectedRevision !== currentRevision && (
                <button
                  type="button"
                  className="mobile-action-btn"
                  style={{ minHeight: 32, padding: '0 10px', fontSize: 11.5 }}
                  onClick={() => {
                    void handleRestore(selectedRevision)
                  }}
                  disabled={reverting}
                  data-testid="restore-version-btn"
                >
                  {reverting ? '正在恢复...' : `恢复此版本 (Rev ${selectedRevision})`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 段落级 Diff 对比展示 */}
      {selectedRevision !== null && diffBaseRevision !== null && selectedRevision !== diffBaseRevision && (
        <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-primary-mobile)', marginBottom: 8 }}>
            段落级 Diff 对比（Rev {selectedRevision} vs 当前 Rev {diffBaseRevision}）
          </div>
          {diffLoading ? (
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>正在计算段落差异...</div>
          ) : diffs && diffs.length > 0 ? (
            <div style={{ maxHeight: 240, overflowY: 'auto' }} data-testid="diff-container">
              {diffs.map((d, i) => (
                <div key={i} className={`diff-item ${d.kind}`}>
                  {d.kind === 'added' && <span style={{ fontWeight: 600, marginRight: 4 }}>[+新增] </span>}
                  {d.kind === 'removed' && <span style={{ fontWeight: 600, marginRight: 4 }}>[-删除] </span>}
                  {d.text}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>两个版本正文完全一致。</div>
          )}
        </div>
      )}

      <button type="button" className="mobile-action-btn" onClick={onClose}>
        关闭时光机
      </button>
    </div>
  )
}
