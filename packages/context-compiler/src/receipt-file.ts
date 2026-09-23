/**
 * Receipt 一证一文件（实现票 #25 / T9）。
 *
 * 冻结依据：docs/specs/context-receipt-physical-format-spec.md（#9 收敛定案）·
 * ADR-0021 · INV-R1~R6。
 *
 * 职责边界：
 *   - 物理存储形态：`{书根}/.mozhou/receipts/rcpt_<ULID>.json`，UTF-8、稳定键序 +
 *     缩进美化的 JSON（人可直接打开读）；一证一文件，ULID 文件名字典序 = 时间序；
 *   - 不可变（INV-R2 / I5）：已落盘 receipt 永不改写——重复写同 id 即抛错，
 *     修正 = 新 ULID 新证；
 *   - EventLedger 关系（ADR-0021 §2）：事件只持指针摘要不内联 receipt 体；
 *   - 崩溃一致序（INV-R1）：先写 receipt 文件后追加事件行；中间崩溃只产生合法的
 *     孤儿 receipt，反向悬空指针非法（校验器报错）；
 *   - 哈希与排版解耦（INV-R3）：recomputationHash/inputsDigest 走 canonicalJson
 *     （装配函数内部），磁盘文件为稳定键序美化排版，两者互不影响。
 *
 * SQLite 投影索引（spec §2）本票不落——文件即真源，扫描目录可 100% 重建（INV-R4），
 * 索引随查询面票据再补。GenerationStarted.receiptId 链路闭合归生成侧票据。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContextReceipt, ContextReceiptId } from '@mozhou/kernel'

/* ----------------------------------------------------------------------------
 * 冻结布局常量（目录树 v2；与 @mozhou/data-plane layout.ts 镜像——包边界解耦，
 * 不引入跨包依赖；值冻结于工单 #6 Q6/Q7，两侧同步漂移即实现 bug）
 * -------------------------------------------------------------------------- */

const RUNTIME_DIR = '.mozhou'
const RECEIPTS_SUBDIR = 'receipts'
const EVENTS_FILENAME = 'events.jsonl'

export const RECEIPTS_DIRNAME = `${RUNTIME_DIR}/${RECEIPTS_SUBDIR}`
export const RUNTIME_EVENTS_RELPATH = `${RUNTIME_DIR}/${EVENTS_FILENAME}`

/** receipt 文件名合法性守卫（防路径穿越；id 由品牌类型约束，运行时仍复核前缀）。 */
const RECEIPT_ID_PATTERN = /^rcpt_[0-9A-Za-z]+$/

/* ----------------------------------------------------------------------------
 * 错误模式（fail loudly，禁止降级静默）
 * -------------------------------------------------------------------------- */

/** INV-R2：不可变违例——目标凭证已存在，绝不改写；修正应铸新 ULID。 */
export class ReceiptAlreadyExistsError extends Error {
  constructor(receiptId: string, path: string) {
    super(`receipt already exists (immutable per INV-R2): ${receiptId} at ${path}`)
    this.name = 'ReceiptAlreadyExistsError'
  }
}

/** INV-R1：悬空指针——events 引用了流中不存在的 receiptId，审计链断裂。 */
export class DanglingReceiptPointerError extends Error {
  constructor(receiptId: string, eventSeq: number) {
    super(`dangling receipt pointer: event seq=${eventSeq} references missing receipt ${receiptId}`)
    this.name = 'DanglingReceiptPointerError'
  }
}

/** 凭证缺失或形态损坏（读路径显式失败）。 */
export class ReceiptNotFoundError extends Error {
  constructor(receiptId: string, path: string) {
    super(`receipt not found: ${receiptId} at ${path}`)
    this.name = 'ReceiptNotFoundError'
  }
}

/* ----------------------------------------------------------------------------
 * 序列化（稳定键序 + 缩进美化；INV-R3 排版位）
 * -------------------------------------------------------------------------- */

/** 深度键字典序重排（undefined 值剔除，与 canonicalJson 同纪律），保证序列化
 *  与对象构造时的键插入序无关——字节级一致性的根基。 */
function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys)
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([k, v]) => [k, deepSortKeys(v)]))
  }
  return value
}

/**
 * Receipt 文件文本：稳定键序 + 2 空格缩进美化 JSON + 结尾换行。
 * 同一 receipt 对象恒产出逐字节相同文本（AC1「可复算/diff 硬断言」的序列化位）。
 */
export function serializeReceiptFile(receipt: ContextReceipt): string {
  return `${JSON.stringify(deepSortKeys(receipt), null, 2)}\n`
}

/* ----------------------------------------------------------------------------
 * 指针事件（ADR-0021 §2：EventLedger 只持指针摘要）
 * -------------------------------------------------------------------------- */

interface ContextCompiledPointerEvent {
  readonly type: 'ContextCompiled'
  readonly seq: number
  readonly at: string
  readonly receiptId: ContextReceiptId
  readonly taskType: ContextReceipt['taskType']
  readonly chapterIndex?: number
  readonly recomputationHash: string
  readonly totalTokens: number
  readonly storyTextQuota: ContextReceipt['storyTextQuota']
  readonly entryCount: { readonly included: number; readonly excluded: number }
}

