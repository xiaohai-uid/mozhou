/**
 * pins 窗内缓存 + findReaders 单缝（T26 · #67；D01-c/D03/D04）。
 *
 * D01-c 混合窗内缓存：readChapterDependencyPins 每次全量扫 events.jsonl（O(账本行数)），
 * 传播频次高于提交频次时重复回读是纯浪费。本模块提供增量缓存：首次全扫建窗，
 * 之后只按新增行增量合并；findReaders(pins, entry) 是『谁在读某实体』的唯一查询缝——
 * 未来全量倒排（D01-a）只换本函数实现，不动调用方。
 *
 * D03 幂等短路：传播写面前读回既有 StaleMarker 与计算值逐字段全等即跳过写
 * （revision 不动、原子替换不触发）——『同标记再传=零写』。
 *
 * D04 预算：账本 ≤BUDGET_LEDGER_LINES、pin ≤BUDGET_PIN_COUNT、单次传播 ≤BUDGET_MS；
 * 超限抛 StaleBudgetError（调用方降级后台队列+打点，失败显式不静默）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDependencyManifest } from '@mozhou/kernel'
import { RUNTIME_EVENTS_PATH } from './layout.js'
import type { DependencyManifest, DependencyManifestEntry } from '@mozhou/kernel'

/** D04 预算定案值（t65 D04 终裁）。 */
export const BUDGET_LEDGER_LINES = 20_000
export const BUDGET_PIN_COUNT = 2_000
export const BUDGET_PROPAGATION_MS = 100

export class StaleBudgetError extends Error {
  override readonly name = 'StaleBudgetError'
}

/* ----------------------------------------------------------------------------
 * 事件账本回读：各章当前生效的依赖钉版（同章后到提交者胜）
 * -------------------------------------------------------------------------- */

export interface ChapterDependencyPin {
  readonly chapterIndex: number
  readonly commitId: string
  readonly manifest: DependencyManifest
}

function jsonlLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 扫描 `.mozhou/events.jsonl`，按章取最后一次 ChapterCommitted 的依赖钉版。
 * - 后到提交不带 dependencyManifest ⇒ 该章退出映射（旧钉版随新提交作废）；
 * - 撕裂 JSON 行（崩溃窗口产物）跳过——审计账本不是真源；
 * - 已解析但形状非法的钉版宁败不脏（影响分析不容错）。
 */
export function readChapterDependencyPins(root: string): ReadonlyMap<number, ChapterDependencyPin> {
  const pins = new Map<number, ChapterDependencyPin>()
  const eventsPath = join(root, RUNTIME_EVENTS_PATH)
  if (!existsSync(eventsPath)) {
    return pins
  }
  for (const line of jsonlLines(readFileSync(eventsPath, 'utf8'))) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(row) || row['type'] !== 'ChapterCommitted') {
      continue
    }
    const chapterIndex = row['chapterIndex']
    const commitId = row['commitId']
    if (typeof chapterIndex !== 'number' || !Number.isSafeInteger(chapterIndex) || chapterIndex < 1) {
      continue
    }
    if (typeof commitId !== 'string') {
      continue
    }
    const rawManifest = row['dependencyManifest']
    if (rawManifest === undefined || rawManifest === null) {
      pins.delete(chapterIndex)
      continue
    }
    const entries = isRecord(rawManifest) ? rawManifest['entries'] : undefined
    pins.set(chapterIndex, { chapterIndex, commitId, manifest: parseDependencyManifest(entries) })
  }
  return pins
}

/** 窗：pins 快照 + 上次读到的账本行尾（增量续读的下标）。 */
export interface PinsWindow {
  readonly pins: ReadonlyMap<number, ChapterDependencyPin>
  readonly ledgerLinesRead: number
}

function jsonlLineCount(content: string): number {
  if (content.length === 0) return 0
  return content.split('\n').filter((line) => line.length > 0).length
}

/** 预算护栏：账本行数与 pin 数硬上限，超限抛错（失败显式）。 */
export function assertWithinBudget(root: string, pins: ReadonlyMap<number, ChapterDependencyPin>): void {
  const eventsPath = join(root, RUNTIME_EVENTS_PATH)
  const lines = existsSync(eventsPath) ? jsonlLineCount(readFileSync(eventsPath, 'utf8')) : 0
  if (lines > BUDGET_LEDGER_LINES) {
    throw new StaleBudgetError('ledger exceeds budget: ' + lines + ' > ' + BUDGET_LEDGER_LINES)
  }
  if (pins.size > BUDGET_PIN_COUNT) {
    throw new StaleBudgetError('pin count exceeds budget: ' + pins.size + ' > ' + BUDGET_PIN_COUNT)
  }
}

