/**
 * canon 真源 → 结构化状态的确定性扫描层（S5：重建零 LLM、纯扫描）。
 * T1 只需要识别建书骨架的实体（BookRecord / 大纲两层节点 / 两个规划工件 /
 * 追踪五族原始行）；实体卡与章节相位解析归后续实现票，逐票扩此模块。
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BookRecord } from '@mozhou/kernel'
import {
  AUTHOR_INTENT_PATH,
  BOOK_RECORD_PATH,
  STYLE_PROFILE_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
  ZONGGANG_PATH,
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

export interface CanonState {
  readonly book: BookRecord
  readonly outlineNodes: readonly OutlineNodeScan[]
  readonly planningArtifacts: readonly PlanningArtifactScan[]
  readonly trackingLines: Readonly<Record<TrackingKind, readonly TrackingLineScan[]>>
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

function readOutlineNode(root: string, relPath: string): OutlineNodeScan {
  const raw = readFileSync(join(root, relPath), 'utf8')
  const document = parseDocument(raw, relPath)
  const identity = identityOf(document, relPath)

  const nodeType = requireScalar(document, 'nodeType', relPath)
  if (typeof nodeType !== 'string' || !OUTLINE_NODE_TYPES.includes(nodeType as (typeof OUTLINE_NODE_TYPES)[number])) {
    throw new CanonStructureError(relPath, `frontmatter nodeType invalid: ${String(nodeType)}`)
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

  return { book, outlineNodes, planningArtifacts, trackingLines }
}
