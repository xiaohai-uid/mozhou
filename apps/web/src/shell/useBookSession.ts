/**
 * 作品会话与章节状态切片 Hook（useBookSession）。
 * 封装 book, chapterIndex, dataGeneration, selectBook 与切书逻辑。
 */
import { useState, useCallback } from 'react'
import type { BookInfo } from './workbenchStorage'
import { confirmStoryboardLeave } from '../storyboard/dirtyGuard'
import type { ViewId } from './views'

export interface UseBookSessionOptions {
  readonly initialBook: BookInfo | null
  readonly onNavigateWorkbench?: (view: ViewId) => void
}

export interface UseBookSessionReturn {
  readonly book: BookInfo | null
  readonly setBook: React.Dispatch<React.SetStateAction<BookInfo | null>>
  readonly chapterIndex: number
  readonly setChapterIndex: React.Dispatch<React.SetStateAction<number>>
  readonly dataGeneration: number
  readonly bumpDataGeneration: () => void
  readonly selectBook: (nextBook: BookInfo) => boolean
  readonly handleBookCreated: (created: BookInfo) => void
  readonly handleBookSwitch: (switched: BookInfo) => void
}

export function useBookSession(options: UseBookSessionOptions): UseBookSessionReturn {
  const [book, setBook] = useState<BookInfo | null>(options.initialBook)
  const [chapterIndex, setChapterIndex] = useState(1)
  const [dataGeneration, setDataGeneration] = useState(0)

  const bumpDataGeneration = useCallback(() => {
    setDataGeneration((n) => n + 1)
  }, [])

  const selectBook = useCallback((nextBook: BookInfo): boolean => {
    // U06：切书经过离开确认（干净文档直接通过）
    if (!confirmStoryboardLeave('切换作品')) return false
    setBook(nextBook)
    setChapterIndex(1)
    options.onNavigateWorkbench?.('workbench')
    return true
  }, [options])

  const handleBookCreated = useCallback((created: BookInfo): void => {
    selectBook(created)
  }, [selectBook])

  const handleBookSwitch = useCallback((switched: BookInfo): void => {
    selectBook(switched)
  }, [selectBook])

  return {
    book,
    setBook,
    chapterIndex,
    setChapterIndex,
    dataGeneration,
    bumpDataGeneration,
    selectBook,
    handleBookCreated,
    handleBookSwitch,
  }
}
