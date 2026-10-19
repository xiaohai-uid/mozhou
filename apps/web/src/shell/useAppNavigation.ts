/**
 * 应用导航与检视塔映射切片 Hook（useAppNavigation）。
 * 封装 view, stage, tab 映射与离开确认检查。
 */
import { useState, useCallback, useMemo } from 'react'
import type { ViewId } from './views'
import { PIPELINE_STAGES } from './PipelineStrip'
import type { InspectorTabId } from './InspectorTower'
import { confirmStoryboardLeave } from '../storyboard/dirtyGuard'

export const INSPECTOR_VIEW_TO_TAB: Partial<Record<ViewId, InspectorTabId>> = {
  'quality-gate': 'quality',
  'story-brain': 'story-brain',
  'context-receipt': 'context-receipt',
  'change-matrix': 'change-matrix',
}

export const DEFAULT_STAGE = PIPELINE_STAGES.findIndex((stage) => stage.id === 'review')

export function stageToFocus(stageIndex: number): number {
  return stageIndex / (PIPELINE_STAGES.length - 1)
}

export interface UseAppNavigationOptions {
  readonly initialView?: ViewId
  readonly initialStage?: number
  readonly initialTab?: InspectorTabId
}

export interface UseAppNavigationReturn {
  readonly view: ViewId
  readonly setView: React.Dispatch<React.SetStateAction<ViewId>>
  readonly stage: number
  readonly setStage: React.Dispatch<React.SetStateAction<number>>
  readonly stageFocus: number
  readonly inspectorTab: InspectorTabId
  readonly setInspectorTab: React.Dispatch<React.SetStateAction<InspectorTabId>>
  readonly receiptFocus: string | null
  readonly setReceiptFocus: React.Dispatch<React.SetStateAction<string | null>>
  readonly storyboardChapter: number | null
  readonly setStoryboardChapter: React.Dispatch<React.SetStateAction<number | null>>
  readonly handleSelectView: (next: ViewId) => boolean
  readonly explainContext: (receiptId: string) => void
  readonly openStoryboard: (chapter?: number | null) => boolean
}

export function useAppNavigation(options: UseAppNavigationOptions = {}): UseAppNavigationReturn {
  const [view, setView] = useState<ViewId>(options.initialView ?? 'workbench')
  const [stage, setStage] = useState<number>(options.initialStage ?? DEFAULT_STAGE)
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>(options.initialTab ?? 'quality')
  const [receiptFocus, setReceiptFocus] = useState<string | null>(null)
  const [storyboardChapter, setStoryboardChapter] = useState<number | null>(null)

  const stageFocus = useMemo(() => stageToFocus(stage), [stage])

  const handleSelectView = useCallback((next: ViewId): boolean => {
    // U06：分镜有未保存修改时，切页先经确认（取消=留在原地，焦点/滚动自然保留）
    if (next !== 'storyboard' && !confirmStoryboardLeave('切换到其他页面')) return false
    if (next !== 'storyboard') setStoryboardChapter(null) // 离开分镜不带旧章号
    setView(next)
    const tab = INSPECTOR_VIEW_TO_TAB[next]
    if (tab !== undefined) setInspectorTab(tab)
    return true
  }, [])

  const explainContext = useCallback((receiptId: string): void => {
    setReceiptFocus(receiptId)
    handleSelectView('context-receipt')
  }, [handleSelectView])

  const openStoryboard = useCallback((chapter?: number | null): boolean => {
    if (chapter !== undefined) setStoryboardChapter(chapter)
    return handleSelectView('storyboard')
  }, [handleSelectView])

  return {
    view,
    setView,
    stage,
    setStage,
    stageFocus,
    inspectorTab,
    setInspectorTab,
    receiptFocus,
    setReceiptFocus,
    storyboardChapter,
    setStoryboardChapter,
    handleSelectView,
    explainContext,
    openStoryboard,
  }
}
