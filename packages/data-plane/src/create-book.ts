/**
 * createBook 一键建书（实现票 #15 / T1）：
 * 目录树 v2 全套 canon 落盘 → `.mozhou/manifest.json` hash 基线登记
 * → SQLite 投影初始化并写入 PROJECTION_SCHEMA_VERSION。
 * 演示 = 磁盘出现一本结构完整的书。
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  newAuthorIntentId,
  newBookId,
  newBookNodeId,
  newStyleProfileId,
  newVolumeNodeId,
  type BookRecord,
} from '@mozhou/kernel'
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

export interface InitialAuthorIntentInput {
  readonly worldRule?: string
  readonly volumePromise?: string
  readonly opening?: string
  readonly firstChapterGoal?: string
}

export function renderAuthorIntentBody(intent?: InitialAuthorIntentInput): string {
  const parts = [
    '# 作者意图\n\n> 宪法层：本文件整体受保护（protectedUserContent=true），自动化通道不得改写。\n',
  ]
  if (intent?.worldRule) {
    parts.push(`## 世界观核心规则\n\n${intent.worldRule.trim()}\n`)
  }
  if (intent?.volumePromise) {
    parts.push(`## 卷级核心承诺\n\n${intent.volumePromise.trim()}\n`)
  }
  if (intent?.opening) {
    parts.push(`## 开场切入画面\n\n${intent.opening.trim()}\n`)
  }
  if (intent?.firstChapterGoal) {
    parts.push(`## 首章核心目标\n\n${intent.firstChapterGoal.trim()}\n`)
  }
  parts.push('## 核心爽点\n\n-\n\n## 主角欲望\n\n\n## 绝对禁区\n\n-\n\n## 目标结局\n\n\n## 基调偏好\n')
  return parts.join('\n')
}

export interface CreateBookOptions {
  /** 书目录（一书一目录：打开目录 = 打开一本书）。 */
  readonly dir: string
  /** 书名，落 book.json；文件名只是皮。 */
  readonly title: string
  /** 初始作者意图设定（T05）。 */
  readonly authorIntent?: InitialAuthorIntentInput | undefined
}

export interface CreateBookResult {
  readonly root: string
  readonly book: BookRecord
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
  writeFileSync(join(root, BOOK_RECORD_PATH), `${JSON.stringify(book, null, 2)}\n`)

  // 大纲两层种子：总纲（BookNode 根）+ 第一卷（VolumeNode）
  const bookNodeId = newBookNodeId()
  const volumeNodeId = newVolumeNodeId()
  const volumePromiseText = options.authorIntent?.volumePromise
    ? `## 卷级承诺\n\n${options.authorIntent.volumePromise.trim()}\n\n`
    : ''
  writeFileSync(
    join(root, ZONGGANG_PATH),
    `${emitFrontmatter(outlineFrontmatter({ mozhouId: bookNodeId, nodeType: 'book', parentId: null }))}# ${title}\n\n> 全书主线总纲。层级：卷 → 幕（大纲/章节/）→ 场景（章大纲文件的 scenes 数组）。\n`,
  )
  writeFileSync(
    join(root, VOLUME_ONE_OUTLINE_PATH),
    `${emitFrontmatter(
      outlineFrontmatter({ mozhouId: volumeNodeId, nodeType: 'volume', parentId: bookNodeId }),
    )}# ${VOLUME_ONE_TITLE}\n\n${volumePromiseText}- 目标：\n- 冲突：\n- 高潮：\n- 结局：\n`,
  )

  // 宪法层与风格档案种子
  writeFileSync(
    join(root, AUTHOR_INTENT_PATH),
    `${emitFrontmatter(planningFrontmatter(newAuthorIntentId(), 'authorIntent'))}${renderAuthorIntentBody(options.authorIntent)}`,
  )
  writeFileSync(
    join(root, STYLE_PROFILE_PATH),
    `${emitFrontmatter(planningFrontmatter(newStyleProfileId(), 'styleProfile'))}# 文风画像\n\n> StyleProfile × scenarioType（action / dialogue / romance_emotion / exposition_worldbuilding）；EMA 平滑结果算完即落盘，初始为空表。\n\n${emitStyleProfilesYaml(seedStyleProfileRows())}`,
  )
  writeFileSync(
    join(root, MARKET_BRIEF_PATH),
    '# Market Brief\n\n> 市场/ 区资料永不进入生成 prompt（Research 硬隔离）；benchmarks/ 存对标数据。\n',
  )

  // 追踪五族空流 + 运行时区事件账本（纯审计，不承担恢复）
  for (const stream of TRACKING_STREAMS) {
    writeFileSync(join(root, stream.path), '')
  }
  writeFileSync(join(root, RUNTIME_EVENTS_PATH), '')

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
