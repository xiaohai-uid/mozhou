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