function buildPointerEvent(receipt: ContextReceipt, seq: number, at: string): ContextCompiledPointerEvent {
  let included = 0
  for (const entry of receipt.entries) {
    if (entry.included) {
      included += 1
    }
  }
  return {
    type: 'ContextCompiled',
    seq,
    at,
    receiptId: receipt.id,
    taskType: receipt.taskType,
    ...(receipt.chapterIndex === undefined ? {} : { chapterIndex: receipt.chapterIndex }),
    recomputationHash: receipt.recomputationHash,
    totalTokens: receipt.totalTokens,
    storyTextQuota: receipt.storyTextQuota,
    entryCount: { included, excluded: receipt.entries.length - included },
  }
}

function jsonlLineCount(content: string): number {
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines.length
}

/* ----------------------------------------------------------------------------
 * 存取 API（bookRoot 为唯一锚点；路径一律经 node:path join 归一）
 * -------------------------------------------------------------------------- */

export interface PersistReceiptOptions {
  /** 指针事件时间戳注入点（测试确定性用）；缺省取当前时钟。事件行不属于
   *  receipt 字节面，此处触时钟不违反装配纯函数纪律。 */
  readonly atIso?: string
}

export interface PersistedReceiptLocation {
  /** 落盘凭证的绝对路径。 */
  readonly receiptPath: string
  /** 本次追加的指针事件在 events.jsonl 中的 seq。 */
  readonly eventSeq: number
}

/**
 * 持久化一张已铸造的 Receipt（一证一文件）：
 *
 *   ① 原子写 `.mozhou/receipts/<id>.json`（同目录临时文件 + rename）
 *   ② 追加 `ContextCompiled` 指针事件到 `.mozhou/events.jsonl`
 *
 * 顺序即 INV-R1：中间崩溃只留孤儿 receipt（合法）；②失败时凭证已在盘上，
 * 重试须走新 ULID（不可变）或由上层幂等去重——本函数对已存在 id 一律抛错。
 */
export function persistReceipt(
  bookRoot: string,
  receipt: ContextReceipt,
  options: PersistReceiptOptions = {},
): PersistedReceiptLocation {
  if (!RECEIPT_ID_PATTERN.test(receipt.id)) {
    throw new Error(`invalid receipt id: "${receipt.id}"`)
  }
  const receiptsDir = join(bookRoot, RUNTIME_DIR, RECEIPTS_SUBDIR)
  const receiptPath = join(receiptsDir, `${receipt.id}.json`)
  if (existsSync(receiptPath)) {
    throw new ReceiptAlreadyExistsError(receipt.id, receiptPath)
  }
  mkdirSync(receiptsDir, { recursive: true })

  // ① 先写凭证文件（原子可见点 = rename）
  const staged = `${receiptPath}.mozhou-tmp`
  writeFileSync(staged, serializeReceiptFile(receipt), 'utf8')
  renameSync(staged, receiptPath)

  // ② 后追加指针事件（seq = 追加前行数，与 ChapterCommitted 同账本约定）
  const eventsPath = join(bookRoot, RUNTIME_DIR, EVENTS_FILENAME)
  const prior = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : ''
  const event = buildPointerEvent(receipt, jsonlLineCount(prior), options.atIso ?? new Date().toISOString())
  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8')

  return { receiptPath, eventSeq: event.seq }
}

/** 按 id 点查加载凭证（访问模式主径：单证加载 + 成对 diff，非顺序扫描）。 */
export function loadReceipt(bookRoot: string, receiptId: string): ContextReceipt {
  if (!RECEIPT_ID_PATTERN.test(receiptId)) {
    throw new Error(`invalid receipt id: "${receiptId}"`)
  }
  const path = join(bookRoot, RUNTIME_DIR, RECEIPTS_SUBDIR, `${receiptId}.json`)
  if (!existsSync(path)) {
    throw new ReceiptNotFoundError(receiptId, path)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as ContextReceipt
}

/** 全量凭证 id 清单（ULID 字典序 = 时间序；INV-R4 重建扫描共用同一遍历）。 */
export function listReceiptIds(bookRoot: string): ContextReceiptId[] {
  const receiptsDir = join(bookRoot, RUNTIME_DIR, RECEIPTS_SUBDIR)
  if (!existsSync(receiptsDir)) {
    return []
  }
  const names = readdirSync(receiptsDir)
  return names
    .filter((name) => name.endsWith('.json') && RECEIPT_ID_PATTERN.test(name.slice(0, -'.json'.length)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => name.slice(0, -'.json'.length) as ContextReceiptId)
}

/**
 * INV-R1 校验器：扫 events.jsonl 全部 ContextCompiled 行，凡引用了流中不存在
 * receiptId 的即抛 DanglingReceiptPointerError；孤儿 receipt 合法、不在此检查面。
 */
export function assertNoDanglingReceiptPointers(bookRoot: string): void {
  const eventsPath = join(bookRoot, RUNTIME_DIR, EVENTS_FILENAME)
  if (!existsSync(eventsPath)) {
    return
  }
  const content = readFileSync(eventsPath, 'utf8')
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  const receiptsDir = join(bookRoot, RUNTIME_DIR, RECEIPTS_SUBDIR)
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      return
    }
    const parsed = JSON.parse(line) as { type?: string; receiptId?: string; seq?: number }
    if (parsed.type !== 'ContextCompiled' || parsed.receiptId === undefined) {
      return
    }
    if (!existsSync(join(receiptsDir, `${parsed.receiptId}.json`))) {
      throw new DanglingReceiptPointerError(parsed.receiptId, parsed.seq ?? index)
    }
  })
}
