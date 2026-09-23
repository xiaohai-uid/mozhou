/**
 * canon 真源 → 结构化状态的确定性扫描层（S5：重建零 LLM、纯扫描）。
 * T1 只需要识别建书骨架的实体（BookRecord / 大纲两层节点 / 两个规划工件 /
 * 追踪五族原始行）；实体卡与章节相位解析归后续实现票，逐票扩此模块。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AiContextTier, AliasRule, BookRecord, EntityRef } from '@mozhou/kernel'
import {
  AUTHOR_INTENT_PATH,
  BOOK_RECORD_PATH,
  ENTITY_CARD_DIR_BY_PREFIX,
  STYLE_PROFILE_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
  ZONGGANG_PATH,
  proseChapterPath,
  type EntityRefPrefix,
  type TrackingKind,
} from './layout.js'
import { sha256Hex } from './sha256.js'
import { parseFrontmatter, type FrontmatterDocument, type FrontmatterFieldValue } from './yaml-frontmatter.js'

export class CanonStructureError extends Error {
  override readonly name = 'CanonStructureError'

  constructor(readonly relPath: string, detail: string) {
    super(`canon structure violation at ${relPath}: ${detail}`)
  }
}

export interface OutlineNodeScan {
  readonly id: string
  readonly nodeType: 'book' | 'volume' | 'arc' | 'chapter'
  readonly parentId: string | null
  readonly orderIndex: number
  readonly revision: number
  readonly status: string
  /** 大纲标题：Q13 冻结字段集不含 title ⇒ 取正文首个一级标题（文件名只是皮）。 */
  readonly title: string
}

export interface PlanningArtifactScan {
  readonly id: string
  readonly kind: 'authorIntent' | 'styleProfile'
  readonly revision: number
  /** 全文件字节摘要——结构化语义解析归编译器侧票据，投影先锚定内容版本。 */
  readonly contentSha256: string
}

export interface TrackingLineScan {
  readonly seq: number
  readonly lineSha256: string
  readonly payload: string
}

/**
 * 实体目录卡扫描行（entity-directory-spec §3 冻结 Schema；规划·宪法层工件）。
 * aiContext 归一为具体档位（缺省 detected）；tags 不入投影（D4 永不入包），
 * 只留在 canon 文件里。
 */
export interface EntityCardScan {
  readonly ref: EntityRef
  readonly cardType: EntityRefPrefix
  readonly name: string
  readonly aiContext: AiContextTier
  readonly aliases: readonly AliasRule[]
  readonly excludedPhrases: readonly string[]
  readonly brief: string | null
  readonly tags: readonly string[]
  /** 书根相对 POSIX 路径（文件名只是皮，watcher/CRUD 按 ref 定位）。 */
  readonly fileRel: string
}

export interface CanonState {
  readonly book: BookRecord
  readonly outlineNodes: readonly OutlineNodeScan[]
  readonly planningArtifacts: readonly PlanningArtifactScan[]
  readonly trackingLines: Readonly<Record<TrackingKind, readonly TrackingLineScan[]>>
  readonly entityCards: readonly EntityCardScan[]
}

const MOZHOU_ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/

/** 读取并校验 book.json（BookRecord 冻结形状）。 */
export function readBookRecord(root: string): BookRecord {
  const raw = readJsonFile(join(root, BOOK_RECORD_PATH))
  const id = requireString(raw, 'id')
  if (!id.startsWith('book_')) {
    throw new CanonStructureError(BOOK_RECORD_PATH, `bookId must start with 'book_', got ${id}`)
  }
  const title = requireString(raw, 'title')
  if (title.length === 0) {
    throw new CanonStructureError(BOOK_RECORD_PATH, 'title must be non-empty')
  }
  return {
    id: id as BookRecord['id'],
    title,
    revision: requireNumber(raw, 'revision'),
    createdAt: requireIsoTimestamp(raw, 'createdAt'),
    updatedAt: requireIsoTimestamp(raw, 'updatedAt'),
  }
}

function readJsonFile(path: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new CanonStructureError(BOOK_RECORD_PATH, `invalid JSON: ${(error as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CanonStructureError(BOOK_RECORD_PATH, 'expected a JSON object')
  }
  return parsed as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new CanonStructureError(BOOK_RECORD_PATH, `field '${key}' must be a string`)
  }
  return value
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CanonStructureError(BOOK_RECORD_PATH, `field '${key}' must be a finite number`)
  }
  return value
}

function requireIsoTimestamp(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key)
  if (Number.isNaN(Date.parse(value))) {
    throw new CanonStructureError(BOOK_RECORD_PATH, `field '${key}' must be an ISO-8601 timestamp`)
  }
  return value
}

function requireScalar(document: FrontmatterDocument, key: string, relPath: string): FrontmatterFieldValue {
  const value = document.data[key]
  if (value === undefined) {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' is required`)
  }
  return value
}

