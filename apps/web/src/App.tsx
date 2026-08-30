/**
 * 墨舟 Ink Orbit 工作台壳（实现票 T40 · ADR-0027）：
 * 顶栏 + 八步管线条 + 左侧五组功能航道 + 中栏（工作台填充/显式占位）
 * + 右侧检视塔 + WebGL 背景墨流。书名与视图状态经 localStorage 记忆。
 */
import { useEffect, useState } from 'react'
import { CapabilityChannels } from './shell/CapabilityChannels'
import { InkBackground } from './shell/InkBackground'
import { InspectorEmpty, InspectorPlaceholder, InspectorTower } from './shell/InspectorTower'
import type { InspectorTabId } from './shell/InspectorTower'
import { PipelineStrip, PIPELINE_STAGES } from './shell/PipelineStrip'
import { PlaceholderView } from './shell/PlaceholderView'
import { TopBar } from './shell/TopBar'
import { loadWorkbenchState, saveWorkbenchState } from './shell/workbenchStorage'
import type { BookInfo } from './shell/workbenchStorage'
import type { ViewId } from './shell/views'
import { QualityPanel } from './quality/QualityPanel'
import { StoryBrainPanel } from './story-brain/StoryBrainPanel'
import { WorkbenchView } from './workbench/WorkbenchView'

/** 管线点击牵引的墨迹聚焦：activeStage 均匀映射到 [0,1]（原型同款）。 */
function stageToFocus(stageIndex: number): number {
  return stageIndex / (PIPELINE_STAGES.length - 1)
}

/** 检视组导航 → 检视塔 tab 的牵引映射。 */
const INSPECTOR_VIEW_TO_TAB: Partial<Record<ViewId, InspectorTabId>> = {
  'quality-gate': 'quality',
  'story-brain': 'story-brain',
  'context-receipt': 'context-receipt',
  'change-matrix': 'change-matrix',
}

/** 壳级默认阶段：审查（与原型关键屏一致的初始高亮；真实会话绑定随后续票接入）。 */
const DEFAULT_STAGE = PIPELINE_STAGES.findIndex((stage) => stage.id === 'review')

export function App(): JSX.Element {
  const [initial] = useState(loadWorkbenchState)
  const [book, setBook] = useState<BookInfo | null>(initial.book)
  const [view, setView] = useState<ViewId>(initial.view)
  const [stage, setStage] = useState(DEFAULT_STAGE)
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>('quality')

  useEffect(() => {
    saveWorkbenchState({ book, view })
  }, [book, view])

  const handleSelectView = (next: ViewId): void => {
    setView(next)
    const tab = INSPECTOR_VIEW_TO_TAB[next]
    if (tab !== undefined) setInspectorTab(tab)
  }

  const handleBookCreated = (created: BookInfo): void => {
    setBook(created)
    setView('workbench')
  }

  const panels = {
    quality:
      book === null ? (
        <InspectorEmpty note="建书后可用——先在工作台建书，再回到本面板运行文学质量审查。" />
      ) : (
        <QualityPanel root={book.root} chapterIndex={1} />
      ),
    'story-brain':
      book === null ? (
        <InspectorEmpty note="建书后可用——先在工作台建书，Story Brain 三区只读面板随后挂载。" />
      ) : (
        <StoryBrainPanel root={book.root} />
      ),
    'context-receipt': (
      <InspectorPlaceholder
        title="装配看板"
        ticket="T42"
        note="Context Receipt 列表与逐条装配分解（额度条 / Replay Inputs / 续跑）随实现票 T42 落地。"
      />
    ),
    'change-matrix': (
      <InspectorPlaceholder
        title="变更矩阵"
        ticket="T43"
        note="行=遍历 / 列=受影响章的影响矩阵与幂等重跑随实现票 T43 落地。"
      />
    ),
  }

  return (
    <>
      <InkBackground focus={stageToFocus(stage)} />
      <div className="app app-grain">
        <TopBar book={book} onHome={() => setView('workbench')} />
        <CapabilityChannels activeView={view} onSelect={handleSelectView} taskCount={0} />
        <PipelineStrip activeStage={stage} onSelect={setStage} />
        {view === 'workbench' ? (
          <WorkbenchView
            key={book?.root ?? 'no-book'}
            book={book}
            onBookCreated={handleBookCreated}
          />
        ) : (
          <PlaceholderView view={view} />
        )}
        <InspectorTower activeTab={inspectorTab} onTabChange={setInspectorTab} panels={panels} />
      </div>
    </>
  )
}
