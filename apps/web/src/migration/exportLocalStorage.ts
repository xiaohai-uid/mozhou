/**
 * 旧浏览器 localStorage → 迁移包导出器（P1-export · 迁移合同 §3.1 / 键清单 §1.4）。
 *
 * 为什么不用 workbenchStorage 的 getter：现有模块只提供「按章取值」的读入口
 * （loadDraftCache(key) 需要先构造 chapterKey），无法回答「旧页面里到底存了哪些键」。
 * 导出必须**枚举**真实存在的键（`localStorage.length` + `key(i)`），否则跨作品、
 * 待认领与旧版无归属键都会被漏掉。本模块只读，不写、不清空任何源端键。
 *
 * 归属规则（合同硬约束）：
 * - 只处理 §1.4 白名单键；白名单外的键一律不进包。
 * - 身份后缀 = `bookId || root`，与 `workbenchStorage.chapterDraftKey` 同源。
 * - 旧版无归属键 `ch_<N>`（只有一个下划线）**永不匹配**，一律不进包。
 * - 身份后缀存在但不对应当前作品（或当前作品未知）→ 进待认领区，不分配给任何作品。
 */
import {
  MIGRATION_FORMAT_VERSION,
  computePackageDigest,
} from './packageFormat'
import type {
  BookIdentity,
  CandidateMode,
  CandidatePhase,
  ChapterDraftRecord,
  MigrationBookEntry,
  MigrationCandidate,
  MigrationChapterEntry,
  MigrationPackageV1,
  MigrationUnclaimedEntry,
  MigrationUnclaimedKind,
} from './packageFormat'

/** localStorage 的最小只读面（浏览器与测试替身都满足）。 */
export interface StorageReader {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
}

export const WORKBENCH_STATE_KEY = 'mozhou.workbench.v1'
export const DRAFT_CACHE_PREFIX = 'mozhou.draft.cache.'
export const DRAFT_BASELINE_PREFIX = 'mozhou.draft.baseline.'
export const CANDIDATE_CACHE_PREFIX = 'mozhou.candidate.cache.'
export const EDITOR_PROJECTION_PREFIX = 'mozhou.editor.projection.'
/** 应用级偏好（非章数据），原样进 `preferences`。 */
export const APP_PREFERENCE_KEYS: readonly string[] = [
  'mozhou.wizard.done',
  'mozhou.scene.v1',
  'mozhou.skills.active',
]

const CHAPTER_KEY_PREFIXES: readonly string[] = [
  DRAFT_CACHE_PREFIX,
  DRAFT_BASELINE_PREFIX,
  CANDIDATE_CACHE_PREFIX,
  EDITOR_PROJECTION_PREFIX,
]

const CANDIDATE_MODES: readonly string[] = ['replace', 'continue', 'insert', 'replace-selection']
const CANDIDATE_PHASES: readonly string[] = ['draft_done', 'drafting', 'answered']

/** 白名单判定：键是否属于可迁移集合（含工作台状态与偏好键）。 */
export function isWhitelistedKey(key: string): boolean {
  if (key === WORKBENCH_STATE_KEY) return true
  if (APP_PREFERENCE_KEYS.includes(key)) return true
  return CHAPTER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * 枚举真实存在的白名单键（按 `length` + `key(i)`）。
 * 顺序 = localStorage 自然顺序，调用方不得依赖顺序做语义判断。
 */
export function enumerateWhitelistKeys(storage: StorageReader): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (typeof key !== 'string') continue
    if (isWhitelistedKey(key)) keys.push(key)
  }
  return keys
}

/** 章键解析结果：身份后缀 + 章号。 */
export interface ParsedChapterKey {
  readonly identitySuffix: string
  readonly chapterIndex: number
}

/**
 * 解析 `ch_<identity>_<N>` / `cand_<identity>_<N>` 的**后缀**（前缀已剥离）。
 * 规则：`ch_`/`cand_` + 非空身份 + `_` + 正整数章号，身份中允许含下划线
 * （按**最后一个**下划线切分）。旧版 `ch_<N>`（无身份）返回 null —— 不进包。
 */
