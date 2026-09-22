import React, { useState } from 'react'

export interface CreateEntityModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (entity: {
    cardType: 'char' | 'location' | 'item' | 'faction' | 'concept'
    name: string
    brief: string
    details: string
  }) => Promise<void>
}

export function CreateEntityModal({ isOpen, onClose, onSave }: CreateEntityModalProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [cardType, setCardType] = useState<'char' | 'location' | 'item' | 'faction' | 'concept'>('char')
  const [brief, setBrief] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({ cardType, name: name.trim(), brief: brief.trim(), details: details.trim() })
      setName('')
      setBrief('')
      setDetails('')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新建设定卡"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card-shell"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--surface)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div className="card" style={{ padding: 20 }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <b style={{ fontSize: 15 }}>新建设定卡</b>
            <button type="button" className="btn" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
                  设定名称
                  <input
                    className="control"
                    placeholder="如：李火旺、青云门"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    aria-label="设定名称"
                  />
                </label>
                <label style={{ width: 130, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
                  类型
                  <select
                    className="control"
                    value={cardType}
                    onChange={(e) => setCardType(e.target.value as 'char' | 'location' | 'item' | 'faction' | 'concept')}
                    aria-label="设定类型"
                  >
                    <option value="char">人物 (char)</option>
                    <option value="location">地点 (location)</option>
                    <option value="item">物品 (item)</option>
                    <option value="faction">势力 (faction)</option>
                    <option value="concept">概念 (concept)</option>
                  </select>
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
                一句话核心定位（用于检索与提示词）
                <input
                  className="control"
                  placeholder="如：大齐心素，分不清虚实与幻境的迷惘修士"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  aria-label="核心定位"
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }} className="mono muted">
                详细设定描述（性格/背景/能力）
                <textarea
                  className="control"
                  placeholder="详细背景、性格特征、关键道具或功法境界..."
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={4}
                  style={{ resize: 'vertical' }}
                  aria-label="详细设定"
                />
              </label>

              {error && <p className="wb-error" role="alert" style={{ margin: 0 }}>错误：{error}</p>}

              <div className="actions" style={{ marginTop: 8, justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? '保存中…' : '保存入设定库'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
