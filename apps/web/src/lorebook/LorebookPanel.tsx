/**
 * 世界书面板（检视塔 tab）— 对标 SillyTavern World Info 管理：
 * 条目列表（关键词/启用态）+ 新增/编辑（id 幂等 upsert）+ 删除。
 * 命中注入在生成链路自动生效（draftContext → compile → scanLorebookTriggers）。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'

interface LorebookEntry {
  readonly id: string
  readonly title: string
  readonly keywords: readonly string[]
  readonly content: string
  readonly enabled: boolean
}

interface LorebookListResponse {
  readonly ok: boolean
  readonly entries?: readonly LorebookEntry[]
  readonly error?: string
}

export interface LorebookPanelProps {
  root: string | null
}

function mintEntryId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (typeof g.crypto?.randomUUID === 'function') {
    return `lb_${g.crypto.randomUUID()}`
  }
  return `lb_${Date.now().toString(16)}`
}

const EMPTY_FORM = { id: '', title: '', keywords: '', content: '' }

export function LorebookPanel({ root }: LorebookPanelProps): JSX.Element {
  const [entries, setEntries] = useState<readonly LorebookEntry[]>([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (root === null) return
    try {
      const res = await post<LorebookListResponse>('/api/lorebook.list', { root })
      if (!res.ok || res.entries === undefined) throw new Error(res.error ?? '读取世界书失败')
      setEntries(res.entries)
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [root])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (): Promise<void> => {
    if (root === null) return
    const keywords = form.keywords.split(/[,，、]/).map((k) => k.trim()).filter((k) => k.length > 0)
    setBusy(true)
    try {
      const res = await post<LorebookListResponse>('/api/lorebook.upsert', {
        root,
        entry: {
          id: form.id !== '' ? form.id : mintEntryId(),
          title: form.title,
          keywords,
          content: form.content,
          enabled: true,
        },
      })
      if (!res.ok || res.entries === undefined) throw new Error(res.error ?? '保存世界书条目失败')
      setEntries(res.entries)
      setForm(EMPTY_FORM)
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleToggle = async (entry: LorebookEntry): Promise<void> => {
    if (root === null) return
    setBusy(true)
    try {
      const res = await post<LorebookListResponse>('/api/lorebook.upsert', {
        root,
        entry: { ...entry, enabled: !entry.enabled },
      })
      if (!res.ok || res.entries === undefined) throw new Error(res.error ?? '切换启用态失败')
      setEntries(res.entries)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (root === null) return
    setBusy(true)
    try {
      const res = await post<LorebookListResponse>('/api/lorebook.delete', { root, id })
      if (!res.ok || res.entries === undefined) throw new Error(res.error ?? '删除世界书条目失败')
      setEntries(res.entries)
      if (form.id === id) setForm(EMPTY_FORM)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (root === null) {
    return (
      <div className="card" data-testid="lorebook-empty">
        <b>世界书需要先建书</b>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.7 }}>
          先在工作台创建或打开作品；世界书条目按关键词触发，命中后自动注入章节生成的装配上下文。
        </p>
      </div>
    )
  }

  return (
    <div className="card" data-testid="lorebook-panel">
      <div className="card-title" style={{ marginBottom: 8 }}>
        <b>世界书 · 关键词触发设定</b>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {entries.length} 条
        </span>
      </div>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 11, lineHeight: 1.7 }}>
        任一关键词出现在「作者指令 + 近期三章正文」中，该条目即作为 world_rule 设定注入本章装配上下文。
      </p>

      {error !== null && (
        <p className="wb-error" role="alert" style={{ marginBottom: 8 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {entries.length === 0 && (
          <p className="mono muted" style={{ fontSize: 11, margin: 0 }}>
            暂无条目——用下方表单添加第一条世界书设定。
          </p>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            data-testid="lorebook-entry"
            style={{
              border: '1px solid var(--border, #27272a)',
              borderRadius: 8,
              padding: 8,
              fontSize: 11,
              lineHeight: 1.6,
              opacity: entry.enabled ? 1 : 0.55,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>{entry.title}</b>
              <span style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 10 }}
                  disabled={busy}
                  onClick={() => void handleToggle(entry)}
                  data-testid="lorebook-toggle"
                >
                  {entry.enabled ? '停用' : '启用'}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 10 }}
                  disabled={busy}
                  onClick={() =>
                    setForm({
                      id: entry.id,
                      title: entry.title,
                      keywords: entry.keywords.join(', '),
                      content: entry.content,
                    })
                  }
                  data-testid="lorebook-edit"
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 10 }}
                  disabled={busy}
                  onClick={() => void handleDelete(entry.id)}
                  data-testid="lorebook-delete"
                >
                  删除
                </button>
              </span>
            </div>
            <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>
              触发词：{entry.keywords.join('、')}
            </div>
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{entry.content}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          aria-label="条目标题"
          placeholder="条目标题（如：玄灯教的铁律）"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={{ fontSize: 12, padding: '4px 8px' }}
        />
        <input
          aria-label="触发关键词"
          placeholder="触发关键词（逗号分隔，如：玄灯教, 灯律）"
          value={form.keywords}
          onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          style={{ fontSize: 12, padding: '4px 8px' }}
        />
        <textarea
          aria-label="注入内容"
          placeholder="命中后注入生成上下文的设定内容"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          rows={3}
          style={{ fontSize: 12, padding: '4px 8px', resize: 'vertical' }}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy || form.title.trim().length === 0 || form.content.trim().length === 0}
          onClick={() => void handleSave()}
          data-testid="lorebook-save"
        >
          {form.id !== '' ? '保存修改' : '添加条目'}
        </button>
        {form.id !== '' && (
          <button type="button" className="btn" onClick={() => setForm(EMPTY_FORM)}>
            取消编辑
          </button>
        )}
      </div>
    </div>
  )
}
