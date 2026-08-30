/**
 * 工作台持久化（实现票 T40）：书名（bookRoot + bookId + title）与视图状态
 * 经 localStorage 记忆，刷新不丢（spec #84 US12）。解析失败一律回落默认，
 * 不让坏数据挡住工作台。
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
}

const STORAGE_KEY = 'mozhou.workbench.v1'

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = { book: null, view: 'workbench' }

export function loadWorkbenchState(): WorkbenchState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_WORKBENCH_STATE
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WORKBENCH_STATE
    const { book, view } = parsed as { book?: unknown; view?: unknown }
    if (!isViewId(view)) return DEFAULT_WORKBENCH_STATE
    if (book === null) return { book: null, view }
    if (typeof book !== 'object') return DEFAULT_WORKBENCH_STATE
    const { root, bookId, title } = book as { root?: unknown; bookId?: unknown; title?: unknown }
    if (typeof root !== 'string' || typeof bookId !== 'string' || typeof title !== 'string') {
      return DEFAULT_WORKBENCH_STATE
    }
    return { book: { root, bookId, title }, view }
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
