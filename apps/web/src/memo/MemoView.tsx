/**
 * 备忘录（MemoView）视图（OpenWrite 对标切片 · 工单 22）：
 * - 与书无关的作者便签：灵感、大纲碎片、待办备忘；跨作品常驻。
 * - 数据面（/api/memo 中间件直出，本地持久化）：
 *   POST {action:'list'} → MemoListResponse；create/update/delete → MemoMutationResponse。
 * - 本地模式跟随 local_user 主体；hosted 模式按登录用户隔离。
 */
import { useCallback, useEffect, useState } from 'react'
import type { MemoListResponse, MemoMutationResponse, MemoNote } from '../../server/api'
import { post } from '../lib/post'

const FIELD_STYLE = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 12,
  background: 'var(--surface-sunken)',
  border: '1px solid var(--hairline)',
  borderRadius: 6,
  color: 'var(--fg-pure)',
} as const

export function MemoView(): JSX.Element {
  const [notes, setNotes] = useState<readonly MemoNote[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingContent, setEditingContent] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await post<MemoListResponse>('/api/memo', { action: 'list' })
      setNotes(res.notes)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleCreate = async (): Promise<void> => {
    if (content.trim() === '') {
      setError('便签内容不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await post<MemoMutationResponse>('/api/memo', { action: 'create', title, content })
      setTitle('')
      setContent('')
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (note: MemoNote): void => {
    setEditingId(note.id)
    setEditingTitle(note.title)
    setEditingContent(note.content)
    setError(null)
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (editingId === null) return
    if (editingContent.trim() === '') {
      setError('便签内容不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await post<MemoMutationResponse>('/api/memo', { action: 'update', id: editingId, title: editingTitle, content: editingContent })
      setEditingId(null)
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await post<MemoMutationResponse>('/api/memo', { action: 'delete', id })
      if (editingId === id) setEditingId(null)
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="center solo" aria-label="memo-view">
      <div className="chapterbar">
        <h1>备忘录</h1>
        <span className="meta">跨作品的作者便签 · 本地持久化</span>
        <div className="save">
          <button className="btn" onClick={() => { void load() }} disabled={busy} style={{ fontSize: 10, padding: '4px 8px' }}>
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <div className="conversation">
        {error !== null && (
          <p className="wb-error" role="alert" data-testid="memo-error">
            错误：{error}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }} data-testid="memo-create">
          <input
            type="text"
            placeholder="标题（可选）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="memo-input-title"
            style={FIELD_STYLE}
          />
          <textarea
            rows={3}
            placeholder="记下灵感、大纲碎片、待办备忘…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            data-testid="memo-input-content"
            style={{ ...FIELD_STYLE, resize: 'vertical' }}
          />
          <button
            className="btn-primary"
            onClick={() => { void handleCreate() }}
            disabled={busy}
            data-testid="memo-save-new"
            style={{ alignSelf: 'flex-start', fontSize: 12, padding: '7px 14px' }}
          >
            保存便签
          </button>
        </div>

        {notes.length === 0 ? (
          <p className="muted" data-testid="memo-empty">
            还没有便签。灵感来了就记一笔——它不属于任何一本书，随时可查。
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="memo-list">
            {notes.map((note) => (
              <div
                key={note.id}
                data-testid="memo-item"
                style={{ padding: 12, background: 'var(--surface-sunken)', borderRadius: 8, border: '1px solid var(--hairline)' }}
              >
                {editingId === note.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      data-testid="memo-edit-title"
                      style={FIELD_STYLE}
                    />
                    <textarea
                      rows={4}
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      data-testid="memo-edit-content"
                      style={{ ...FIELD_STYLE, resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-primary" onClick={() => { void handleSaveEdit() }} disabled={busy} data-testid="memo-save-edit" style={{ fontSize: 11, padding: '5px 10px' }}>
                        保存
                      </button>
                      <button className="btn" onClick={() => setEditingId(null)} data-testid="memo-cancel-edit" style={{ fontSize: 11, padding: '5px 10px' }}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <b style={{ fontSize: 13 }}>{note.title === '' ? '（无标题）' : note.title}</b>
                      <span className="muted" style={{ fontSize: 10 }}>{note.updatedAt.slice(0, 19).replace('T', ' ')}</span>
                    </div>
                    <p style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '6px 0 8px', lineHeight: 1.7 }}>{note.content}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" onClick={() => startEdit(note)} data-testid="memo-edit" style={{ fontSize: 10, padding: '3px 8px' }}>
                        编辑
                      </button>
                      <button className="btn" onClick={() => { void handleDelete(note.id) }} disabled={busy} data-testid="memo-delete" style={{ fontSize: 10, padding: '3px 8px' }}>
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
