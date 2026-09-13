import { useEffect, useState } from 'react'
import { BookIcon, LockIcon, ExportIcon, SettingsIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { TasksResponse, MembershipResponse, LibraryResponse } from '../../../server/api'

export interface SystemHubProps {
  book: BookInfo | null
  authorName?: string
  authorEmail?: string
  onOpenDrawer: (type: ActiveDrawerType) => void
  onSwitchBook?: (book: BookInfo) => void
}

import { parentDirOf } from '../../shell/paths'

export function SystemHub({
  book,
  authorName = '本地创作者',
  authorEmail = '未连接账号',
  onOpenDrawer,
  onSwitchBook,
}: SystemHubProps): JSX.Element {
  const [tasks, setTasks] = useState<TasksResponse | null>(null)
  const [membership, setMembership] = useState<MembershipResponse | null>(null)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [switchingRoot, setSwitchingRoot] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void Promise.all([
      book ? post<TasksResponse>('/api/tasks', { root: book.root }).catch(() => null) : Promise.resolve(null),
      post<MembershipResponse>('/api/membership', {}).catch(() => null),
    ]).then(([t, m]) => {
      if (!mounted) return
      setTasks(t)
      setMembership(m)
    })
    return () => { mounted = false }
  }, [book])

  // 本地书库（P1-4 链 2）：复用桌面 library 契约，实化切书。
  useEffect(() => {
    if (!shelfOpen) return
    let mounted = true
    void post<LibraryResponse>('/api/library', { parentDir: book === null ? null : parentDirOf(book.root) })
      .then((data) => {
        if (mounted) setLibrary(data)
      })
      .catch(() => {
        if (mounted) setLibrary({ ok: true, books: [], skipped: [] })
      })
    return () => { mounted = false }
  }, [shelfOpen, book])

  const handleSwitchBook = async (target: { root: string; bookId: string; title: string }): Promise<void> => {
    if (book !== null && target.root === book.root) return
    setSwitchingRoot(target.root)
    setSwitchError(null)
    try {
      await post<{ ok: boolean; root: string; bookId: string; title: string }>('/api/library.open', { root: target.root })
      onSwitchBook?.({ root: target.root, bookId: target.bookId, title: target.title })
    } catch (cause) {
      setSwitchError((cause as Error).message)
    } finally {
      setSwitchingRoot(null)
    }
  }

  const planName = membership?.license?.planName ?? '未激活许可证 · Technical Preview'

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">设</div>
          <div>
            <h1 className="mobile-hub-title">系统与账户中心</h1>
            <div className="mobile-hub-subtitle">本地作品 · 版本状态 · Technical Preview</div>
          </div>
        </div>
      </div>

      <div className="account-hero-card">
        <div className="account-hero-left">
          <div className="account-avatar-lg">{authorName.slice(0, 1)}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>{authorName}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>{authorEmail}</div>
          </div>
        </div>
        <button type="button" className="mobile-action-btn" onClick={() => onOpenDrawer('auth')}>账号状态</button>
      </div>

      <div className="mobile-card" style={{ padding: 0, overflow: 'hidden' }}>
        <Row onClick={() => onOpenDrawer('license')} icon={<LockIcon className="svg-icon" />} label="许可证与商业授权" value={planName} />
        <Row onClick={() => onOpenDrawer('export')} icon={<ExportIcon className="svg-icon" />} label="作品打包与平台排版" value="尚未接入" />
        <div style={{ borderBottom: '1px solid var(--hairline-subtle-mobile)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              cursor: 'pointer',
              minHeight: 'var(--touch-target-min)',
            }}
            role="button"
            aria-expanded={shelfOpen}
            data-testid="mobile-shelf-toggle"
            onClick={() => setShelfOpen((open) => !open)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BookIcon className="svg-icon" />
              <span>书源书架 (本地多作品)</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>
              {book?.title ?? '尚未建书'} {shelfOpen ? '▲' : '▼'}
            </span>
          </div>
          {shelfOpen && (
            <div style={{ padding: '0 12px 12px' }} data-testid="mobile-shelf-list">
              {library === null && (
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', padding: '6px 4px' }}>读取本地书库…</div>
              )}
              {library !== null && library.books.length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', padding: '6px 4px', lineHeight: 1.6 }}>
                  本地书库暂无其他作品（不伪造书架条目）。
                </div>
              )}
              {library?.books.map((entry) => {
                const isCurrent = book !== null && entry.root === book.root
                return (
                  <div
                    key={entry.root}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '9px 10px',
                      borderRadius: 10,
                      marginBottom: 6,
                      background: isCurrent ? 'rgba(114, 201, 196, 0.08)' : 'var(--surface-core-mobile)',
                      border: isCurrent ? '1px solid rgba(114, 201, 196, 0.5)' : '1px solid var(--hairline-subtle-mobile)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-pure-mobile)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.title}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--fg-muted-mobile)' }}>{entry.chapterCount} 章</div>
                    </div>
                    <button
                      type="button"
                      className="mobile-action-btn"
                      style={{ padding: '0 12px', fontSize: 11 }}
                      disabled={isCurrent || switchingRoot !== null}
                      onClick={() => { void handleSwitchBook(entry) }}
                    >
                      {isCurrent ? '当前' : switchingRoot === entry.root ? '打开中…' : '打开'}
                    </button>
                  </div>
                )
              })}
              {switchError !== null && (
                <div className="mobile-inline-note err" style={{ margin: 0 }} role="alert">
                  切书失败：{switchError}
                </div>
              )}
            </div>
          )}
        </div>
        <Row icon={<SettingsIcon className="svg-icon" />} label="任务中心 (流水记录)" value={tasks ? `${tasks.totalEvents} 条真实事件` : '未载入'} />
        <Row icon={<span style={{ fontSize: 16 }}>☁️</span>} label="云同步与离线快照" value="云同步未接入" last />
      </div>
    </>
  )
}

function Row({
  icon,
  label,
  value,
  onClick,
  last = false,
}: {
  icon: JSX.Element
  label: string
  value: string
  onClick?: () => void
  last?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 16px',
        borderBottom: last ? undefined : '1px solid var(--hairline-subtle-mobile)',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{icon}<span>{label}</span></div>
      <span style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>{value}</span>
    </div>
  )
}
