/**
 * 墨舟 Ink Orbit 工作台壳（实现票 T40 · ADR-0027 · 商业化双端全景）。
 */
import { useEffect, useState } from 'react'
import { CapabilityChannels } from './shell/CapabilityChannels'
import { ChangeMatrixPanel } from './change-matrix/ChangeMatrixPanel'
import { SceneLayer } from './shell/scene/SceneLayer'
import { SceneSettingsSheet } from './shell/scene/SceneSettingsSheet'
import {
  loadScenePreference,
  resolveSceneProfile,
  saveScenePreference,
} from './shell/scene/scenePreference'
import type { ScenePreference } from './shell/scene/scenePreference'
import { InspectorEmpty, InspectorTower } from './shell/InspectorTower'
import type { InspectorTabId, InspectorSummary } from './shell/InspectorTower'
import { PipelineStrip, PIPELINE_STAGES } from './shell/PipelineStrip'
import { useShellTelemetry } from './shell/useShellTelemetry'
import { deriveStageStates, deriveSummary } from './shell/shellTelemetry'
import { parentDirOf } from './shell/paths'
import { PlaceholderView } from './shell/PlaceholderView'
import { TopBar } from './shell/TopBar'
import { loadWorkbenchState, saveWorkbenchState } from './shell/workbenchStorage'
import type { BookInfo } from './shell/workbenchStorage'
import type { ViewId } from './shell/views'
import { QualityPanel } from './quality/QualityPanel'
import { ReceiptPanel } from './context-receipt/ReceiptPanel'
import { BookshelfView } from './shelf/BookshelfView'
import { BookSourceView } from './book-source/BookSourceView'
import { CapabilitySquareView } from './capability-square/CapabilitySquareView'
import { StyleDistillView } from './style-distill/StyleDistillView'
import { NovelBreakdownView } from './novel-breakdown/NovelBreakdownView'
import { RankScanView } from './rank-scan/RankScanView'
import { WebSearchView } from './web-search/WebSearchView'
import { CloudSyncView } from './cloud-sync/CloudSyncView'
import { MembershipView } from './membership/MembershipView'
import { AccountView } from './account/AccountView'
import { WorksView } from './works/WorksView'
import { TasksView } from './tasks/TasksView'
import { CanonGraphView } from './canon-graph/CanonGraphView'
import { GenreKitMarketplaceView } from './genre-kits/GenreKitMarketplaceView'
import { StoryBrainPanel } from './story-brain/StoryBrainPanel'
import { WizardOverlay } from './wizard/WizardOverlay'
import type { WizardOutcome } from './wizard/WizardOverlay'
import { WorkbenchView } from './workbench/WorkbenchView'
import { StoryboardView } from './storyboard/StoryboardView'
import { confirmStoryboardLeave } from './storyboard/dirtyGuard'
import { MobileShell } from './mobile/MobileShell'
import { DesktopToolModals, type DesktopModalType } from './shell/DesktopToolModals'

function stageToFocus(stageIndex: number): number {
  return stageIndex / (PIPELINE_STAGES.length - 1)
}

const INSPECTOR_VIEW_TO_TAB: Partial<Record<ViewId, InspectorTabId>> = {
  'quality-gate': 'quality',
  'story-brain': 'story-brain',
  'context-receipt': 'context-receipt',
  'change-matrix': 'change-matrix',
}

const DEFAULT_STAGE = PIPELINE_STAGES.findIndex((stage) => stage.id === 'review')
const WIZARD_DONE_KEY = 'mozhou.wizard.done'

function wizardCompleted(): boolean {
  try {
    return window.localStorage.getItem(WIZARD_DONE_KEY) === 'done'
  } catch {
    return false
  }
}