function requireFrontmatterString(document: FrontmatterDocument, key: string, relPath: string): string {
  const value = requireScalar(document, key, relPath)
  if (typeof value !== 'string') {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be a string`)
  }
  return value
}

interface IdentityFrontmatter {
  readonly mozhouId: string
  readonly revision: number
}

/** 从已解析文档提取公共身份位（mozhouId/revision），只解析一次。 */
function identityOf(document: FrontmatterDocument, relPath: string): IdentityFrontmatter {
  const mozhouId = requireFrontmatterString(document, 'mozhouId', relPath)
  if (!MOZHOU_ID_PATTERN.test(mozhouId)) {
    throw new CanonStructureError(relPath, `frontmatter mozhouId must be prefixed ULID, got ${mozhouId}`)
  }
  const revision = requireScalar(document, 'revision', relPath)
  if (typeof revision !== 'number') {
    throw new CanonStructureError(relPath, 'frontmatter revision must be a number')
  }
  return { mozhouId, revision }
}

function parseDocument(raw: string, relPath: string): FrontmatterDocument {
  try {
    return parseFrontmatter(raw)
  } catch (error) {
    throw new CanonStructureError(relPath, (error as Error).message)
  }
}

function titleFromHeading(body: string, relPath: string): string {
  const match = /^#\s+(.+)\s*$/m.exec(body)
  if (match === null) {
    throw new CanonStructureError(relPath, 'missing H1 heading to carry the outline title')
  }
  return match[1]!.trim()
}

const OUTLINE_NODE_TYPES = ['book', 'volume', 'arc', 'chapter'] as const

/* ----------------------------------------------------------------------------
 * 实体目录卡扫描（entity-directory-spec §3/§4；工单 #16 / T2）
 * -------------------------------------------------------------------------- */

const AI_CONTEXT_TIERS = ['always', 'detected', 'detectedOff', 'never'] as const

/** EntityRef 身份校验：五前缀 + 稳定人类可读 slug（禁路径/流集合字符；中文合法）。 */
export function parseEntityRef(ref: string): { prefix: EntityRefPrefix; slug: string } {
  const colonAt = ref.indexOf(':')
  if (colonAt <= 0 || colonAt !== ref.lastIndexOf(':')) {
    throw new CanonStructureError('(entity-ref)', `malformed EntityRef: ${ref}`)
  }
  const prefix = ref.slice(0, colonAt)
  const slug = ref.slice(colonAt + 1)
  if (!(prefix in ENTITY_CARD_DIR_BY_PREFIX)) {
    throw new CanonStructureError('(entity-ref)', `unknown EntityRef prefix '${prefix}': ${ref}`)
  }
  if (slug.length === 0 || slug.length > 128 || /[\\/:*?"<>|#.\s\x00-\x1f]/.test(slug)) {
    throw new CanonStructureError('(entity-ref)', `invalid EntityRef slug: ${ref}`)
  }
  return { prefix: prefix as EntityRefPrefix, slug }
}

function requireCardString(document: FrontmatterDocument, key: string, relPath: string): string {
  const value = requireScalar(document, key, relPath)
  if (typeof value !== 'string' || value.length === 0) {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be a non-empty string`)
  }
  return value
}

