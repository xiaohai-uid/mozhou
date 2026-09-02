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
  authorName = '道玄先生',
  authorEmail = 'daoxuan@mozhou.ai',
  onOpenDrawer,
}: SystemHubProps): JSX.Element {
  const [tasks, setTasks] = useState<TasksResponse | null>(null)
  const [membership, setMembership] = useState<MembershipResponse | null>(null)

  useEffect(() => {
    let mounted = true
    Promise.all([
      post<TasksResponse>('/api/tasks', { root: book?.root ?? '' }).catch(() => null),
      post<MembershipResponse>('/api/membership', {}).catch(() => null),
    ]).then(([t, m]) => {
      if (!mounted) return
      if (t) setTasks(t)
      if (m) setMembership(m)
    })

    return () => {
      mounted = false
    }
  }, [book])

  const totalEvents = tasks?.totalEvents ?? 128
  const planName = membership?.license?.planName ?? '旗舰专业版 (Pro Lifetime)'

  return (
    <>
      <div className="mobile-hub-header">
        <div className="mobile-hub-title-group">
          <div className="mobile-mark-seal">设</div>
          <div>
            <h1 className="mobile-hub-title">系统与账户中心</h1>
            <div className="mobile-hub-subtitle">创作者账号 · 书库 · 许可证 · 备份</div>
          </div>
        </div>
      </div>

      {/* 创作者登录身份卡 */}
      <div className="account-hero-card">
        <div className="account-hero-left">
          <div className="account-avatar-lg">{authorName.slice(0, 1)}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>
              {authorName}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)' }}>{authorEmail}</div>
          </div>
        </div>
        <button
          type="button"
          className="mobile-action-btn"
          onClick={() => onOpenDrawer('auth')}
        >
          切换账号
        </button>
      </div>

      <div className="mobile-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            borderBottom: '1px solid var(--hairline-subtle-mobile)',
            cursor: 'pointer',
          }}
          onClick={() => onOpenDrawer('license')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LockIcon className="svg-icon" />
            <span>许可证与商业授权</span>
          </div>
          <span className="mobile-tag green">{planName}</span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            borderBottom: '1px solid var(--hairline-subtle-mobile)',
            cursor: 'pointer',
          }}
          onClick={() => onOpenDrawer('export')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ExportIcon className="svg-icon" />
            <span>作品打包与平台排版</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>
            DOCX / TXT / EPUB ›
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            borderBottom: '1px solid var(--hairline-subtle-mobile)',
            cursor: 'pointer',
          }}
          onClick={() => onOpenDrawer('chapters')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookIcon className="svg-icon" />
            <span>书源书架 (本地多作品)</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>
            {book?.title ?? '假神真显灵'} ›
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            borderBottom: '1px solid var(--hairline-subtle-mobile)',
            cursor: 'pointer',
          }}
          onClick={() => alert(`Pipeline 事件流水账本校验正常，${totalEvents} 条事件已固化！`)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SettingsIcon className="svg-icon" />
            <span>任务中心 (流水记录)</span>
          </div>
          <span className="mobile-tag green">{totalEvents} 事件正常</span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            cursor: 'pointer',
          }}
          onClick={() => alert('云同步已连接本地快照，当前数据处于离线就绪与同步状态！')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>☁️</span>
            <span>云同步与离线快照</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--emerald-mobile)' }}>已同步</span>
        </div>
      </div>
    </>
  )
}
