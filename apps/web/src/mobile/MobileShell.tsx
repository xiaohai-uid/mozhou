import { useState } from 'react'
import { FluidInkBackground } from './components/FluidInkBackground'
import { MobileStatusBar } from './components/MobileStatusBar'
import { MobileTabBar, type MobileHubId } from './components/MobileTabBar'
import { MobileDrawerSheet } from './components/MobileDrawerSheet'
import type { BookInfo } from '../shell/workbenchStorage'
import type { ActiveDrawerType } from './types'
import { WorkbenchHub } from './hubs/WorkbenchHub'
import { InspectorHub } from './hubs/InspectorHub'
import { WorksHub } from './hubs/WorksHub'
import { ResourcesHub } from './hubs/ResourcesHub'
import { SystemHub } from './hubs/SystemHub'
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

function PreviewUnavailable({ label }: { label: string }): JSX.Element {
  return (
    <div className="mobile-card" style={{ margin: 0, background: 'var(--surface-core-mobile)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-pure-mobile)' }}>{label}尚未接入</div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted-mobile)', marginTop: 6, lineHeight: 1.6 }}>
        Technical Preview 不展示虚构数据或模拟成功状态；接入真实数据面后再开放。
      </div>
    </div>
  )
}

export function MobileShell({ book, onSwitchBook }: MobileShellProps): JSX.Element {
  const [activeHub, setActiveHub] = useState<MobileHubId>('workbench')
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawerType>(null)

  const handleOpenDrawer = (type: ActiveDrawerType) => setActiveDrawer(type)
  const handleCloseDrawer = () => setActiveDrawer(null)

  const getDrawerTitle = (): string => {
    switch (activeDrawer) {
      case 'auth': return '创作者账号状态'
      case 'license': return '版本与授权'
      case 'history': return '版本时光机与差异回滚'
      case 'inspiration': return '网文灵感与起名工坊'
      case 'export': return '作品导出与平台打包'
      case 'compliance': return '平台合规与敏感词审查'
      case 'chapters': return '章节目录'
      case 'distill': return '文风画像详情'
      default: return '详情'
    }
  }

  return (
    <div className="mobile-app-root">
      <FluidInkBackground />
      <MobileStatusBar authorName="本地创作者" statusText="Technical Preview" onOpenAuth={() => handleOpenDrawer('auth')} />

      <main className="mobile-viewport">
        <div className={`mobile-view-pane ${activeHub === 'workbench' ? 'active' : ''}`}>
          <WorkbenchHub book={book} onOpenDrawer={handleOpenDrawer} />
        </div>
        <div className={`mobile-view-pane ${activeHub === 'inspector' ? 'active' : ''}`}>
          <InspectorHub book={book} onOpenDrawer={handleOpenDrawer} />
        </div>
        <div className={`mobile-view-pane ${activeHub === 'works' ? 'active' : ''}`}>
          <WorksHub book={book} onOpenDrawer={handleOpenDrawer} />
        </div>
        <div className={`mobile-view-pane ${activeHub === 'resources' ? 'active' : ''}`}>
          <ResourcesHub book={book} onOpenDrawer={handleOpenDrawer} />
        </div>
        <div className={`mobile-view-pane ${activeHub === 'system' ? 'active' : ''}`}>
          <SystemHub book={book} authorName="本地创作者" authorEmail="未连接账号" onOpenDrawer={handleOpenDrawer} onSwitchBook={onSwitchBook} />
        </div>
      </main>

      <MobileTabBar activeHub={activeHub} onSelectHub={setActiveHub} />

      <MobileDrawerSheet open={activeDrawer !== null} title={getDrawerTitle()} onClose={handleCloseDrawer}>
        {activeDrawer === 'auth' && (
          <AuthLicenseDrawer onLoginSuccess={() => undefined} onOpenLicense={() => handleOpenDrawer('license')} />
        )}
        {activeDrawer === 'license' && <PreviewUnavailable label="许可证购买与激活" />}
        {activeDrawer === 'history' && <VersionHistoryDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'inspiration' && <InspirationDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'export' && <ExportPublishDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'compliance' && <ComplianceDrawer />}
        {activeDrawer === 'chapters' && <PreviewUnavailable label="移动端章节目录" />}
        {activeDrawer === 'distill' && <PreviewUnavailable label="移动端文风画像" />}
      </MobileDrawerSheet>
    </div>
  )
}
