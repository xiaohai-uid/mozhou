/**
 * 书籍目录树 v2 冻结布局（工单 #6 Q6/Q7 冻结 + 工单 #13 五目细化）。
 * 本模块是布局的唯一实现侧真源：createBook 落盘、测试对照、重建扫描共用。
 * 路径一律 POSIX 相对路径（书根为基准），Windows 下写入时经 node:path join 归一。
 */

/** 运行时区：非正典、不参与对账（Q14/Q15）。 */
export const RUNTIME_DIR = '.mozhou'
export const MANIFEST_PATH = `${RUNTIME_DIR}/manifest.json`
export const RUNTIME_DB_PATH = `${RUNTIME_DIR}/runtime.sqlite`
export const RUNTIME_EVENTS_PATH = `${RUNTIME_DIR}/events.jsonl`

export const BOOK_RECORD_PATH = 'book.json'

/**
 * 追踪五族 jsonl（叙事状态层真源）。kind 取 kernel 的 EntityKind 命名，
 * 与投影 tracking_lines.kind 一致；文件名冻结于目录树 v2。
 */
export const TRACKING_STREAMS = [
  { kind: 'temporalFact', path: '追踪/事实.jsonl' },
  { kind: 'knowledgeState', path: '追踪/认知.jsonl' },
  { kind: 'relationshipState', path: '追踪/关系.jsonl' },
  { kind: 'narrativePromise', path: '追踪/伏笔.jsonl' },
  { kind: 'timelineEvent', path: '追踪/时间线.jsonl' },
] as const

export type TrackingKind = (typeof TRACKING_STREAMS)[number]['kind']

/** 设定/ 五子目录对齐 EntityRef 五前缀（entity-directory-spec Q7：char/item/location/faction/concept）。 */
export const ENTITY_CARD_DIRS = ['设定/人物', '设定/物品', '设定/地点', '设定/势力', '设定/概念'] as const

/** EntityRef 前缀 ↔ 目录卡子目录的一一映射（spec Q7；扫描与建卡共用）。 */
export const ENTITY_CARD_DIR_BY_PREFIX = {
  char: '设定/人物',
  item: '设定/物品',
  location: '设定/地点',
  faction: '设定/势力',
  concept: '设定/概念',
} as const

export type EntityRefPrefix = keyof typeof ENTITY_CARD_DIR_BY_PREFIX

/** Research 参考区（市场/）：条目永不进入生成 prompt、永不成为候选（#14 US17 硬隔离）。 */
export const RESEARCH_DIRS = ['市场'] as const

/** Research 区判定：这些目录下的文件不得被任何候选来源吸收。 */
export function isResearchRelPath(relPosixPath: string): boolean {
  return RESEARCH_DIRS.some((dir) => relPosixPath === dir || relPosixPath.startsWith(`${dir}/`))
}

export const OUTLINE_DIR = '大纲'
export const CHAPTER_OUTLINE_DIR = '大纲/章节'
export const TRACKING_DIR = '追踪'
export const ZONGGANG_PATH = '大纲/总纲.md'
export const VOLUME_ONE_TITLE = '第一卷'
export const VOLUME_ONE_OUTLINE_PATH = '大纲/第一卷.md'
export const PROSE_DIR = '正文'
/** 种子卷的正文目录与卷标题耦合（目录树 v2 示例形态）；多卷泛化归后续票。 */
export const VOLUME_ONE_PROSE_DIR = `${PROSE_DIR}/${VOLUME_ONE_TITLE}`
export const AUTHOR_INTENT_PATH = '设定/作者意图.md'
export const STYLE_PROFILE_PATH = '文风.md'
export const MARKET_BRIEF_PATH = '市场/market-brief.md'

/** 崩溃恢复日志（T3）：提交意图 + 各目标文件基线偏移与待写载荷。运行时区，非 canon。 */
export const PENDING_COMMIT_PATH = `${RUNTIME_DIR}/pending-commit.json`

const CHAPTER_INDEX_WIDTH = 4

function chapterFileStem(chapterIndex: number): string {
  if (!Number.isInteger(chapterIndex) || chapterIndex < 1) {
    throw new Error(`chapterIndex must be a positive integer, got ${chapterIndex}`)
  }
  return `第${String(chapterIndex).padStart(CHAPTER_INDEX_WIDTH, '0')}章`
}

/** 章大纲节点文件路径（规划态；Scene 挂其 YAML 数组）。 */
export function chapterOutlinePath(chapterIndex: number): string {
  return `${CHAPTER_OUTLINE_DIR}/${chapterFileStem(chapterIndex)}.md`
}

/** 正文章文件路径（相位机载体：draft 或 committed）。 */
export function proseChapterPath(chapterIndex: number): string {
  return `${VOLUME_ONE_PROSE_DIR}/${chapterFileStem(chapterIndex)}.md`
}

/** createBook 初始落盘的全部 canon 文件（相对书根，POSIX）。 */
export function canonSeedFilePaths(): string[] {
  return [
    BOOK_RECORD_PATH,
    ZONGGANG_PATH,
    VOLUME_ONE_OUTLINE_PATH,
    AUTHOR_INTENT_PATH,
    STYLE_PROFILE_PATH,
    MARKET_BRIEF_PATH,
    ...TRACKING_STREAMS.map((stream) => stream.path),
  ]
}

/** createBook 需要存在的全部目录（含运行时区子目录；空目录也是结构的一部分）。 */
export function bookDirectoryPaths(): string[] {
  return [
    PROSE_DIR,
    VOLUME_ONE_PROSE_DIR,
    OUTLINE_DIR,
    CHAPTER_OUTLINE_DIR,
    '设定',
    ...ENTITY_CARD_DIRS,
    TRACKING_DIR,
    '摘要',
    '市场',
    '市场/benchmarks',
    RUNTIME_DIR,
    `${RUNTIME_DIR}/receipts`,
    `${RUNTIME_DIR}/snapshots`,
    `${RUNTIME_DIR}/indexes`,
    `${RUNTIME_DIR}/embeddings`,
  ]
}

/** 运行时区之外的路径才是 canon（S4/S5 的扫描边界）。 */
export function isCanonRelPath(relPosixPath: string): boolean {
  return relPosixPath !== RUNTIME_DIR && !relPosixPath.startsWith(`${RUNTIME_DIR}/`)
}
