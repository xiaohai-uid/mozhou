/**
 * 工作台持久化（实现票 T40 · 商业化跨端热恢复）：书名（bookRoot + bookId + title）与视图状态
 * 经 localStorage 记忆，刷新不丢（spec #84 US12）。支持草稿跨端缩放热恢复缓存。
 */
import { isViewId } from './views'
import type { ViewId } from './views'

export interface BookInfo {
  readonly root: string
  readonly bookId: string
  readonly title: string
}

export interface WorkbenchState {
  readonly book: BookInfo | null
  readonly view: ViewId
  readonly chapterIndex?: number
}

const STORAGE_KEY = 'mozhou.workbench.v1'
const DRAFT_CACHE_KEY = 'mozhou.draft.cache'

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = { book: null, view: 'workbench', chapterIndex: 1 }

export function loadWorkbenchState(): WorkbenchState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_WORKBENCH_STATE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WORKBENCH_STATE
    const { book, view, chapterIndex: rawChapter } = parsed as {
      book?: unknown
      view?: unknown
      chapterIndex?: unknown
    }
    if (!isViewId(view)) return DEFAULT_WORKBENCH_STATE
    const chapterIndex =
      typeof rawChapter === 'number' && Number.isSafeInteger(rawChapter) && rawChapter >= 1
        ? rawChapter
        : 1
    if (book === null) return { book: null, view, chapterIndex }
    if (typeof book !== 'object') return DEFAULT_WORKBENCH_STATE
    const { root, bookId, title } = book as { root?: unknown; bookId?: unknown; title?: unknown }
    if (typeof root !== 'string' || typeof bookId !== 'string' || typeof title !== 'string') {
      return DEFAULT_WORKBENCH_STATE
    }
    return { book: { root, bookId, title }, view, chapterIndex }
  } catch {
    return DEFAULT_WORKBENCH_STATE
  }
}

export function saveWorkbenchState(state: WorkbenchState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage 不可用（隐私模式等）时静默：持久化是增强，不是硬依赖。
  }
}

/** 跨端缩放与热切换草稿暂存 */
export function loadDraftCache(chapterKey = 'ch_1'): string {
  try {
    return window.localStorage.getItem(`${DRAFT_CACHE_KEY}.${chapterKey}`) ?? ''
  } catch {
    return ''
  }
}

export function saveDraftCache(text: string, chapterKey = 'ch_1'): void {
  try {
    if (text) {
      window.localStorage.setItem(`${DRAFT_CACHE_KEY}.${chapterKey}`, text)
    } else {
      window.localStorage.removeItem(`${DRAFT_CACHE_KEY}.${chapterKey}`)
    }
  } catch {
    // 静默容错
  }
}