function optionalCardString(document: FrontmatterDocument, key: string, relPath: string): string | null {
  const value = document.data[key]
  if (value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be a string`)
  }
  return value
}

function optionalCardStrings(document: FrontmatterDocument, key: string, relPath: string): readonly string[] {
  const value = document.data[key]
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new CanonStructureError(relPath, `frontmatter field '${key}' must be an array of non-empty strings`)
  }
  return value as readonly string[]
}

function optionalAliasRules(document: FrontmatterDocument, relPath: string): readonly AliasRule[] {
  const value = document.data['aliases']
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new CanonStructureError(relPath, "frontmatter field 'aliases' must be an array")
  }
  return value.map((item): AliasRule => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new CanonStructureError(relPath, `alias rule must be a mapping: ${JSON.stringify(item)}`)
    }
    const record = item as Record<string, FrontmatterFieldValue>
    const text = record['text']
    const kind = record['kind']
    const caseSensitive = record['caseSensitive']
    if (typeof text !== 'string' || text.length === 0) {
      throw new CanonStructureError(relPath, `alias rule 'text' must be a non-empty string: ${JSON.stringify(item)}`)
    }
    if (kind !== 'exact' && kind !== 'regex') {
      throw new CanonStructureError(relPath, `alias rule 'kind' must be 'exact'|'regex': ${JSON.stringify(item)}`)
    }
    if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean') {
      throw new CanonStructureError(relPath, `alias rule 'caseSensitive' must be a boolean: ${JSON.stringify(item)}`)
    }
    if (kind === 'regex') {
      // 坏正则宁在扫描期响亮失败，不留到检测期（S5 宁败不脏）
      try {
        new RegExp(text, caseSensitive ? 'gu' : 'giu')
      } catch (error) {
        throw new CanonStructureError(relPath, `invalid alias regex "${text}": ${(error as Error).message}`)
      }
    }
    return caseSensitive === undefined ? { text, kind } : { text, kind, caseSensitive }
  })
}

function readEntityCard(root: string, fileRel: string, expectedType: EntityRefPrefix): EntityCardScan {
  const raw = readFileSync(join(root, fileRel), 'utf8')
  const document = parseDocument(raw, fileRel)

  const ref = requireFrontmatterString(document, 'ref', fileRel)
  const parsed = parseEntityRef(ref)
  if (parsed.prefix !== expectedType) {
    throw new CanonStructureError(
      fileRel,
      `card ref '${ref}' does not match its directory type '${expectedType}'`,
    )
  }
  const name = requireCardString(document, 'name', fileRel)

  const aiContextValue = document.data['aiContext']
  let aiContext: AiContextTier = 'detected'
  if (aiContextValue !== undefined) {
    if (
      typeof aiContextValue !== 'string' ||
      !AI_CONTEXT_TIERS.includes(aiContextValue as (typeof AI_CONTEXT_TIERS)[number])
    ) {
      throw new CanonStructureError(fileRel, `frontmatter aiContext invalid: ${JSON.stringify(aiContextValue)}`)
    }
    aiContext = aiContextValue as AiContextTier
  }

  return {
    ref: ref as EntityRef,
    cardType: expectedType,
    name,
    aiContext,
    aliases: optionalAliasRules(document, fileRel),
    excludedPhrases: optionalCardStrings(document, 'excludedPhrases', fileRel),
    brief: optionalCardString(document, 'brief', fileRel),
    tags: optionalCardStrings(document, 'tags', fileRel),
    fileRel,
  }
}

/**
 * 扫描 设定/<五目>/ 下全部目录卡。子目录缺失按空处理（空目录 git 不追踪，
 * 克隆恢复场景必须容忍）；卡内 .md 之外的文件不属目录卡（仍受基线 untracked 对账）。
 * 返回按 ref 排序——重建灌入与 write-through 行序一致，投影指纹跨机稳定。
 */
export function scanEntityCards(root: string): EntityCardScan[] {
  const cards: EntityCardScan[] = []
  for (const [prefix, dir] of Object.entries(ENTITY_CARD_DIR_BY_PREFIX)) {
    const absoluteDir = join(root, dir)
    if (!existsSync(absoluteDir)) {
      continue
    }
    const collect = (relDir: string): void => {
      for (const name of readdirSync(join(root, relDir))) {
        const childRel = `${relDir}/${name}`
        if (statSync(join(root, childRel)).isDirectory()) {
          collect(childRel)
        } else if (name.endsWith('.md')) {
          cards.push(readEntityCard(root, childRel, prefix as EntityRefPrefix))
        }
      }
    }
    collect(dir)
  }

  const byRef = new Map<string, EntityCardScan>()
  for (const card of cards) {
    if (byRef.has(card.ref)) {
      throw new CanonStructureError(
        card.fileRel,
        `duplicate entity ref '${card.ref}' (also at ${byRef.get(card.ref)?.fileRel})`,
      )
    }
    byRef.set(card.ref, card)
  }
  return [...byRef.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1))
}

function readOutlineNode(root: string, relPath: string): OutlineNodeScan {
  const raw = readFileSync(join(root, relPath), 'utf8')
  const document = parseDocument(raw, relPath)
  const identity = identityOf(document, relPath)

  const nodeType = requireScalar(document, 'nodeType', relPath)
  if (typeof nodeType !== 'string' || !OUTLINE_NODE_TYPES.includes(nodeType as (typeof OUTLINE_NODE_TYPES)[number])) {
    throw new CanonStructureError(relPath, `frontmatter nodeType invalid: ${JSON.stringify(nodeType)}`)
  }
  const parentId = requireScalar(document, 'parentId', relPath)
  if (parentId !== null && typeof parentId !== 'string') {
    throw new CanonStructureError(relPath, 'frontmatter parentId must be null or string')
  }
  const orderIndex = requireScalar(document, 'orderIndex', relPath)
  if (typeof orderIndex !== 'number') {
    throw new CanonStructureError(relPath, 'frontmatter orderIndex must be a number')
  }
  const status = requireFrontmatterString(document, 'status', relPath)
  return {
    id: identity.mozhouId,
    nodeType: nodeType as (typeof OUTLINE_NODE_TYPES)[number],
    parentId,
    orderIndex,
    revision: identity.revision,
    status,
    title: titleFromHeading(document.body, relPath),
  }
}

function readPlanningArtifact(
  root: string,
  relPath: string,
  kind: 'authorIntent' | 'styleProfile',
): PlanningArtifactScan {
  const raw = readFileSync(join(root, relPath), 'utf8')
  const document = parseDocument(raw, relPath)
  const identity = identityOf(document, relPath)
  const expectedPrefix = kind === 'authorIntent' ? 'aint_' : 'style_'
  if (!identity.mozhouId.startsWith(expectedPrefix)) {
    throw new CanonStructureError(relPath, `${kind} mozhouId must start with '${expectedPrefix}'`)
  }
  return { id: identity.mozhouId, kind, revision: identity.revision, contentSha256: sha256Hex(raw) }
}

/**
 * 全量扫描书目录为结构化状态。任何结构违例即抛错——调用方
 * （createBook 初始化 / rebuildProjectionFromCanon）宁败不脏。
 */
export function readCanonState(root: string): CanonState {
  const book = readBookRecord(root)

  const outlineNodes = [ZONGGANG_PATH, VOLUME_ONE_OUTLINE_PATH].map((relPath) => readOutlineNode(root, relPath))

  const planningArtifacts = [
    readPlanningArtifact(root, AUTHOR_INTENT_PATH, 'authorIntent'),
    readPlanningArtifact(root, STYLE_PROFILE_PATH, 'styleProfile'),
  ]

  const trackingLines = {} as Record<TrackingKind, TrackingLineScan[]>
  for (const stream of TRACKING_STREAMS) {
    const absolutePath = join(root, stream.path)
    if (!statSync(absolutePath).isFile()) {
      throw new CanonStructureError(stream.path, 'tracking stream file is missing')
    }
    const lines = readFileSync(absolutePath, 'utf8').split('\n')
    // 去掉末行空串：jsonl 以换行结尾是格式纪律，不产生幽灵空行实体
    if (lines.at(-1) === '') {
      lines.pop()
    }
    trackingLines[stream.kind] = lines.map((payload, seq) => ({
      seq,
      lineSha256: sha256Hex(payload),
      payload,
    }))
  }

  return { book, outlineNodes, planningArtifacts, trackingLines, entityCards: scanEntityCards(root) }
}

/* ----------------------------------------------------------------------------
 * 书库扫描（书架读面）：父目录下含 book.json 的子目录 = 一本书。
 * 纯只读、逐书容错（坏 book.json 的书跳过并计数，不整体失败）。
 * ------------------------------------------------------------------------- */

export interface LibraryBook {
  readonly root: string
  readonly book: BookRecord
  /** 正文章数（扫描 正文/ 下按序探测章文件；缺目录 = 0）。 */
  readonly chapterCount: number
}

export interface LibraryScan {
  readonly books: readonly LibraryBook[]
  /** 目录下存在但 book.json 不可读（坏/缺）的子目录数——显式呈现，不静默。 */
  readonly skipped: number
}

/** 扫描父目录下所有含 book.json 的子目录为书库（按书名排序）。 */
export function scanLibrary(parentDir: string): LibraryScan {
  if (!existsSync(parentDir)) {
    return { books: [], skipped: 0 }
  }
  const books: LibraryBook[] = []
  let skipped = 0
  for (const name of readdirSync(parentDir).sort()) {
    const root = join(parentDir, name)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(root)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    if (!existsSync(join(root, BOOK_RECORD_PATH))) continue
    try {
      const book = readBookRecord(root)
      books.push({ root, book, chapterCount: countChapters(root) })
    } catch {
      skipped += 1
    }
  }
  return {
    books: books.sort((a, b) =>
      a.book.title < b.book.title ? -1 : a.book.title > b.book.title ? 1 : 0,
    ),
    skipped,
  }
}

/** 正文章数：逐章探测 proseChapterPath（章序连续，缺章即止）。 */
function countChapters(root: string): number {
  let count = 0
  for (let index = 1; ; index += 1) {
    if (!existsSync(join(root, proseChapterPath(index)))) break
    count += 1
  }
  return count
}
