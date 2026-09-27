/**
 * createBook 一键建书（实现票 #15 / T1）：
 * 目录树 v2 全套 canon 落盘 → `.mozhou/manifest.json` hash 基线登记
 * → SQLite 投影初始化并写入 PROJECTION_SCHEMA_VERSION。
 * 演示 = 磁盘出现一本结构完整的书。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  newAuthorIntentId,
  newBookId,
  newBookNodeId,
  newStyleProfileId,
  newVolumeNodeId,
  type BookRecord,
} from '@mozhou/kernel'
import { atomicWriteFileSync } from './atomic-write.js'
import { openDatabase } from './database.js'
import {
  AUTHOR_INTENT_PATH,
  BOOK_RECORD_PATH,
  MARKET_BRIEF_PATH,
  RUNTIME_DB_PATH,
  RUNTIME_EVENTS_PATH,
  STYLE_PROFILE_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
  VOLUME_ONE_TITLE,
  ZONGGANG_PATH,
  bookDirectoryPaths,
} from './layout.js'
import { buildManifest, writeManifest } from './manifest.js'
import { emitStyleProfilesYaml, seedStyleProfileRows } from './style-profiles.js'
import { populateProjection, initProjection } from './projection.js'
import { readCanonState } from './canon-read.js'
import { emitFrontmatter, type FrontmatterFieldValue } from './yaml-frontmatter.js'

export class BookDirectoryNotEmptyError extends Error {
  override readonly name = 'BookDirectoryNotEmptyError'

  constructor(readonly dir: string) {
    super(`book directory exists and is not empty: ${dir}`)
  }
}

export interface CreateBookOptions {
  /** 书目录（一书一目录：打开目录 = 打开一本书）。 */
  readonly dir: string
  /** 书名，落 book.json；文件名只是皮。 */
  readonly title: string
}

export interface CreateBookResult {
  readonly root: string
  readonly book: BookRecord
}

export interface WizardAuthorIntentInput {
  readonly worldRule: string
  readonly volumePromise: string
  readonly opening: string
  readonly firstChapterGoal: string
}

export class AuthorIntentAlreadyInitializedError extends Error {
  override readonly name = 'AuthorIntentAlreadyInitializedError'

  constructor(readonly path: string) {
    super(`author intent already contains first-book inputs: ${path}`)
  }
}

function markdownValue(value: string): string {
  return value.trim().replace(/\r\n?/g, '\n')
}

/** 首次建书输入的段落锚（写入与回读共用；改一处即两处同步）。 */
const WIZARD_SECTION_MARKER = '\n## 首次建书输入\n'
/** 空字段的落盘占位；回读时还原为空串（编码/解码同源，保证同输入可判等）。 */
const WIZARD_EMPTY_PLACEHOLDER = '（未填写）'
const WIZARD_FIELDS = [
  { key: 'worldRule', heading: '世界规则' },
  { key: 'volumePromise', heading: '卷级承诺' },
  { key: 'opening', heading: '开场画面' },
  { key: 'firstChapterGoal', heading: '首章目标' },
] as const

function encodeWizardField(value: string): string {
  return markdownValue(value) || WIZARD_EMPTY_PLACEHOLDER
}

/**
 * 把首次建书向导的作者输入写入受保护的 Author Intent。
 * 仅允许从空模板初始化一次；重放向导不会覆盖作者后来手工修改的内容。
 * @returns 写入后的 Author Intent revision（frontmatter 现值 + 1）。
 */
export function writeWizardAuthorIntent(root: string, input: WizardAuthorIntentInput): number {
  const path = join(root, AUTHOR_INTENT_PATH)
  const raw = readFileSync(path, 'utf8')
  if (raw.includes(WIZARD_SECTION_MARKER)) {
    throw new AuthorIntentAlreadyInitializedError(path)
  }

  const revision = /^revision:\s*(\d+)$/m.exec(raw)
  const nextRevision = revision === null ? 1 : Number(revision[1]) + 1
  const body = [
    '',
    '## 首次建书输入',
    '',
    ...WIZARD_FIELDS.flatMap((field) => [`### ${field.heading}`, encodeWizardField(input[field.key]), '']),
  ].join('\n')
  const next = raw.replace(/^revision:\s*\d+$/m, `revision: ${nextRevision}`).trimEnd() + '\n' + body
  atomicWriteFileSync(path, next)
  return nextRevision
}

/**
 * 回读首次建书输入（响应丢失后的重试判等依据）。
 * 段落缺席或形状非法一律返回 null——宁可报冲突，也不把「读不出来」当成「已保存成功」。
 */
export function readWizardAuthorIntent(root: string): WizardAuthorIntentInput | null {
  const raw = readFileSync(join(root, AUTHOR_INTENT_PATH), 'utf8')
  const start = raw.indexOf(WIZARD_SECTION_MARKER)
  if (start < 0) return null
  const blocks = raw.slice(start + WIZARD_SECTION_MARKER.length).split('\n### ')
  const values: Record<string, string> = {}
  for (const [index, field] of WIZARD_FIELDS.entries()) {
    const block = blocks[index + 1]
    if (block === undefined) return null
    const newline = block.indexOf('\n')
    if (newline < 0 || block.slice(0, newline).trim() !== field.heading) return null
    const value = block.slice(newline + 1).trim()
    values[field.key] = value === WIZARD_EMPTY_PLACEHOLDER ? '' : value
  }
  return {
    worldRule: values['worldRule'] ?? '',
    volumePromise: values['volumePromise'] ?? '',
    opening: values['opening'] ?? '',
    firstChapterGoal: values['firstChapterGoal'] ?? '',
  }
}