export function App(): JSX.Element {
  const [initial] = useState(loadWorkbenchState)
  const [book, setBook] = useState<BookInfo | null>(initial.book)
  const [view, setView] = useState<ViewId>(initial.view)
  const [chapterIndex, setChapterIndex] = useState(1)
  const [stage, setStage] = useState(DEFAULT_STAGE)
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>('quality')
  const [wizardOpen, setWizardOpen] = useState(
    () => initial.book === null && !wizardCompleted(),
  )
  const [desktopModal, setDesktopModal] = useState<DesktopModalType>(null)
  const [scenePreference, setScenePreference] = useState<ScenePreference>(loadScenePreference)
  const [sceneSheetOpen, setSceneSheetOpen] = useState(false)
  /** 作品页「带章节进入分镜」的待打开章号（T04）。 */
  const [storyboardChapter, setStoryboardChapter] = useState<number | null>(null)

  useEffect(() => {
    saveScenePreference(scenePreference)
  }, [scenePreference])

  /** 管线六态 + 检视摘要轨的真实数据证据（works/receipts/quality/matrix）。 */
  const telemetry = useShellTelemetry(book?.root ?? null, chapterIndex)
  const stageStates = deriveStageStates({
    bookExists: book !== null,
    chapterIndex,
    works: telemetry.works,
    receipts: telemetry.receipts,
    quality: telemetry.quality,
  })
  const inspectorSummary: InspectorSummary = deriveSummary({
    bookExists: book !== null,
    chapterIndex,
    works: telemetry.works,
    receipts: telemetry.receipts,
    quality: telemetry.quality,
    matrixRows: telemetry.matrixRows,
  })

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > 0 && window.innerWidth < 768
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const checkViewport = () => {
      setIsMobile(window.innerWidth > 0 && window.innerWidth < 768)
    }
    window.addEventListener('resize', checkViewport)
    return () => window.removeEventListener('resize', checkViewport)
  }, [])

  useEffect(() => {
    saveWorkbenchState({ book, view })
  }, [book, view])

  // U03：进入写作对话视图时滚动到真实对话面板（WorkbenchView 内锚点）
  useEffect(() => {
    if (view !== 'dialogue') return
    document.getElementById('dialogue-panel')?.scrollIntoView({ block: 'start' })
  }, [view, book])

  const handleSelectView = (next: ViewId): void => {
    // U06：分镜有未保存修改时，切页先经确认（取消=留在原地，焦点/滚动自然保留）
    if (next !== 'storyboard' && !confirmStoryboardLeave('切换到其他页面')) return
    if (next !== 'storyboard') setStoryboardChapter(null) // 离开分镜不带旧章号
    setView(next)
    const tab = INSPECTOR_VIEW_TO_TAB[next]
    if (tab !== undefined) setInspectorTab(tab)
  }

  const selectBook = (nextBook: BookInfo): void => {
    // U06：切书同样经过离开确认（干净文档直接通过）
    if (!confirmStoryboardLeave('切换作品')) return
    setBook(nextBook)
    setChapterIndex(1)
    setView('workbench')
  }

  const handleBookCreated = (created: BookInfo): void => selectBook(created)
  const handleBookSwitch = (switched: BookInfo): void => selectBook(switched)
  const parentDir = book === null ? null : parentDirOf(book.root)

  const handleWizardComplete = (outcome: WizardOutcome): void => {
    try {
      window.localStorage.setItem(WIZARD_DONE_KEY, 'done')
    } catch {
      // localStorage 不可用：完成标记是增强，不阻塞工作台。
    }
    selectBook({ root: outcome.root, bookId: outcome.bookId, title: outcome.title })
    setWizardOpen(false)
  }

  const handleWizardDismiss = (): void => {
    setWizardOpen(false)
    setView('workbench')
  }

  if (isMobile) {
    return (
      <MobileShell
        book={book}
        onSwitchBook={handleBookSwitch}
        chapterIndex={chapterIndex}
        onSelectChapter={setChapterIndex}
      />
    )
  }

  const panels = {
    quality:
      book === null ? (
        <InspectorEmpty note="建书后可用——先在工作台建书，再回到本面板运行文学质量审查。" />
      ) : (
        <QualityPanel root={book.root} chapterIndex={chapterIndex} />
      ),
    'story-brain':
      book === null ? (
        <InspectorEmpty note="建书后可用——先在工作台建书，Story Brain 三区只读面板随后挂载。" />
      ) : (
        <StoryBrainPanel root={book.root} />
      ),
    'context-receipt':
      book === null ? (
        <InspectorEmpty note="建书后可用——先在工作台建书，装配看板随后挂载 Context Receipt 列表。" />
      ) : (
        <ReceiptPanel root={book.root} onResume={() => setView('workbench')} />
      ),
    'change-matrix':
      book === null ? (
        <InspectorEmpty note="建书后可用——先在工作台建书，变更矩阵随后挂载 Traversal × 受影响章影响矩阵。" />
      ) : (
        <ChangeMatrixPanel root={book.root} />
      ),
  }

  return (
    <>
      <SceneLayer
        profile={resolveSceneProfile(scenePreference, book?.bookId ?? null)}
        focus={stageToFocus(stage)}
      />
      <div className={'app app-grain' + (view === 'storyboard' ? ' app-storyboard' : '')}>
        <TopBar
          book={book}
          onHome={() => handleSelectView('workbench')}
          onReplayWizard={() => setWizardOpen(true)}
          onOpenModal={setDesktopModal}
          onOpenScene={() => setSceneSheetOpen(true)}
        />
        <CapabilityChannels activeView={view} onSelect={handleSelectView} taskCount={0} />
        {/* U01：分镜页不挂小说生产管线与质量塔（独立创作任务面） */}
        {view !== 'storyboard' && (
          <PipelineStrip activeStage={stage} onSelect={setStage} stageStates={stageStates} />
        )}
        {/* U03：写作对话并入真实写作入口——dialogue 与 workbench 同元素同 key（状态不丢），仅滚动到对话面板 */}
        {(view === 'workbench' || view === 'dialogue') ? (
          <WorkbenchView
            key={book?.root ?? 'no-book'}
            book={book}
            chapterIndex={chapterIndex}
            onChapterIndexChange={setChapterIndex}
            onBookCreated={handleBookCreated}
            chapters={telemetry.works?.chapters}
          />
        ) : view === 'book-shelf' ? (
          <BookshelfView
            parentDir={parentDir}
            currentRoot={book?.root ?? null}
            onSwitchBook={handleBookSwitch}
          />
        ) : view === 'book-source' ? (
          <BookSourceView
            parentDir={parentDir}
            onSwitchBook={handleBookSwitch}
            onGoToWorkbench={() => setView('workbench')}
          />
        ) : view === 'capability-square' ? (
          <CapabilitySquareView />
        ) : view === 'works' ? (
          <WorksView
            root={book?.root ?? null}
            onGoToWorkbench={() => setView('workbench')}
            onOpenStoryboard={(ch) => { setStoryboardChapter(ch); handleSelectView('storyboard') }}
          />
        ) : view === 'storyboard' ? (
          <StoryboardView
            key={book?.root ?? 'no-book'}
            book={book}
            initialChapterIndex={storyboardChapter ?? undefined}
            onGoToShelf={() => { setStoryboardChapter(null); handleSelectView('book-shelf') }}
            onCreateBook={() => setWizardOpen(true)}
          />
        ) : view === 'tasks' ? (
          <TasksView root={book?.root ?? null} onGoToWorkbench={() => setView('workbench')} />
        ) : view === 'genre-kits' ? (
          <GenreKitMarketplaceView />
        ) : view === 'canon-graph' ? (
          <CanonGraphView />
        ) : view === 'style-distill' ? (
          <StyleDistillView root={book?.root ?? null} />
        ) : view === 'novel-breakdown' ? (
          <NovelBreakdownView root={book?.root ?? null} />
        ) : view === 'rank-scan' ? (
          <RankScanView />
        ) : view === 'web-search' ? (
          <WebSearchView />
        ) : view === 'cloud-sync' ? (
          <CloudSyncView root={book?.root ?? null} />
        ) : view === 'membership' ? (
          <MembershipView />
        ) : view === ('account' as ViewId) ? (
          <AccountView />
        ) : (
          <PlaceholderView view={view} />
        )}
        {/* U01：质量塔/检视塔在分镜页不挂载 */}
        {view !== 'storyboard' && (
          <InspectorTower activeTab={inspectorTab} onTabChange={setInspectorTab} panels={panels} summary={inspectorSummary} />
        )}
      </div>
      {wizardOpen && (
        <WizardOverlay
          precreated={book}
          onComplete={handleWizardComplete}
          onReplay={handleWizardDismiss}
        />
      )}
      <DesktopToolModals activeModal={desktopModal} onClose={() => setDesktopModal(null)} />
      {sceneSheetOpen && (
        <SceneSettingsSheet
          preference={scenePreference}
          book={book}
          onChange={setScenePreference}
          onClose={() => setSceneSheetOpen(false)}
        />
      )}
    </>
  )
}
