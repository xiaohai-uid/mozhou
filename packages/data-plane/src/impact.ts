/**
 * 变更影响编排（T27 · #68；t66 D25/E4 + t65 D02/D05）。
 *
 * 接线：数据面公共落定出口（T25 onSettled）或 CanonCommitted 事件行 → runTraversal：
 *   1. TraversalStarted（成对 head）→ 账本写行（确定性，taskRef 固定注入）；
 *   2. openPinsWindow（T26 窗内缓存）+ findReaders 圈定受影响章（D01-c 单缝）；
 *   3. impact 投影落盘（.mozhou/impact/impact_<ULID>.json，版本号字段 + tmp+rename
 *      原子写，借鉴 proposal-port 决策缓冲模板）；指纹=排序后受影响集哈希、剥离时间戳；
 *   4. TraversalFinished（成对 tail）→ 账本写行；悬挂 head 由投影合并机制标记。
 *
 * 预算：单次传播 ≤100ms（T26 StaleBudgetError 承载）；扫描 N=100 章/批（T25 预算）。
 * 纯机械、零 LLM；StaleMarker 停靠仍归 propagateStaleMarkers（T6，本模块只产出 impact 投影）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DependencyManifest, DependencyManifestEntry } from '@mozhou/kernel'
import { RUNTIME_EVENTS_PATH } from './layout.js'
import { openPinsWindow, findReaders, assertWithinBudget } from './stale-cache.js'
import type { PinsWindow } from './stale-cache.js'
import { readChapterDependencyPins } from './stale.js'

/** impact 投影目录（.mozhou 运行时区，与 usage.jsonl 同层，非 canon）。 */
export const IMPACT_DIR_RELPATH = '.mozhou/impact'

export interface ImpactRecord {
  /** 投影 schema 版本（重建契约；指纹不含时间戳）。 */
  readonly projectionVersion: 1
  /** 本次遍历的受控标识（{traversalId, taskRef} 固定注入保证确定性）。 */
  readonly traversalId: string
  readonly taskRef: string
  readonly trigger: { readonly source: 'reconciliation' | 'commit'; readonly ref: string }
  /** 受影响章（排序后逐项——findReaders 输出即升序）。 */
  readonly affectedChapters: readonly number[]
  /** 排序集合哈希（剥离时间戳与 ULID 随机分量；重建幂等指纹）。 */
  readonly affectedFingerprint: string
  readonly upstreamChanges: readonly DependencyManifestEntry[]
  /** 展示时间戳（审计可读），不进指纹。 */
  readonly recordedAt: string
}

export interface TraversalRequest {
  readonly root: string
  /** 固定注入（绕 engine 生成；零时钟确定性）。 */
  readonly taskRef: string
  readonly traversalId: string
  readonly trigger: { readonly source: 'reconciliation' | 'commit'; readonly ref: string }
  readonly upstreamChanges: readonly DependencyManifestEntry[]
  readonly recordedAt: string
  /** 可注入访达逻辑（测试覆盖单缝；缺省 = openPinsWindow 冷启动）。 */
  readonly window?: PinsWindow | undefined
}

export interface TraversalOutcome {
  readonly affectedChapters: readonly number[]
  readonly affectedFingerprint: string
  readonly impactRelPath: string
}

function jsonlAppend(root: string, row: Record<string, unknown>): void {
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  const eventsPath = join(root, RUNTIME_EVENTS_PATH)
  const line = JSON.stringify(row) + '\n'
  writeFileSync(eventsPath, line, { flag: 'a' })
}

function fingerprintOf(sortedChapters: readonly number[]): string {
  return createHash('sha256').update(sortedChapters.join(',')).digest('hex')
}

/** 最新上游版本表：逐条 (kind,id) 取 max revision 去重（同实体多版本只算一次）。 */
function dedupeLatest(changes: readonly DependencyManifestEntry[]): DependencyManifestEntry[] {
  const latest = new Map<string, DependencyManifestEntry>()
  for (const entry of changes) {
    const key = entry.kind + '|' + entry.id
    const existing = latest.get(key)
    if (existing === undefined || entry.revision > existing.revision) {
      latest.set(key, entry)
    }
  }
  return [...latest.values()]
}

/**
 * 遍历主入口：TraversalStarted → 圈定 → impact 投影 → TraversalFinished。
 * 每次遍历一实体的上游变更批次（批预算由调用方按 T25 scanBatchLimit 分批喂入）。
 */
export function runTraversal(request: TraversalRequest): TraversalOutcome {
  const { root, taskRef, traversalId, trigger } = request
  const latest = dedupeLatest(request.upstreamChanges)

  jsonlAppend(root, {
    type: 'TraversalStarted',
    taskRef,
    payload: { traversalId, trigger, changeCount: latest.length },
  })

  const window = request.window ?? openPinsWindow(root)
  assertWithinBudget(root, window.pins)
  const readers = new Set<number>()
  for (const entry of latest) {
    for (const chapter of findReaders(window.pins, entry)) readers.add(chapter)
  }
  const affectedChapters = [...readers].sort((a, b) => a - b)

  const fingerprint = fingerprintOf(affectedChapters)
  const record: ImpactRecord = {
    projectionVersion: 1,
    traversalId,
    taskRef,
    trigger,
    affectedChapters,
    affectedFingerprint: fingerprint,
    upstreamChanges: latest,
    recordedAt: request.recordedAt,
  }

  // 原子落盘：tmp + rename（借鉴 ledger 模板）
  const impactDir = join(root, IMPACT_DIR_RELPATH)
  mkdirSync(impactDir, { recursive: true })
  const relName = 'impact_' + traversalId + '.json'
  const absolute = join(impactDir, relName)
  const tmp = absolute + '.tmp'
  writeFileSync(tmp, JSON.stringify(record) + '\n')
  renameSync(tmp, absolute)

  jsonlAppend(root, {
    type: 'TraversalFinished',
    taskRef,
    payload: { traversalId, affectedChapters, affectedFingerprint: fingerprint, markedAt: request.recordedAt },
  })

  return { affectedChapters, affectedFingerprint: fingerprint, impactRelPath: IMPACT_DIR_RELPATH + '/' + relName }
}

