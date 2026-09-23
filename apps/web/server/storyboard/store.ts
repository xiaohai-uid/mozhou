/**
 * 漫剧分镜独立存储（T02）：
 * - 落盘位置：<书根>/adaptations/storyboards/<sb_ULID>.json——改编是独立衍生作品，
 *   不进被定义为可丢弃缓存的 .mozhou；已核实 rebuildProjectionFromCanon 仅清理
 *   投影文件（runtime.sqlite 等），scanLibrary 只按书目记录扫书根，均不触碰本目录。
 * - 服务端权威：id/revision/路径/书身份/源 hash/总时长全部服务端决定；文件名即 id
 *   （sb_<ULID> 严格校验），天然阻断路径穿越。
 * - 原子写：atomicReplace（tmp+rename），写失败保留上次有效文件。
 * - 并发：expectedRevision 乐观并发 + 单书进程内串行（同一 root 的保存排队），
 *   冲突返回 409 并携带 storedRevision——客户端保留本地编辑。
 * - stale：派生属性（当前盘上源 hash ≠ 文档记录的 source.sha256），不由模型决定。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  LocalDataPlane,
  atomicReplace,
  proseChapterPath,
  sha256Hex,
} from '@mozhou/data-plane'
import { newUlid } from '@mozhou/kernel'
import {
  STORYBOARD_ID_PATTERN,
  STORYBOARD_LIMITS,
  StoryboardValidationError,
  sumEstimatedDuration,
  validateStoryboardDocument,
} from './contract.js'
import type { SourceSnapshot, StoryboardDocument } from './contract.js'

export const STORYBOARD_DIR_REL = 'adaptations/storyboards'
export const SOURCE_EXCERPT_CHARS = STORYBOARD_LIMITS.maxExcerptCharacters

export class StoryboardConflictError extends Error {
  override readonly name = 'StoryboardConflictError'
  constructor(readonly storedId: string, readonly storedRevision: number, readonly expectedRevision: number | null) {
    super(`storyboard ${storedId} revision conflict: stored r${storedRevision}, request expected ${expectedRevision ?? 'create(null)'}`)
  }
}

export class StoryboardNotFoundError extends Error {
  override readonly name = 'StoryboardNotFoundError'
  constructor(readonly storyboardId: string) {
    super('storyboard not found')
  }
}

/* ---------------------------------------------------------------------------
 * 单书进程内串行：同一书根的保存/列表读改竞争排队（本地单进程语义）。
 * ------------------------------------------------------------------------- */

const bookSaveChains = new Map<string, Promise<unknown>>()

/** 单书进程内串行执行（保存与生成都走它：brief 并发约束 concurrentPerBook=1）。 */
export function withBookLock<T>(root: string, task: () => Promise<T> | T): Promise<T> {
  const prev = bookSaveChains.get(root) ?? Promise.resolve()
  const next = prev.then(task, task)
  bookSaveChains.set(root, next.catch(() => undefined))
  return next
}

/* ---------------------------------------------------------------------------
 * 源快照（同一次读取计算 hash 与预览；空章拒绝）
 * ------------------------------------------------------------------------- */

export interface StoryboardSourceInfo {
  readonly source: SourceSnapshot
  readonly title: string
  readonly characterCount: number
  readonly excerpt: string
  /** 服务端读取的原文全文（仅内存中转给生成器；不落盘、不出网）。 */
  readonly body: string
}

export class ChapterMissingError extends Error {
  override readonly name = 'ChapterMissingError'
  constructor(readonly chapterIndex: number) {
    super(`chapter ${chapterIndex} not found on disk`)
  }
}

/** 读源快照：磁盘原始字节算 hash（不信任客户端），标题取大纲节点，空章拒绝。 */
export function readSourceSnapshot(root: string, chapterIndex: number): StoryboardSourceInfo {
  const plane = LocalDataPlane.openOrRebuild(root)
  try {
    let scan: ReturnType<typeof plane.getProseChapter>
    try {
      scan = plane.getProseChapter(chapterIndex)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ChapterMissingError(chapterIndex)
      }
      throw error
    }
    const body = scan.body
    if (body.trim() === '') {
      throw new StoryboardValidationError([`chapter ${chapterIndex} is empty; nothing to adapt`])
    }
    const overview = plane.getWorksOverview()
    const chapterMeta = overview.chapters.find((ch) => ch.chapterIndex === chapterIndex)
    const rawBytes = readFileSync(join(root, proseChapterPath(chapterIndex)))
    return {
      source: {
        bookId: plane.book.id,
        chapterIndex,
        revision: scan.revision,
        phase: scan.phase,
        sha256: sha256Hex(rawBytes),
      },
      title: chapterMeta?.title ?? `第 ${chapterIndex} 章`,
      characterCount: body.length,
      excerpt: body.slice(0, SOURCE_EXCERPT_CHARS),
      body,
    }
  } finally {
    plane.close()
  }
}

/** 当前盘上源 hash；章缺失返回 null（保存仍允许——作者可继续编辑既有分镜）。 */
export function currentSourceHash(root: string, chapterIndex: number): string | null {
  const prosePath = join(root, proseChapterPath(chapterIndex))
  if (!existsSync(prosePath)) return null
  return sha256Hex(readFileSync(prosePath))
}

/* ---------------------------------------------------------------------------
 * 存储：列表 / 读取 / 保存
 * ------------------------------------------------------------------------- */

export interface StoryboardListItem {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly sourceStale: boolean
  readonly updatedAt: string
}

