import { useEffect, useState } from 'react'
import { BookIcon, LockIcon, ExportIcon, SettingsIcon } from '../components/MobileIcons'
import { post } from '../../lib/post'
import type { BookInfo } from '../../shell/workbenchStorage'
import type { ActiveDrawerType } from '../types'
import type { TasksResponse, MembershipResponse } from '../../../server/api'

export interface SystemHubProps {
  book: BookInfo | null
  authorName?: string
  authorEmail?: string
  onOpenDrawer: (type: ActiveDrawerType) => void
  onSwitchBook?: (book: BookInfo) => void
}

export function SystemHub({
  book,
  authorName = '本地创作者',
  authorEmail = '未连接账号',
  onOpenDrawer,
}: SystemHubProps): JSX.Element {
  const [tasks, setTasks] = useState<TasksResponse | null>(null)
  const [membership, setMembership] = useState<MembershipResponse | null>(null)

  useEffect(() => {
    let mounted = true
    Promise.all([
      book ? post<TasksResponse>('/api/tasks', { root: book.root }).catch(() => null) : Promise.resolve(null),
      post<MembershipResponse>('/api/membership', {}).catch(() => null),
    ]).then(([t, m]) => {
      if (!mounted) return
      setTasks(t)
      setMembership(m)
    })
    return () => { mounted = false }
  }, [book])

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
        <Row onClick={() => onOpenDrawer('chapters')} icon={<BookIcon className="svg-icon" />} label="书源书架 (本地多作品)" value={book?.title ?? '尚未建书'} />
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
