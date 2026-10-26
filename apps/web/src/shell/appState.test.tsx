/**
 * 墨舟前端状态层切片单元测试（apps/web/src/shell/appState.test.tsx）。
 * 覆盖 useBookSession、useAppNavigation、useAppOverlays 及分镜脏状态离开检查协同。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookSession } from './useBookSession'
import { useAppNavigation, INSPECTOR_VIEW_TO_TAB, DEFAULT_STAGE, stageToFocus } from './useAppNavigation'
import { useAppOverlays, WIZARD_DONE_KEY, MIGRATION_HASH } from './useAppOverlays'
import { setStoryboardSaveState } from '../storyboard/dirtyGuard'
import type { BookInfo } from './workbenchStorage'
import type { ViewId } from './views'

const MOCK_BOOK_1: BookInfo = {
  root: 'C:\\tmp\\book-1',
  bookId: 'bk_1',
  title: '天火重临',
}

const MOCK_BOOK_2: BookInfo = {
  root: 'C:\\tmp\\book-2',
  bookId: 'bk_2',
  title: '深渊之下',
}

describe('前端状态层切片 Hook 集群（appState）', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setStoryboardSaveState('idle')
    if (typeof window !== 'undefined') {
      window.location.hash = ''
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    setStoryboardSaveState('idle')
    if (typeof window !== 'undefined') {
      window.location.hash = ''
    }
  })

  describe('useBookSession（会话与切书状态）', () => {
    it('正确初始化 book, chapterIndex 与 dataGeneration', () => {
      const { result } = renderHook(() =>
        useBookSession({ initialBook: MOCK_BOOK_1 }),
      )

      expect(result.current.book).toEqual(MOCK_BOOK_1)
      expect(result.current.chapterIndex).toBe(1)
      expect(result.current.dataGeneration).toBe(0)
    })

    it('切书成功时重置 chapterIndex 为 1 并触发 onNavigateWorkbench', () => {
      const onNavigate = vi.fn()
      const { result } = renderHook(() =>
        useBookSession({ initialBook: MOCK_BOOK_1, onNavigateWorkbench: onNavigate }),
      )

      act(() => {
        result.current.setChapterIndex(5)
      })
      expect(result.current.chapterIndex).toBe(5)

      let switched = false
      act(() => {
        switched = result.current.selectBook(MOCK_BOOK_2)
      })

      expect(switched).toBe(true)
      expect(result.current.book).toEqual(MOCK_BOOK_2)
      expect(result.current.chapterIndex).toBe(1)
      expect(onNavigate).toHaveBeenCalledWith('workbench')
    })

    it('分镜有未保存修改时，切书若被用户取消则中止切换', () => {
      setStoryboardSaveState('dirty')
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      const onNavigate = vi.fn()
      const { result } = renderHook(() =>
        useBookSession({ initialBook: MOCK_BOOK_1, onNavigateWorkbench: onNavigate }),
      )

      let switched = false
      act(() => {
        switched = result.current.selectBook(MOCK_BOOK_2)
      })

      expect(switched).toBe(false)
      expect(result.current.book).toEqual(MOCK_BOOK_1)
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it('bumpDataGeneration 递增数据代次', () => {
      const { result } = renderHook(() =>
        useBookSession({ initialBook: null }),
      )

      expect(result.current.dataGeneration).toBe(0)
      act(() => {
        result.current.bumpDataGeneration()
      })
      expect(result.current.dataGeneration).toBe(1)
      act(() => {
        result.current.bumpDataGeneration()
      })
      expect(result.current.dataGeneration).toBe(2)
    })
  })

  describe('useAppNavigation（导航与检视塔联动）', () => {
    it('正确初始化 view, stage 与 inspectorTab', () => {
      const { result } = renderHook(() =>
        useAppNavigation({ initialView: 'workbench' }),
      )

      expect(result.current.view).toBe('workbench')
      expect(result.current.stage).toBe(DEFAULT_STAGE)
      expect(result.current.stageFocus).toBe(stageToFocus(DEFAULT_STAGE))
      expect(result.current.inspectorTab).toBe('quality')
      expect(result.current.receiptFocus).toBeNull()
      expect(result.current.storyboardChapter).toBeNull()
    })

    it('切换至检视塔相关视图时联动同步 inspectorTab', () => {
      const { result } = renderHook(() => useAppNavigation())

      for (const [viewId, expectedTab] of Object.entries(INSPECTOR_VIEW_TO_TAB)) {
        act(() => {
          result.current.handleSelectView(viewId as ViewId)
        })
        expect(result.current.view).toBe(viewId)
        expect(result.current.inspectorTab).toBe(expectedTab)
      }
    })

    it('分镜有未保存修改时，切换视图若被取消则留在当前视图', () => {
      const { result } = renderHook(() =>
        useAppNavigation({ initialView: 'storyboard' }),
      )

      setStoryboardSaveState('dirty')
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      let navigated = false
      act(() => {
        navigated = result.current.handleSelectView('workbench')
      })

      expect(navigated).toBe(false)
      expect(result.current.view).toBe('storyboard')
    })

    it('explainContext 设置 receiptFocus 并导航至装配看板', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.explainContext('rcpt_12345')
      })

      expect(result.current.receiptFocus).toBe('rcpt_12345')
      expect(result.current.view).toBe('context-receipt')
      expect(result.current.inspectorTab).toBe('context-receipt')
    })

    it('openStoryboard 携带目标章节并导航至 storyboard 视图', () => {
      const { result } = renderHook(() => useAppNavigation())

      act(() => {
        result.current.openStoryboard(8)
      })

      expect(result.current.storyboardChapter).toBe(8)
      expect(result.current.view).toBe('storyboard')
    })
  })

  describe('useAppOverlays（单飞互斥栈与浮层管理）', () => {
    it('无书且未完成向导时默认打开 wizard', () => {
      window.localStorage.removeItem(WIZARD_DONE_KEY)
      const { result } = renderHook(() =>
        useAppOverlays({ initialBook: null }),
      )

      expect(result.current.wizardOpen).toBe(true)
      expect(result.current.activeOverlay).toBe('wizard')
      expect(result.current.desktopModal).toBeNull()
      expect(result.current.sceneSheetOpen).toBe(false)
      expect(result.current.migrationOpen).toBe(false)
    })

    it('已完成向导或有初始书时，互斥栈为空', () => {
      window.localStorage.setItem(WIZARD_DONE_KEY, 'done')
      const { result } = renderHook(() =>
        useAppOverlays({ initialBook: MOCK_BOOK_1 }),
      )

      expect(result.current.wizardOpen).toBe(false)
      expect(result.current.activeOverlay).toBeNull()
    })

    it('浮层打开满足单飞互斥：新浮层压栈置顶成为唯一激活浮层', () => {
      window.localStorage.setItem(WIZARD_DONE_KEY, 'done')
      const { result } = renderHook(() =>
        useAppOverlays({ initialBook: MOCK_BOOK_1 }),
      )

      // 1. 打开 desktopModal
      act(() => {
        result.current.openDesktopModal('history')
      })
      expect(result.current.activeOverlay).toBe('desktopModal')
      expect(result.current.desktopModal).toBe('history')
      expect(result.current.sceneSheetOpen).toBe(false)

      // 2. 再打开 sceneSheet，sceneSheet 成为栈顶，desktopModal 暂不激活
      act(() => {
        result.current.openSceneSheet()
      })
      expect(result.current.activeOverlay).toBe('sceneSheet')
      expect(result.current.sceneSheetOpen).toBe(true)
      expect(result.current.desktopModal).toBeNull()

      // 3. 关闭 sceneSheet，desktopModal 回归栈顶激活
      act(() => {
        result.current.closeSceneSheet()
      })
      expect(result.current.activeOverlay).toBe('desktopModal')
      expect(result.current.desktopModal).toBe('history')

      // 4. 关闭 desktopModal，栈空
      act(() => {
        result.current.closeDesktopModal()
      })
      expect(result.current.activeOverlay).toBeNull()
    })

    it('handleWizardComplete 写入 localStorage，选书并关闭向导', () => {
      const onSelect = vi.fn()
      const { result } = renderHook(() =>
        useAppOverlays({ initialBook: null, onBookSelected: onSelect }),
      )

      act(() => {
        result.current.handleWizardComplete({
          root: 'C:\\tmp\\new-book',
          bookId: 'bk_new',
          title: '新建长篇',
          worldRule: '灵气复苏',
          volumePromise: '拯救宗门',
          opening: '雨夜废墟',
          firstChapterGoal: '初露锋芒',
        })
      })

      expect(window.localStorage.getItem(WIZARD_DONE_KEY)).toBe('done')
      expect(onSelect).toHaveBeenCalledWith({
        root: 'C:\\tmp\\new-book',
        bookId: 'bk_new',
        title: '新建长篇',
      })
      expect(result.current.wizardOpen).toBe(false)
    })

    it('handleMigrationImported 在有写入时触发数据代次递增', () => {
      const onBump = vi.fn()
      const { result } = renderHook(() =>
        useAppOverlays({ initialBook: MOCK_BOOK_1, onDataGenerationBump: onBump }),
      )

      act(() => {
        result.current.handleMigrationImported(0)
      })
      expect(onBump).not.toHaveBeenCalled()

      act(() => {
        result.current.handleMigrationImported(3)
      })
      expect(onBump).toHaveBeenCalledTimes(1)
    })

    it('通过 closeAllOverlays 彻底清理全部浮层及 hash', () => {
      window.location.hash = MIGRATION_HASH
      const { result } = renderHook(() =>
        useAppOverlays({ initialBook: null }),
      )

      act(() => {
        result.current.openDesktopModal('export')
      })
      expect(result.current.activeOverlay).toBe('desktopModal')

      act(() => {
        result.current.closeAllOverlays()
      })
      expect(result.current.activeOverlay).toBeNull()
      expect(result.current.overlayStack).toEqual([])
      expect(window.location.hash).toBe('')
    })
  })
})
