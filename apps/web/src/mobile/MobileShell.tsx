import { useEffect, useMemo, useState } from 'react'
import { SceneLayer } from '../shell/scene/SceneLayer'
import { loadScenePreference, resolveSceneProfile } from '../shell/scene/scenePreference'
import { MobileStatusBar } from './components/MobileStatusBar'
import { MobileChaptersDrawer } from './drawers/MobileChaptersDrawer'
import { MobileTabBar, type MobileHubId } from './components/MobileTabBar'
import { MobileDrawerSheet } from './components/MobileDrawerSheet'
import type { BookInfo } from '../shell/workbenchStorage'
import type { ActiveDrawerType } from './types'
import { WorkbenchHub } from './hubs/WorkbenchHub'
import { StoryboardView } from '../storyboard/StoryboardView'
import { confirmStoryboardLeave, onStoryboardSaveState, type StoryboardSaveState } from '../storyboard/dirtyGuard'
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

/** 未接入能力的诚实占位卡（不伪造数据）。 */
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

export interface MobileShellProps {
  book: BookInfo | null
  onSwitchBook: (book: BookInfo) => void
  chapterIndex?: number | undefined
  onSelectChapter?: ((index: number) => void) | undefined
}

export function MobileShell({
  book,
  onSwitchBook,
  chapterIndex = 1,
  onSelectChapter,
}: MobileShellProps): JSX.Element {
  const [activeHub, setActiveHub] = useState<MobileHubId>('workbench')
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawerType>(null)
  /** 灵感采用 → Composer 回填管道（P1-3 链 4）。 */
  const [composerInject, setComposerInject] = useState<{ id: number; text: string } | null>(null)

  /** 移动端 Scene（规格 §25.2）：与桌面同一偏好源；Figure 默认关、veil 加重、无 parallax。
   *  同会话偏好编辑（桌面 Sheet / storage 事件）即时跟随（规格 §3.4）。 */
  const [sceneVersion, setSceneVersion] = useState(0)
  useEffect(() => {
    const onSceneRefresh = (): void => setSceneVersion((v) => v + 1)
    window.addEventListener('mozhou:scene-refresh', onSceneRefresh)
    window.addEventListener('storage', onSceneRefresh)
    return () => {
      window.removeEventListener('mozhou:scene-refresh', onSceneRefresh)
      window.removeEventListener('storage', onSceneRefresh)
    }
  }, [])
  const sceneProfile = useMemo(() => {
    void sceneVersion
    const profile = resolveSceneProfile(loadScenePreference(), book?.bookId ?? null)
    return {
      ...profile,
      veil: Math.max(profile.veil, 0.62),
      figure: { ...profile.figure, enabled: false },
    }
  }, [book?.bookId, sceneVersion])

  const handleOpenDrawer = (type: ActiveDrawerType) => setActiveDrawer(type)
  const handleCloseDrawer = () => {
    // U06：分镜全屏页有未保存修改时，返回/遮罩/Escape 统一先经确认
    if (activeDrawer === 'storyboard' && !confirmStoryboardLeave('关闭分镜')) return
    setActiveDrawer(null)
  }
  /* U05/U06：全屏分镜页顶栏的保存状态徽标（外壳侧镜像三态真源：
     idle=就绪（无工作文档，不谎报已保存）· dirty=●未保存 · saved=已保存） */
  const [saveState, setSaveState] = useState<StoryboardSaveState>('idle')
  useEffect(() => onStoryboardSaveState(setSaveState), [])

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
      case 'storyboard': return '漫剧分镜'
      default: return '详情'
    }
  }

  return (
    <div className="mobile-app-root">
      <SceneLayer profile={sceneProfile} />
      <MobileStatusBar authorName="本地创作者" statusText="Technical Preview" onOpenAuth={() => handleOpenDrawer('auth')} />

      <main className="mobile-viewport">
        <div className={`mobile-view-pane ${activeHub === 'workbench' ? 'active' : ''}`}>
          <WorkbenchHub
            book={book}
            onOpenDrawer={handleOpenDrawer}
            chapterIndex={chapterIndex}
            composerInject={composerInject ?? undefined}
          />
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

      {/* U05：分镜走全屏任务页（见下），不再以抽屉承载——其余抽屉照常 */}
      <MobileDrawerSheet open={activeDrawer !== null && activeDrawer !== 'storyboard'} title={getDrawerTitle()} onClose={handleCloseDrawer}>
        {activeDrawer === 'auth' && (
          <AuthLicenseDrawer onLoginSuccess={() => undefined} onOpenLicense={() => handleOpenDrawer('license')} />
        )}
        {activeDrawer === 'license' && <PreviewUnavailable label="许可证购买与激活" />}
        {activeDrawer === 'history' && <VersionHistoryDrawer onClose={handleCloseDrawer} />}
        {activeDrawer === 'inspiration' && (
          <InspirationDrawer
            onClose={handleCloseDrawer}
            onAdopt={(text) => setComposerInject({ id: Date.now(), text })}
          />
        )}
        {activeDrawer === 'export' && <ExportPublishDrawer book={book} onClose={handleCloseDrawer} />}
        {activeDrawer === 'compliance' && <ComplianceDrawer />}
        {activeDrawer === 'chapters' && (
          <MobileChaptersDrawer
            book={book}
            chapterIndex={chapterIndex ?? 1}
            onSelectChapter={(index) => onSelectChapter?.(index)}
            onClose={handleCloseDrawer}
          />
        )}
        {activeDrawer === 'distill' && <PreviewUnavailable label="移动端文风画像" />}
      </MobileDrawerSheet>

      {/* U05：手机分镜 = 全屏任务页（固定顶栏：返回/作品章节/保存状态），替代抽屉承载长编辑 */}
      {activeDrawer === 'storyboard' && (
        <section className="mobile-fullpage" role="dialog" aria-modal="true" aria-label="漫剧分镜">
          <header className="mfp-top">
            <button type="button" className="mfp-back" onClick={handleCloseDrawer} aria-label="返回（未保存会先确认）" data-testid="mfp-back">‹</button>
            <div className="mfp-mid">
              <b>{book?.title ?? '漫剧分镜'}</b>
              <span>第 {chapterIndex ?? 1} 章</span>
            </div>
            <span className={'mfp-badge' + (saveState === 'dirty' ? ' dirty' : '')} data-testid="mfp-badge">
              {saveState === 'dirty' ? '● 未保存' : saveState === 'saved' ? '已保存' : '就绪'}
            </span>
          </header>
          <div className="mfp-body">
            <StoryboardView book={book} initialChapterIndex={chapterIndex ?? 1} />
          </div>
        </section>
      )}
    </div>
  )
}