/** 扫描 impact 投影目录（重建入口：可弃重建）。 */
export function listImpactRecords(root: string): readonly ImpactRecord[] {
  const dir = join(root, IMPACT_DIR_RELPATH)
  if (!existsSync(dir)) return []
  const records: ImpactRecord[] = []
  for (const name of readdirSorted(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ImpactRecord
      if (parsed.projectionVersion === 1) records.push({ ...parsed, affectedChapters: [...parsed.affectedChapters].sort((a, b) => a - b) })
    } catch {
      continue // 撕裂/损坏行跳过（审计派生面，重建可弃）
    }
  }
  return records.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

function readdirSorted(dir: string): string[] {
  return readdirSync(dir).sort()
}

/** 投影重建幂等：全量擦除后重放等价指纹集合（排序后内容集合哈希，vault 记忆 D1）。 */
export function rebuildFingerprintOf(records: readonly ImpactRecord[]): string {
  const contents = records
    .map((r) => r.traversalId + '|' + [...r.affectedChapters].join(',') + '|' + r.affectedFingerprint)
    .sort()
  return createHash('sha256').update(contents.join('\n')).digest('hex')
}

/* ----------------------------------------------------------------------------
 * 变更矩阵（实现票 T43 · #88）：变更矩阵读面投影。
 *
 * 行 = 一次 Traversal（上游变更 + stale 计数）；
 * 列 = 受影响章 union（矩阵头部）；
 * 单元格三态（纯机械，零 LLM）：
 *   - needs_rework（红）：章仍依赖上游变更的旧版本（或从未重新提交）——需重写；
 *   - resolved（绿）：章最新提交钉版已含上游新版本——漂移已消解；
 *   - not_affected（—）：章不在该 traversal 的 affectedChapters。
 *
 * 真源 = listImpactRecords（impact 投影）+ readChapterDependencyPins
 * （事件账本最新 ChapterCommitted 钉版）；stale 标记（章大纲 frontmatter）是
 * 传播通道的落盘面，矩阵以钉版为消解判据（作者重新提交即消解，不依赖清除动作）。
 * ------------------------------------------------------------------------- */

export type ChangeMatrixCellState = 'needs_rework' | 'resolved' | 'not_affected'

export interface ChangeMatrixCell {
  readonly chapterIndex: number
  readonly state: ChangeMatrixCellState
}

export interface ChangeMatrixRow {
  readonly traversalId: string
  readonly taskRef: string
  readonly trigger: { readonly source: ImpactRecord['trigger']['source']; readonly ref: string }
  readonly upstreamChanges: readonly DependencyManifestEntry[]
  readonly recordedAt: string
  /** 仍待重写的受影响章数（needs_rework 计数；stale 计数）。 */
  readonly staleCount: number
  /** 受影响章逐格（含 not_affected 占位以对齐矩阵头；仅 affected 章有实义）。 */
  readonly cells: readonly ChangeMatrixCell[]
}

export interface ChangeMatrix {
  /** 受影响章 union（矩阵列头，升序）。 */
  readonly columns: readonly number[]
  readonly rows: readonly ChangeMatrixRow[]
}

/** 钉版是否已含某上游条目的新版本：同 (kind,id) 且 revision ≥ 上游版本即消解。 */
function pinSatisfies(
  pin: { readonly manifest: DependencyManifest } | undefined,
  change: DependencyManifestEntry,
): boolean {
  if (pin === undefined) return false
  const entry = pin.manifest.entries.find((e) => e.kind === change.kind && e.id === change.id)
  return entry !== undefined && entry.revision >= change.revision
}

/** 组装变更矩阵（只读投影）：纯函数、无副作用、可反复调用。 */
export function assembleChangeMatrix(root: string): ChangeMatrix {
  const records = listImpactRecords(root)
  const pins = readChapterDependencyPins(root)

  const affectedSet = new Set<number>()
  for (const record of records) {
    for (const chapter of record.affectedChapters) affectedSet.add(chapter)
  }
  const columns = [...affectedSet].sort((a, b) => a - b)

  const rows = records.map((record): ChangeMatrixRow => {
    const cells: ChangeMatrixCell[] = columns.map((chapterIndex) => {
      if (!record.affectedChapters.includes(chapterIndex)) {
        return { chapterIndex, state: 'not_affected' }
      }
      const pin = pins.get(chapterIndex)
      // 全部上游变更都被钉版满足 ⇒ 已消解；任一未满足（pin 缺失亦算）⇒ 需重写。
      const resolved = record.upstreamChanges.every((change) => pinSatisfies(pin, change))
      return { chapterIndex, state: resolved ? 'resolved' : 'needs_rework' }
    })
    return {
      traversalId: record.traversalId,
      taskRef: record.taskRef,
      trigger: record.trigger,
      upstreamChanges: record.upstreamChanges,
      recordedAt: record.recordedAt,
      staleCount: cells.filter((cell) => cell.state === 'needs_rework').length,
      cells,
    }
  })

  return { columns, rows }
}