export function parseChapterSuffix(suffix: string, marker: 'ch' | 'cand'): ParsedChapterKey | null {
  const prefix = `${marker}_`
  if (!suffix.startsWith(prefix)) return null
  const rest = suffix.slice(prefix.length)
  const cut = rest.lastIndexOf('_')
  if (cut <= 0) return null
  const identitySuffix = rest.slice(0, cut)
  const chapterRaw = rest.slice(cut + 1)
  if (identitySuffix.length === 0) return null
  if (!/^[0-9]+$/.test(chapterRaw)) return null
  const chapterIndex = Number(chapterRaw)
  if (!Number.isInteger(chapterIndex) || chapterIndex < 1) return null
  return { identitySuffix, chapterIndex }
}

interface ChapterKeyRef {
  readonly kind: MigrationUnclaimedKind
  readonly marker: 'ch' | 'cand'
  readonly parsed: ParsedChapterKey
}

function classifyChapterKey(key: string): ChapterKeyRef | null {
  const table: readonly { prefix: string; kind: MigrationUnclaimedKind; marker: 'ch' | 'cand' }[] = [
    { prefix: DRAFT_CACHE_PREFIX, kind: 'draft', marker: 'ch' },
    { prefix: DRAFT_BASELINE_PREFIX, kind: 'baseline', marker: 'ch' },
    { prefix: CANDIDATE_CACHE_PREFIX, kind: 'candidate', marker: 'cand' },
    { prefix: EDITOR_PROJECTION_PREFIX, kind: 'projection', marker: 'ch' },
  ]
  for (const entry of table) {
    if (!key.startsWith(entry.prefix)) continue
    const parsed = parseChapterSuffix(key.slice(entry.prefix.length), entry.marker)
    if (parsed === null) return null
    return { kind: entry.kind, marker: entry.marker, parsed }
  }
  return null
}

/** 从 `mozhou.workbench.v1` 读出当前作品身份；缺失或形状非法返回 null。 */
export function readWorkbenchIdentity(storage: StorageReader): BookIdentity | null {
  const raw = storage.getItem(WORKBENCH_STATE_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const book = (parsed as { book?: unknown }).book
    if (typeof book !== 'object' || book === null) return null
    const { root, bookId, title } = book as { root?: unknown; bookId?: unknown; title?: unknown }
    if (typeof root !== 'string' || typeof bookId !== 'string' || typeof title !== 'string') return null
    if (bookId.length === 0 && root.length === 0) return null
    return { bookId, root, title }
  } catch {
    return null
  }
}

/** 身份后缀 = bookId 优先，root 兜底（与 chapterDraftKey 同源）。 */
export function identitySuffixOf(identity: Pick<BookIdentity, 'bookId' | 'root'>): string {
  return identity.bookId || identity.root
}

function parseCandidate(raw: string): MigrationCandidate | null {
  try {
    const parsed = JSON.parse(raw) as {
      candidateId?: unknown
      base?: { revision?: unknown; sha256?: unknown }
      mode?: unknown
      draftText?: unknown
      phase?: unknown
      partial?: unknown
    }
    if (typeof parsed !== 'object' || parsed === null) return null
    if (typeof parsed.candidateId !== 'string') return null
    if (typeof parsed.base !== 'object' || parsed.base === null) return null
    const { revision, sha256 } = parsed.base
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null
    if (typeof sha256 !== 'string') return null
    if (typeof parsed.mode !== 'string' || !CANDIDATE_MODES.includes(parsed.mode)) return null
    if (typeof parsed.draftText !== 'string' || typeof parsed.phase !== 'string') return null
    if (!CANDIDATE_PHASES.includes(parsed.phase)) return null
    return {
      candidateId: parsed.candidateId,
      base: { revision, sha256 },
      mode: parsed.mode as CandidateMode,
      draftText: parsed.draftText,
      phase: parsed.phase as CandidatePhase,
      partial: parsed.partial === true,
    }
  } catch {
    return null
  }
}

function parseProjection(raw: string): { savedAt: string; blocks: readonly unknown[] } | null {
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; blocks?: unknown }
    if (typeof parsed !== 'object' || parsed === null) return null
    if (typeof parsed.savedAt !== 'string' || !Array.isArray(parsed.blocks)) return null
    return { savedAt: parsed.savedAt, blocks: parsed.blocks }
  } catch {
    return null
  }
}

interface MutableChapter {
  chapterIndex: number
  chapterKey: string
  draftText: string | null
  baselineSha256: string | null
  candidate: MigrationCandidate | null
  editorProjection: { savedAt: string; blocks: readonly unknown[] } | null
}

export interface ExportOptions {
  readonly origin?: string
  readonly userAgent?: string
  readonly exportedAt?: string
}

