/**
 * 工作台持久化（实现票 T40 · 商业化跨端热恢复）：书名（bookRoot + bookId + title）与视图状态
 * 经统一存储适配器记忆，刷新不丢（spec #84 US12）。支持草稿跨端缩放热恢复缓存。
 */
import { isViewId } from './views'
import type { ViewId } from './views'
import { syncSha256Hex } from '../workbench/lib/sha256'
import type { EditorBlock } from '../workbench/editor/customNodes'
import {
  STORAGE_KEYS,
  candidateCacheKey,
  defaultStorage,
  draftBaselineKey,
  draftCacheKey,
  editorProjectionKey,
  getStorageItem,
  getStorageRawString,
  removeStorageItem,
  setStorageItem,
  setStorageRawString,
} from './storage/browserStorage'

export interface BookInfo {
  readonly root: string
  readonly bookId: string
  readonly title: string
}

export interface WorkbenchState {
  readonly book: BookInfo | null
  readonly view: ViewId
}

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = { book: null, view: 'workbench' }

function isWorkbenchState(parsed: unknown): parsed is WorkbenchState {
  if (typeof parsed !== 'object' || parsed === null) return false
  const { book, view } = parsed as { book?: unknown; view?: unknown }
  if (!isViewId(view)) return false
  if (book === null) return true
  if (typeof book !== 'object') return false
  const { root, bookId, title } = book as { root?: unknown; bookId?: unknown; title?: unknown }
  return (
    typeof root === 'string' &&
    typeof bookId === 'string' &&
    typeof title === 'string'
  )
}

export function loadWorkbenchState(): WorkbenchState {
  return (
    getStorageItem<WorkbenchState>(STORAGE_KEYS.WORKBENCH_STATE, {
      validator: isWorkbenchState,
      fallback: DEFAULT_WORKBENCH_STATE,
    }) ?? DEFAULT_WORKBENCH_STATE
  )
}

export function saveWorkbenchState(state: WorkbenchState): boolean {
  return setStorageItem(STORAGE_KEYS.WORKBENCH_STATE, state)
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
  return getStorageRawString(draftCacheKey(chapterKey), '')
}

export function saveDraftCache(text: string, chapterKey: DraftCacheKey): boolean {
  if (chapterKey === null) return false
  const key = draftCacheKey(chapterKey)
  if (text) {
    return setStorageRawString(key, text)
  } else {
    removeStorageItem(key)
    return true
  }
}

/** 只在成功保存或服务端回填时记录；编辑输入不会改变保存基线。 */
export function saveDraftBaseline(text: string, chapterKey: DraftCacheKey): void {
  if (chapterKey === null) return
  setStorageRawString(draftBaselineKey(chapterKey), syncSha256Hex(text))
}

/** 无基线的历史缓存保守地按作者未保存文字处理。 */
export function draftCacheMatchesBaseline(text: string, chapterKey: DraftCacheKey): boolean {
  if (chapterKey === null) return false
  const baseline = defaultStorage.getItem(draftBaselineKey(chapterKey))
  return baseline !== null && baseline === syncSha256Hex(text)
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

/**
 * 编辑器结构投影（CHG-20261006-02 AST 化）：场景块等编辑器结构存本地投影，
 * 不进 Chapter body（正文契约仍是纯文本字符串）。键纪律与草稿缓存一致：
 * 绑定书身份（bookId 优先 root 兜底），无身份不读不写。
 */
export interface EditorProjection {
  readonly savedAt: string
  readonly blocks: readonly EditorBlock[]
}

function isEditorProjection(parsed: unknown): parsed is EditorProjection {
  if (typeof parsed !== 'object' || parsed === null) return false
  const { savedAt, blocks } = parsed as { savedAt?: unknown; blocks?: unknown }
  return typeof savedAt === 'string' && Array.isArray(blocks)
}

export function loadEditorProjection(chapterKey: DraftCacheKey): EditorProjection | null {
  if (chapterKey === null) return null
  return getStorageItem<EditorProjection>(editorProjectionKey(chapterKey), {
    validator: isEditorProjection,
  })
}

export function saveEditorProjection(blocks: readonly EditorBlock[], chapterKey: DraftCacheKey): void {
  if (chapterKey === null) return
  const projection: EditorProjection = { savedAt: new Date().toISOString(), blocks }
  setStorageItem(editorProjectionKey(chapterKey), projection)
}

export interface CandidateCache {
  readonly candidateId: string
  readonly base: { readonly revision: number; readonly sha256: string }
  readonly mode: 'replace' | 'continue' | 'insert' | 'replace-selection'
  readonly draftText: string
  readonly phase: 'draft_done' | 'drafting' | 'answered'
  readonly partial?: boolean | undefined
}

export function candidateDraftKey(
  book: Pick<BookInfo, 'bookId' | 'root'>,
  chapterIndex: number,
): DraftCacheKey {
  const identity = book.bookId || book.root
  return identity ? `cand_${identity}_${chapterIndex}` : null
}

function isCandidateCache(parsed: unknown): parsed is CandidateCache {
  if (typeof parsed !== 'object' || parsed === null) return false
  const candidate = parsed as CandidateCache
  return Boolean(
    typeof candidate.candidateId === 'string' &&
    candidate.base &&
    typeof candidate.base === 'object' &&
    typeof candidate.base.revision === 'number' &&
    typeof candidate.base.sha256 === 'string' &&
    typeof candidate.mode === 'string' &&
    typeof candidate.draftText === 'string' &&
    typeof candidate.phase === 'string',
  )
}

export function loadCandidateCache(chapterKey: DraftCacheKey): CandidateCache | null {
  if (chapterKey === null) return null
  return getStorageItem<CandidateCache>(candidateCacheKey(chapterKey), {
    validator: isCandidateCache,
  })
}

export function saveCandidateCache(candidate: CandidateCache | null, chapterKey: DraftCacheKey): void {
  if (chapterKey === null) return
  const key = candidateCacheKey(chapterKey)
  if (candidate !== null) {
    setStorageItem(key, candidate)
  } else {
    removeStorageItem(key)
  }
}
