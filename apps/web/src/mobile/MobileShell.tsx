import { useState } from 'react'
import { FluidInkBackground } from './components/FluidInkBackground'
import { MobileStatusBar } from './components/MobileStatusBar'
import { MobileTabBar, type MobileHubId } from './components/MobileTabBar'
import { MobileDrawerSheet } from './components/MobileDrawerSheet'
import type { BookInfo } from '../shell/workbenchStorage'
import type { ActiveDrawerType } from './types'

// 导入 Hub 组件（后续在各 Phase 实现）
import { WorkbenchHub } from './hubs/WorkbenchHub'
import { InspectorHub } from './hubs/InspectorHub'
import { WorksHub } from './hubs/WorksHub'
import { ResourcesHub } from './hubs/ResourcesHub'
import { SystemHub } from './hubs/SystemHub'

// 导入抽屉组件
import { AuthLicenseDrawer } from './drawers/AuthLicenseDrawer'
import { VersionHistoryDrawer } from './drawers/VersionHistoryDrawer'
import { InspirationDrawer } from './drawers/InspirationDrawer'
import { ExportPublishDrawer } from './drawers/ExportPublishDrawer'
import { ComplianceDrawer } from './drawers/ComplianceDrawer'

import './styles/mobile.css'

export type { ActiveDrawerType } from './types'

export interface MobileShellProps {
  book: BookInfo | null
  onSwitchBook: (book: BookInfo) => void
}

export function MobileShell({ book, onSwitchBook }: MobileShellProps): JSX.Element {
  const [activeHub, setActiveHub] = useState<MobileHubId>('workbench')
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawerType>(null)
  const [authorName, setAuthorName] = useState('道玄先生')
  const [authorEmail, setAuthorEmail] = useState('daoxuan@mozhou.ai')

  const handleOpenDrawer = (type: ActiveDrawerType) => {
    setActiveDrawer(type)
  }

  const handleCloseDrawer = () => {
    setActiveDrawer(null)
  }

  const handleLoginSuccess = (name: string, email: string) => {
    setAuthorName(name)
    setAuthorEmail(email)
    setActiveDrawer(null)
  }

  const getDrawerTitle = (): string => {
    switch (activeDrawer) {
      case 'auth':
        return '创作者账号登录与切换'
      case 'license':
        return '商业许可证与权益激活'
      case 'history':
        return '版本时光机与差异回滚'
      case 'inspiration':
        return '网文灵感与起名工坊'
      case 'export':
        return '作品导出与平台打包'
      case 'compliance':
        return '平台合规与敏感词审查'
      case 'chapters':
        return '第一卷 章节目录'
      case 'distill':
        return '文风画像详情'
      default:
        return '详情'
    }
  }

  return (
    <div className="mobile-app-root">
      <FluidInkBackground />

      {/* 顶部状态栏 */}
      <MobileStatusBar
        authorName={authorName}
        statusText="Pro 终身版"
        onOpenAuth={() => handleOpenDrawer('auth')}
      />

      {/* 5 大核心 Hub 主视口 */}
      <main className="mobile-viewport">
        <div className={`mobile-view-pane ${activeHub === 'workbench' ? 'active' : ''}`}>
          <WorkbenchHub
            book={book}
            onOpenDrawer={handleOpenDrawer}
          />
        </div>

        <div className={`mobile-view-pane ${activeHub === 'inspector' ? 'active' : ''}`}>
          <InspectorHub
            book={book}
            onOpenDrawer={handleOpenDrawer}
          />
        </div>

        <div className={`mobile-view-pane ${activeHub === 'works' ? 'active' : ''}`}>
          <WorksHub
            book={book}
            onOpenDrawer={handleOpenDrawer}
          />
        </div>

        <div className={`mobile-view-pane ${activeHub === 'resources' ? 'active' : ''}`}>
          <ResourcesHub
            book={book}
            onOpenDrawer={handleOpenDrawer}
          />
        </div>

        <div className={`mobile-view-pane ${activeHub === 'system' ? 'active' : ''}`}>
          <SystemHub
            book={book}
            authorName={authorName}
            authorEmail={authorEmail}
            onOpenDrawer={handleOpenDrawer}
            onSwitchBook={onSwitchBook}
          />
        </div>
      </main>

      {/* 底部五大核心导航栏 */}
      <MobileTabBar activeHub={activeHub} onSelectHub={setActiveHub} />

      {/* 全局多态抽屉 */}
      <MobileDrawerSheet
        open={activeDrawer !== null}
        title={getDrawerTitle()}
        onClose={handleCloseDrawer}
      >
        {activeDrawer === 'auth' && (
          <AuthLicenseDrawer
            initialEmail={authorEmail}
            onLoginSuccess={handleLoginSuccess}
            onOpenLicense={() => handleOpenDrawer('license')}
          />
        )}
        {activeDrawer === 'license' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold-mobile)' }}>
                当前方案：墨舟旗舰专业版 (Pro Lifetime)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 4 }}>
                状态：永久生效 · 17 航道全部解锁
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-muted-mobile)' }}>输入许可证密钥 (License Key)</label>
              <input
                style={{
                  width: '100%',
                  background: 'var(--surface-core-mobile)',
                  border: '1px solid var(--hairline-crisp-mobile)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  color: 'var(--fg-pure-mobile)',
                  fontSize: 14,
                  outline: 'none',
                }}
                type="text"
                placeholder="例如：MOZHOU-PRO-LIFETIME-XXXX-YYYY"
              />
            </div>
            <button
              className="mobile-action-btn"
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: 10,
                background: 'var(--accent-mobile)',
                color: '#fff',
                border: 'none',
              }}
              onClick={() => {
                alert('许可证激活成功！')
                handleCloseDrawer()
              }}
            >
              立即激活授权
            </button>
          </div>
        )}
        {activeDrawer === 'history' && <VersionHistoryDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'inspiration' && <InspirationDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'export' && <ExportPublishDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'compliance' && <ComplianceDrawer />}
        {activeDrawer === 'chapters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                padding: 12,
                background: 'var(--surface-core-mobile)',
                borderRadius: 12,
                cursor: 'pointer',
              }}
              onClick={handleCloseDrawer}
            >
              <div style={{ color: 'var(--accent-strong-mobile)', fontWeight: 600 }}>
                第 001 章 破庙装神与显灵契机 (当前)
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
                3,420 字 · 定稿
              </div>
            </div>
            <div
              style={{
                padding: 12,
                background: 'var(--surface-core-mobile)',
                borderRadius: 12,
                cursor: 'pointer',
              }}
              onClick={handleCloseDrawer}
            >
              <div style={{ color: 'var(--fg-primary-mobile)' }}>
                第 002 章 县衙大堂上的测灵镜
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted-mobile)', marginTop: 2 }}>
                规划 3,200 字 · 细纲就绪
              </div>
            </div>
          </div>
        )}
        {activeDrawer === 'distill' && (
          <div className="mobile-card" style={{ margin: 0 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--hairline-subtle-mobile)',
              }}
            >
              <span>对白黄金占比</span>
              <span style={{ color: 'var(--accent-strong-mobile)' }}>42.8%</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
              }}
            >
              <span>短句比例</span>
              <span style={{ color: 'var(--emerald-mobile)' }}>68.5% (快节奏)</span>
            </div>
          </div>
        )}
      </MobileDrawerSheet>
    </div>
  )
}