function safeOrigin(): string {
  try {
    return typeof window !== 'undefined' ? window.location.origin : ''
  } catch {
    return ''
  }
}

function safeUserAgent(): string {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : ''
  } catch {
    return ''
  }
}

/**
 * 导出：枚举白名单键 → 归属章节 → 组装迁移包（含内容摘要）。
 * 纯读；源端 localStorage 不被修改或清空。
 */
export function exportLocalStorage(storage: StorageReader, options: ExportOptions = {}): MigrationPackageV1 {
  const identity = readWorkbenchIdentity(storage)
  const currentSuffix = identity === null ? null : identitySuffixOf(identity)

  const preferences: Record<string, string> = {}
  for (const key of APP_PREFERENCE_KEYS) {
    const value = storage.getItem(key)
    if (value !== null) preferences[key] = value
  }

  const unclaimed: MigrationUnclaimedEntry[] = []
  const claimed = new Map<number, MutableChapter>()

  for (const key of enumerateWhitelistKeys(storage)) {
    if (key === WORKBENCH_STATE_KEY) {
      if (identity === null) {
        unclaimed.push({
          key,
          identitySuffix: null,
          chapterIndex: null,
          kind: 'workbench',
          reason: 'unparseable-workbench-identity',
          raw: storage.getItem(key) ?? '',
        })
      }
      continue
    }
    if (APP_PREFERENCE_KEYS.includes(key)) continue

    const ref = classifyChapterKey(key)
    if (ref === null) continue // 旧版无归属键 ch_<N> 等：不进包
    const raw = storage.getItem(key) ?? ''

    if (currentSuffix === null || ref.parsed.identitySuffix !== currentSuffix) {
      unclaimed.push({
        key,
        identitySuffix: ref.parsed.identitySuffix,
        chapterIndex: ref.parsed.chapterIndex,
        kind: ref.kind,
        reason: currentSuffix === null ? 'no-workbench-book' : 'identity-not-current-book',
        raw,
      })
      continue
    }

    let chapter = claimed.get(ref.parsed.chapterIndex)
    if (chapter === undefined) {
      chapter = {
        chapterIndex: ref.parsed.chapterIndex,
        chapterKey: `ch_${ref.parsed.identitySuffix}_${ref.parsed.chapterIndex}`,
        draftText: null,
        baselineSha256: null,
        candidate: null,
        editorProjection: null,
      }
      claimed.set(ref.parsed.chapterIndex, chapter)
    }

    if (ref.kind === 'draft') {
      chapter.draftText = raw
    } else if (ref.kind === 'baseline') {
      chapter.baselineSha256 = raw
    } else if (ref.kind === 'candidate') {
      const candidate = parseCandidate(raw)
      if (candidate === null) {
        unclaimed.push({ key, identitySuffix: ref.parsed.identitySuffix, chapterIndex: ref.parsed.chapterIndex, kind: 'candidate', reason: 'unparseable-candidate', raw })
      } else {
        chapter.candidate = candidate
      }
    } else {
      const projection = parseProjection(raw)
      if (projection === null) {
        unclaimed.push({ key, identitySuffix: ref.parsed.identitySuffix, chapterIndex: ref.parsed.chapterIndex, kind: 'projection', reason: 'unparseable-projection', raw })
      } else {
        chapter.editorProjection = projection
      }
    }
  }

  const chapters: MigrationChapterEntry[] = [...claimed.values()]
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map((chapter) => {
      const hasDraft = chapter.draftText !== null
      const hasBaseline = chapter.baselineSha256 !== null
      const draft: ChapterDraftRecord | null =
        hasDraft || hasBaseline
          ? { text: chapter.draftText ?? '', baselineSha256: chapter.baselineSha256 }
          : null
      return {
        chapterIndex: chapter.chapterIndex,
        chapterKey: chapter.chapterKey,
        draft,
        candidate: chapter.candidate,
        editorProjection: chapter.editorProjection,
      }
    })

  const books: MigrationBookEntry[] = identity === null ? [] : [{ identity, chapters }]

  const payload = {
    formatVersion: MIGRATION_FORMAT_VERSION,
    origin: {
      origin: options.origin ?? safeOrigin(),
      userAgent: options.userAgent ?? safeUserAgent(),
      exportedAt: options.exportedAt ?? new Date().toISOString(),
    },
    books,
    unclaimed,
    preferences,
  }

  return { ...payload, digest: computePackageDigest(payload) }
}