function storyboardFilePath(root: string, id: string): string {
  if (!STORYBOARD_ID_PATTERN.test(id)) {
    throw new StoryboardValidationError([`storyboard id rejected (path safety): ${id.slice(0, 8)}…`])
  }
  return join(root, STORYBOARD_DIR_REL, `${id}.json`)
}

function ensureDir(root: string): string {
  const dir = join(root, STORYBOARD_DIR_REL)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function parseStored(root: string, id: string): StoryboardDocument {
  const raw = readFileSync(storyboardFilePath(root, id), 'utf8')
  return validateStoryboardDocument(JSON.parse(raw))
}

function isStale(root: string, document: StoryboardDocument): boolean {
  const current = currentSourceHash(root, document.source.chapterIndex)
  return current !== null && current !== document.source.sha256
}

export function listStoryboards(root: string): { items: StoryboardListItem[]; skippedInvalid: number } {
  const dir = join(root, STORYBOARD_DIR_REL)
  if (!existsSync(dir)) return { items: [], skippedInvalid: 0 }
  const items: StoryboardListItem[] = []
  let skippedInvalid = 0
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    const id = entry.slice(0, -'.json'.length)
    try {
      const doc = parseStored(root, id)
      items.push({
        id: doc.id,
        title: doc.title,
        revision: doc.revision,
        sourceStale: isStale(root, doc),
        updatedAt: doc.updatedAt,
      })
    } catch {
      // 单文件损坏不拖垮列表：计数并在响应中如实上报，不静默吞掉。
      skippedInvalid += 1
    }
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return { items, skippedInvalid }
}

export function readStoryboard(root: string, id: string): { document: StoryboardDocument; sourceStale: boolean } {
  const document = parseStored(root, id)
  return { document, sourceStale: isStale(root, document) }
}

export interface SaveStoryboardResult {
  readonly id: string
  readonly revision: number
  readonly sourceStale: boolean
}

/**
 * 保存（author sovereignty：stale 不拦截保存——人工编辑优先，只如实标记）。
 * - expectedRevision=null：新建；id 必须不存在；
 * - expectedRevision=number：更新；必须等于盘上 revision，否则 409；
 * - 任何写盘前再次验证：请求书身份=盘上书身份、章在盘上存在、字节上限。
 */
export function saveStoryboard(
  root: string,
  documentInput: unknown,
  expectedRevision: number | null,
): Promise<SaveStoryboardResult> {
  return withBookLock(root, () => saveStoryboardLocked(root, documentInput, expectedRevision))
}

function saveStoryboardLocked(
  root: string,
  documentInput: unknown,
  expectedRevision: number | null,
): SaveStoryboardResult {
  // 新建（expectedRevision=null）允许 id 缺省/空：id 由服务端铸造（sb_<ULID>），
  // 客户端自带 id 的创建仅接受同样格式且盘上不存在——绝无路径自由。
  let candidate: unknown = documentInput
  if (expectedRevision === null
    && typeof documentInput === 'object' && documentInput !== null && !Array.isArray(documentInput)) {
    const record = documentInput as Record<string, unknown>
    if (record['id'] === undefined || record['id'] === '') {
      candidate = { ...record, id: mintStoryboardId() }
    }
  }

  const document = validateStoryboardDocument(candidate)

  // 写盘前权威校验：书身份归属（请求 root 对应的 bookId）与源章存在性。
  const plane = LocalDataPlane.openOrRebuild(root)
  try {
    if (document.source.bookId !== plane.book.id) {
      throw new StoryboardValidationError([
        `source.bookId ownership mismatch: document claims ${document.source.bookId.slice(0, 12)}…, root is ${plane.book.id.slice(0, 12)}…`,
      ])
    }
  } finally {
    plane.close()
  }
  if (currentSourceHash(root, document.source.chapterIndex) === null) {
    throw new ChapterMissingError(document.source.chapterIndex)
  }

  const serialized = JSON.stringify(document, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > STORYBOARD_LIMITS.maxResponseBytes) {
    throw new StoryboardValidationError([`serialized document exceeds ${STORYBOARD_LIMITS.maxResponseBytes} bytes`])
  }

  const filePath = storyboardFilePath(root, document.id)
  const exists = existsSync(filePath)
  if (expectedRevision === null) {
    if (exists) {
      throw new StoryboardConflictError(document.id, parseStored(root, document.id).revision, null)
    }
  } else {
    if (!exists) throw new StoryboardNotFoundError(document.id)
    const stored = parseStored(root, document.id)
    if (stored.revision !== expectedRevision) {
      throw new StoryboardConflictError(document.id, stored.revision, expectedRevision)
    }
  }

  // 服务端权威字段重铸：revision / 时间戳 / 总时长不采信输入值。
  const now = new Date().toISOString()
  const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1
  const finalDocument: StoryboardDocument = {
    ...document,
    revision: nextRevision,
    totalEstimatedDurationSeconds: sumEstimatedDuration(document.shots),
    createdAt: expectedRevision === null ? now : document.createdAt,
    updatedAt: now,
  }

  ensureDir(root)
  atomicReplace(root, `${STORYBOARD_DIR_REL}/${document.id}.json`, JSON.stringify(finalDocument, null, 2))
  return {
    id: finalDocument.id,
    revision: finalDocument.revision,
    sourceStale: isStale(root, finalDocument),
  }
}

/** 服务端铸造新分镜 id（sb_ + 单调 ULID；客户端不得自带 id 创建）。 */
export function mintStoryboardId(): string {
  return `sb_${newUlid()}`
}