/** 全量建窗（冷启动）：整扫账本。 */
export function openPinsWindow(root: string): PinsWindow {
  const pins = readChapterDependencyPins(root)
  assertWithinBudget(root, pins)
  const eventsPath = join(root, RUNTIME_EVENTS_PATH)
  const ledgerLinesRead = existsSync(eventsPath) ? jsonlLineCount(readFileSync(eventsPath, 'utf8')) : 0
  return { pins, ledgerLinesRead }
}

/**
 * 增量续读：账本新增行在窗内重扫（只扫新增段，O(新增行数)）。
 * 与 T3 顺手修的 readStoredLines 双格式容读同源——只认 ChapterCommitted 平铺行。
 */
export function refreshPinsWindow(root: string, window: PinsWindow): PinsWindow {
  const eventsPath = join(root, RUNTIME_EVENTS_PATH)
  if (!existsSync(eventsPath)) return window
  const content = readFileSync(eventsPath, 'utf8')
  const lines = jsonlLineCount(content)
  if (lines <= window.ledgerLinesRead) return window // 无新增或回退（外部重写）——沿用窗

  const pins = new Map(window.pins)
  const allLines = content.split('\n').filter((line) => line.length > 0)
  for (let i = window.ledgerLinesRead; i < allLines.length; i += 1) {
    const line = allLines[i]
    if (line === undefined) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof row !== 'object' || row === null || !('type' in row)) continue
    const rec = row as Record<string, unknown>
    if (rec['type'] !== 'ChapterCommitted') continue
    const chapterIndex = rec['chapterIndex']
    const commitId = rec['commitId']
    if (typeof chapterIndex !== 'number' || !Number.isSafeInteger(chapterIndex) || chapterIndex < 1) continue
    if (typeof commitId !== 'string') continue
    const rawManifest = rec['dependencyManifest']
    if (rawManifest === undefined || rawManifest === null) {
      pins.delete(chapterIndex)
      continue
    }
    const entries = typeof rawManifest === 'object' && rawManifest !== null && 'entries' in rawManifest
      ? (rawManifest as Record<string, unknown>)['entries']
      : undefined
    if (entries === undefined) continue
    pins.set(chapterIndex, {
      chapterIndex,
      commitId,
      manifest: parseDependencyManifestLenient(entries),
    })
  }
  assertWithinBudget(root, pins)
  return { pins, ledgerLinesRead: allLines.length }
}

function parseDependencyManifestLenient(entries: unknown): DependencyManifest {
  return parseDependencyManifest(entries)
}

/**
 * findReaders 单缝（D01-c）：返回依赖某 (kind,id,revision 不敏感) 实体的全部
 * 章序（升序去重）——正版语义 = 钉版 manifest.entries 中 kind+id 匹配即『读者』。
 * 未来全量倒排只换本函数实现，signature 不动。
 */
export function findReaders(pins: ReadonlyMap<number, ChapterDependencyPin>, entry: DependencyManifestEntry): readonly number[] {
  const readers: number[] = []
  for (const pin of pins.values()) {
    const hits = pin.manifest.entries.some((e) => e.kind === entry.kind && e.id === entry.id)
    if (hits) readers.push(pin.chapterIndex)
  }
  return readers.sort((a, b) => a - b)
}

/**
 * 幂等短路判据（D03）：目标章大纲既有标记与计算值逐字段全等 ⇒ true（零写）。
 * 全等定义：reason / markedAt / upstreamRefs（长度+逐项 kind+id+revision）全相等。
 */
export function staleMarkerEquivalent(existing: unknown, computed: unknown): boolean {
  if (typeof existing !== 'object' || existing === null || typeof computed !== 'object' || computed === null) return false
  const a = existing as Record<string, unknown>
  const b = computed as Record<string, unknown>
  if (a['reason'] !== b['reason']) return false
  if (a['markedAt'] !== b['markedAt']) return false
  const refsA = a['upstreamRefs']
  const refsB = b['upstreamRefs']
  if (!Array.isArray(refsA) || !Array.isArray(refsB) || refsA.length !== refsB.length) return false
  for (let i = 0; i < refsA.length; i += 1) {
    const ra = refsA[i] as Record<string, unknown>
    const rb = refsB[i] as Record<string, unknown>
    if (ra['kind'] !== rb['kind'] || ra['id'] !== rb['id'] || ra['revision'] !== rb['revision']) return false
  }
  return true
}
