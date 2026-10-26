import React, { useCallback, useEffect, useState } from 'react'
import type {
  RecycleListDtoResponse,
  RecyclePurgeDtoResponse,
  RecycleRestoreDtoResponse,
  TrashEntryDto,
} from '../../shared/api'
import { post } from '../lib/post'

export interface RecycleBinModalProps {
  isOpen: boolean
  root?: string | null | undefined
  onClose: () => void
  onRestored?: (entry: TrashEntryDto, restoredTo: string) => void
}

export function RecycleBinModal({
  isOpen,
  root,
  onClose,
  onRestored,
}: RecycleBinModalProps): JSX.Element | null {
  const [entries, setEntries] = useState<readonly TrashEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [operatingId, setOperatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [purgeConfirmingId, setPurgeConfirmingId] = useState<string | null>(null)

  const loadEntries = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (root) payload['root'] = root
      const res = await post<RecycleListDtoResponse>('/api/recycle.list', payload)
      setEntries(res.entries)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [root])

  useEffect(() => {
    if (isOpen) {
      setPurgeConfirmingId(null)
      setSuccessMsg(null)
      setError(null)
      void loadEntries()
    }
  }, [isOpen, loadEntries])

  // ESC 键监听关闭
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && operatingId === null) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, operatingId, onClose])

  // 恢复单个条目
  const handleRestore = async (entry: TrashEntryDto) => {
    setError(null)
    setSuccessMsg(null)
    setOperatingId(entry.id)
    try {
      const payload: Record<string, unknown> = { id: entry.id }
      if (root) payload['root'] = root
      const res = await post<RecycleRestoreDtoResponse>('/api/recycle.restore', payload)
      setSuccessMsg(`已成功还原「${entry.name}」至原路径：${res.restoredTo}`)
      await loadEntries()
      onRestored?.(entry, res.restoredTo)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setOperatingId(null)
    }
  }

  // 彻底粉碎删除
  const handlePurge = async (entry: TrashEntryDto) => {
    setError(null)
    setSuccessMsg(null)
    setOperatingId(entry.id)
    try {
      const payload: Record<string, unknown> = { id: entry.id }
      if (root) payload['root'] = root
      await post<RecyclePurgeDtoResponse>('/api/recycle.purge', payload)
      setSuccessMsg(`已彻底粉碎「${entry.name}」`)
      setPurgeConfirmingId(null)
      await loadEntries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setOperatingId(null)
    }
  }

  // 一键彻底排空回收站
  const handlePurgeAll = async () => {
    if (entries.length === 0) return
    setError(null)
    setSuccessMsg(null)
    setOperatingId('purge-all')
    try {
      for (const entry of entries) {
        const payload: Record<string, unknown> = { id: entry.id }
        if (root) payload['root'] = root
        await post<RecyclePurgeDtoResponse>('/api/recycle.purge', payload)
      }
      setSuccessMsg('已彻底排空回收站内全部废弃项目')
      setPurgeConfirmingId(null)
      await loadEntries()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setOperatingId(null)
    }
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recycle-bin-dialog-title"
      data-testid="recycle-bin-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && operatingId === null) onClose()
      }}
    >
      <div
        className="card-shell"
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 10,
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* 标题栏 */}
        <div
          className="card-title"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '16px 20px 12px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div>
            <b id="recycle-bin-dialog-title" style={{ fontSize: 16, color: 'var(--foreground)' }}>
              工作区回收站
            </b>
            <p className="mono muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
              隔离保护区 · 废弃章节与文件软删除存档（原路径占用时绝不覆盖）
            </p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={operatingId !== null}
            aria-label="关闭回收站"
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            ✕
          </button>
        </div>

        {/* 提示信息栏 */}
        {error && (
          <div
            className="wb-error"
            role="alert"
            data-testid="recycle-error"
            style={{ margin: '12px 20px 0', fontSize: 12 }}
          >
            {error}
          </div>
        )}
        {successMsg && (
          <div
            className="mono"
            role="status"
            data-testid="recycle-success"
            style={{
              margin: '12px 20px 0',
              padding: '6px 12px',
              fontSize: 12,
              color: 'var(--success)',
              background: 'rgba(120, 200, 164, 0.1)',
              borderRadius: 4,
              border: '1px solid rgba(120, 200, 164, 0.3)',
            }}
          >
            {successMsg}
          </div>
        )}

        {/* 工具栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="mono muted" style={{ fontSize: 12 }}>
              当前废弃项：<b>{entries.length}</b> 个
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => { void loadEntries() }}
              disabled={loading || operatingId !== null}
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {loading ? '刷新中…' : '刷新列表'}
            </button>
          </div>

          {entries.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {purgeConfirmingId === 'all' ? (
                <>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--danger)' }}>
                    确定清空全部吗？
                  </span>
                  <button
                    type="button"
                    className="btn"
                    data-testid="recycle-confirm-purge-all"
                    onClick={() => { void handlePurgeAll() }}
                    disabled={operatingId !== null}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      color: 'var(--danger)',
                      borderColor: 'var(--danger)',
                    }}
                  >
                    {operatingId === 'purge-all' ? '排空中…' : '确认粉碎全部'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPurgeConfirmingId(null)}
                    disabled={operatingId !== null}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  data-testid="recycle-purge-all-btn"
                  onClick={() => setPurgeConfirmingId('all')}
                  disabled={operatingId !== null}
                  style={{
                    fontSize: 11,
                    padding: '3px 10px',
                    color: 'var(--danger)',
                  }}
                >
                  彻底清空回收站
                </button>
              )}
            </div>
          )}
        </div>

        {/* 列表主体 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
          data-testid="recycle-items-container"
        >
          {loading && entries.length === 0 && (
            <div className="mono muted" style={{ textAlign: 'center', padding: '30px 0' }}>
              正在加载回收站条目…
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div
              className="card"
              data-testid="recycle-empty"
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                background: 'var(--surface-sunken)',
                border: '1px dashed var(--hairline)',
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.6 }}>🗑️</div>
              <b style={{ color: 'var(--foreground)', fontSize: 14 }}>回收站空空如也</b>
              <p className="mono muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
                被废弃的章节、大纲或素材会安全存放于此，可在需要时随时一键还原
              </p>
            </div>
          )}

          {entries.map((item) => {
            const isItemBusy = operatingId === item.id
            const isConfirmingPurge = purgeConfirmingId === item.id
            const dateStr = item.deletedAt
              ? new Date(item.deletedAt).toLocaleString('zh-CN', { hour12: false })
              : '未知时间'

            return (
              <div
                key={item.id}
                className="card"
                data-testid={`recycle-item-${item.id}`}
                style={{
                  padding: '12px 16px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{item.isDirectory ? '📁' : '📄'}</span>
                    <b style={{ fontSize: 13, color: 'var(--foreground)' }}>{item.name}</b>
                    <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>
                      {item.isDirectory ? '目录' : '文件/章节'}
                    </span>
                  </div>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    删除于 {dateStr}
                  </span>
                </div>

                <div className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  原路径：{item.originalPath}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 8,
                    marginTop: 4,
                    borderTop: '1px solid var(--hairline)',
                    paddingTop: 8,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    data-testid={`recycle-restore-${item.id}`}
                    onClick={() => { void handleRestore(item) }}
                    disabled={operatingId !== null}
                    style={{
                      fontSize: 11,
                      padding: '3px 10px',
                      color: 'var(--success)',
                      borderColor: 'rgba(120, 200, 164, 0.4)',
                    }}
                  >
                    {isItemBusy ? '还原中…' : '一键还原'}
                  </button>

                  {isConfirmingPurge ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--danger)' }}>
                        不可恢复，确认？
                      </span>
                      <button
                        type="button"
                        className="btn"
                        data-testid={`recycle-confirm-purge-${item.id}`}
                        onClick={() => { void handlePurge(item) }}
                        disabled={operatingId !== null}
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          color: 'var(--danger)',
                          borderColor: 'var(--danger)',
                        }}
                      >
                        {isItemBusy ? '粉碎中…' : '确认粉碎'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setPurgeConfirmingId(null)}
                        disabled={operatingId !== null}
                        style={{ fontSize: 11, padding: '2px 6px' }}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      data-testid={`recycle-purge-${item.id}`}
                      onClick={() => setPurgeConfirmingId(item.id)}
                      disabled={operatingId !== null}
                      style={{
                        fontSize: 11,
                        padding: '3px 10px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      彻底粉碎
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 底部按钮栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 20px',
            borderTop: '1px solid var(--hairline)',
            background: 'var(--surface-sunken)',
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={operatingId !== null}
            style={{ fontSize: 12, padding: '5px 16px' }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
