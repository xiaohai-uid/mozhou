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
}

const STORAGE_KEY = 'mozhou.workbench.v1'
const DRAFT_CACHE_KEY = 'mozhou.draft.cache'

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

/**
 * 跨端缩放与热切换草稿暂存。
 * T00 修复：章草稿缓存键绑定书身份（bookId 优先，root 兜底）——同章号不同书不再串稿。
 * 键格式 `ch_<identity>_<N>` 至少含两个下划线，旧版无归属键 `ch_<N>` 永不匹配：
 * 旧缓存保留在 localStorage 中可手动导出，但不会自动分配给任何作品（Author Sovereignty）。
 */

/** 草稿缓存键：null 表示无可绑定书身份——禁止读旧缓存或落缓存。 */
export type DraftCacheKey = string | null

export function loadDraftCache(chapterKey: DraftCacheKey): string {
  if (chapterKey === null) return ''
  try {
    return window.localStorage.getItem(`${DRAFT_CACHE_KEY}.${chapterKey}`) ?? ''
  } catch {
    return ''
  }
}

export function saveDraftCache(text: string, chapterKey: DraftCacheKey): void {
  if (chapterKey === null) return
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

/** 章维度草稿缓存键唯一出处（写作层/对话流/移动阅读面共用，禁止再内联）。
 *  书身份取 bookId（服务端 ULID，随书目持久化），缺失时以 root 兜底；两者皆空
 *  返回 null——无身份内容不得写入或读出任何缓存槽。 */
export function chapterDraftKey(
  book: Pick<BookInfo, 'bookId' | 'root'>,
  chapterIndex: number,
): DraftCacheKey {
  const identity = book.bookId || book.root
  return identity ? `ch_${identity}_${chapterIndex}` : null
}

const CANDIDATE_CACHE_KEY = 'mozhou.candidate.cache'

export interface CandidateCache {
  readonly candidateId: string
  readonly base: { readonly revision: number; readonly sha256: string }
  readonly mode: 'replace' | 'continue' | 'insert' | 'replace-selection'
  readonly draftText: string
  readonly phase: 'draft_done' | 'drafting' | 'answered'
}

export function candidateDraftKey(
  book: Pick<BookInfo, 'bookId' | 'root'>,
  chapterIndex: number,
): DraftCacheKey {
  const identity = book.bookId || book.root
  return identity ? `cand_${identity}_${chapterIndex}` : null
}

export function loadCandidateCache(chapterKey: DraftCacheKey): CandidateCache | null {
  if (chapterKey === null) return null
  try {
    const raw = window.localStorage.getItem(`${CANDIDATE_CACHE_KEY}.${chapterKey}`)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as CandidateCache
    if (!parsed || typeof parsed.candidateId !== 'string' || !parsed.base) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCandidateCache(candidate: CandidateCache | null, chapterKey: DraftCacheKey): void {
  if (chapterKey === null) return
  try {
    if (candidate !== null) {
      window.localStorage.setItem(`${CANDIDATE_CACHE_KEY}.${chapterKey}`, JSON.stringify(candidate))
    } else {
      window.localStorage.removeItem(`${CANDIDATE_CACHE_KEY}.${chapterKey}`)
    }
  } catch {
    // 静默容错
  }
}