/**
 * 两份向导输入是否等价（与落盘同一套规范化：trim + CRLF 归一，空值 ↔ 占位符同值）。
 * 只有等价才允许把「已存在」判为幂等成功；任意不同输入必须走冲突。
 */
export function wizardAuthorIntentEquals(a: WizardAuthorIntentInput, b: WizardAuthorIntentInput): boolean {
  return WIZARD_FIELDS.every((field) => encodeWizardField(a[field.key]) === encodeWizardField(b[field.key]))
}

/** 大纲节点 frontmatter（Q13 冻结字段集；orderIndex 为同父下序，0 起）。 */
function outlineFrontmatter(fields: {
  mozhouId: string
  nodeType: 'book' | 'volume'
  parentId: string | null
}): Record<string, FrontmatterFieldValue> {
  return {
    mozhouId: fields.mozhouId,
    nodeType: fields.nodeType,
    parentId: fields.parentId,
    orderIndex: 0,
    revision: 0,
    status: 'drafted',
    originAuthor: true,
    protected: true,
  }
}

/**
 * 规划工件 frontmatter（作者意图/文风；Q13 字段集 kind 位 + 宪法层整体受保护 I1）。
 * 与 Q13 冻结字段集的两处显式取舍：
 *   1. parentId/orderIndex/status 是大纲图概念，作者意图与文风非大纲节点
 *      （Q13 的 `nodeType/kind` 斜杠写法即「按工件类型取用」），故不发射；
 *   2. 文风.md 不在 Q13 罗列范围内，但 StyleProfile 是内核实体、重建（S5）
 *      需要机器身份，故按同构字段组发射 kind + mozhouId + revision。
 */
function planningFrontmatter(
  mozhouId: string,
  kind: 'authorIntent' | 'styleProfile',
): Record<string, FrontmatterFieldValue> {
  return {
    mozhouId,
    kind,
    revision: 0,
    originAuthor: true,
    protected: true,
  }
}

export function createBook(options: CreateBookOptions): CreateBookResult {
  const root = options.dir
  const title = options.title.trim()
  if (title.length === 0) {
    throw new Error('book title must be non-empty')
  }
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new BookDirectoryNotEmptyError(root)
  }

  const now = new Date().toISOString()
  const book: BookRecord = {
    id: newBookId(),
    title,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }

  for (const dir of bookDirectoryPaths()) {
    mkdirSync(join(root, dir), { recursive: true })
  }

  // 容器：book.json
  atomicWriteFileSync(join(root, BOOK_RECORD_PATH), `${JSON.stringify(book, null, 2)}\n`)

  // 大纲两层种子：总纲（BookNode 根）+ 第一卷（VolumeNode）
  const bookNodeId = newBookNodeId()
  const volumeNodeId = newVolumeNodeId()
  atomicWriteFileSync(
    join(root, ZONGGANG_PATH),
    `${emitFrontmatter(outlineFrontmatter({ mozhouId: bookNodeId, nodeType: 'book', parentId: null }))}# ${title}\n\n> 全书主线总纲。层级：卷 → 幕（大纲/章节/）→ 场景（章大纲文件的 scenes 数组）。\n`,
  )
  atomicWriteFileSync(
    join(root, VOLUME_ONE_OUTLINE_PATH),
    `${emitFrontmatter(
      outlineFrontmatter({ mozhouId: volumeNodeId, nodeType: 'volume', parentId: bookNodeId }),
    )}# ${VOLUME_ONE_TITLE}\n\n- 目标：\n- 冲突：\n- 高潮：\n- 结局：\n`,
  )

  // 宪法层与风格档案种子
  atomicWriteFileSync(
    join(root, AUTHOR_INTENT_PATH),
    `${emitFrontmatter(planningFrontmatter(newAuthorIntentId(), 'authorIntent'))}# 作者意图\n\n> 宪法层：本文件整体受保护（protectedUserContent=true），自动化通道不得改写。\n\n## 核心爽点\n\n-\n\n## 主角欲望\n\n\n## 绝对禁区\n\n-\n\n## 目标结局\n\n\n## 基调偏好\n`,
  )
  atomicWriteFileSync(
    join(root, STYLE_PROFILE_PATH),
    `${emitFrontmatter(planningFrontmatter(newStyleProfileId(), 'styleProfile'))}# 文风画像\n\n> StyleProfile × scenarioType（action / dialogue / romance_emotion / exposition_worldbuilding）；EMA 平滑结果算完即落盘，初始为空表。\n\n${emitStyleProfilesYaml(seedStyleProfileRows())}`,
  )
  atomicWriteFileSync(
    join(root, MARKET_BRIEF_PATH),
    '# Market Brief\n\n> 市场/ 区资料永不进入生成 prompt（Research 硬隔离）；benchmarks/ 存对标数据。\n',
  )

  // 追踪五族空流 + 运行时区事件账本（纯审计，不承担恢复）
  for (const stream of TRACKING_STREAMS) {
    atomicWriteFileSync(join(root, stream.path), '')
  }
  atomicWriteFileSync(join(root, RUNTIME_EVENTS_PATH), '')

  // hash 基线最后登记（此刻全部初始 canon 文件已就位）
  writeManifest(root, buildManifest(root, book.id))

  // SQLite 投影初始化：从刚落盘的 canon 扫描灌入——建书路径与重建路径共用同一扫描器
  const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
  try {
    initProjection(db)
    populateProjection(db, readCanonState(root))
  } finally {
    db.close()
  }

  return { root, book }
}
