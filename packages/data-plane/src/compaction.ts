/**
 * 卷边界状态压缩（State Compaction）事务系统（US#8 · ADR-0011 · ADR-0019 #3）。
 *
 * 事务顺序与不变式：
 *   1. 触发点门：绑定 Volume 状态正式变为 completed（未完结拒绝执行，防止误压缩）；
 *   2. 幂等门：同一卷重跑两次若已生成摘要且无待折叠微事实，返回已落定结果，
 *      不重复调用 LLM、不重复写入事实流、不污染 Event Ledger；
 *   3. 筛选候选：planVolumeCompaction 纯函数筛选终态过期微事实，排除保护位与活跃引用；
 *   4. 生成摘要：经注入式 LLM port 生成摘要，并通过严格质量与完整性机检；
 *      若 LLM 失败或机检不通过，抛错中断，零盘上副作用（失败回滚保证）；
 *   5. 原子落盘：更新卷大纲文件（摘要入正典）→ 回写 compactedIntoVolumeId 到事实流 →
 *      追加事件到 Event Ledger → 刷新 Manifest 基线 → 重建 SQLite 投影。
 */
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import {
  buildCompactedFactRow,
  planVolumeCompaction,
  summarizeVolumeFacts,
  type FactId,
  type VolumeNodeId,
  type VolumeSummaryLlmPort,
} from '@mozhou/kernel'
import { atomicWriteFileSync } from './atomic-write.js'
import {
  OUTLINE_DIR,
  RUNTIME_EVENTS_PATH,
  TRACKING_STREAMS,
} from './layout.js'
import { readManifest, refreshManifestEntries, writeManifest } from './manifest.js'
import { readNarrativeSnapshot } from './narrative-state.js'
import { rebuildProjectionFromCanon } from './projection-rebuild.js'
import { emitFrontmatter, parseFrontmatter, type FrontmatterFieldValue } from './yaml-frontmatter.js'

/* ----------------------------------------------------------------------------
 * 错误
 * -------------------------------------------------------------------------- */

export class VolumeNotFoundError extends Error {
  override readonly name = 'VolumeNotFoundError'

  constructor(readonly volumeNodeId: string) {
    super(`volume outline node not found for id: ${volumeNodeId}`)
  }
}

export class VolumeNotCompletedError extends Error {
  override readonly name = 'VolumeNotCompletedError'

  constructor(readonly volumeNodeId: string, readonly currentStatus: string) {
    super(
      `volume ${volumeNodeId} status is '${currentStatus}', state compaction requires status 'completed'`,
    )
  }
}

export class VolumeCompactionError extends Error {
  override readonly name = 'VolumeCompactionError'

  constructor(detail: string) {
    super(`volume compaction failed: ${detail}`)
  }
}

/* ----------------------------------------------------------------------------
 * 接口与类型
 * -------------------------------------------------------------------------- */

export interface ExecuteVolumeCompactionOptions {
  readonly root: string
  readonly volumeNodeId: VolumeNodeId
  /** 卷末章索引（若未指定，自动尝试从大纲或卷属性探测，探测不到抛错）。 */
  readonly volumeEndChapter?: number | undefined
  readonly llm: VolumeSummaryLlmPort
  readonly maxChars?: number | undefined
  readonly db?: Database.Database | undefined
}

export interface VolumeCompactionResult {
  readonly volumeNodeId: VolumeNodeId
  readonly volumeEndChapter: number
  readonly summary: string
  readonly compactedFactIds: readonly FactId[]
  readonly idempotentReplay: boolean
}

interface VolumeOutlineInfo {
  readonly relPath: string
  readonly data: Record<string, FrontmatterFieldValue>
  readonly body: string
}

/* ----------------------------------------------------------------------------
 * 内部辅助函数
 * -------------------------------------------------------------------------- */

/**
 * 遍历大纲目录寻找对应的卷大纲节点文件（nodeType='volume' && mozhouId=volumeNodeId）。
 */
export function findVolumeOutline(root: string, volumeNodeId: VolumeNodeId): VolumeOutlineInfo {
  const outlineDir = join(root, OUTLINE_DIR)
  if (!existsSync(outlineDir)) {
    throw new VolumeNotFoundError(volumeNodeId)
  }

  const entries = readdirSync(outlineDir)
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === '总纲.md') continue
    const relPath = `${OUTLINE_DIR}/${entry}`
    try {
      const content = readFileSync(join(root, relPath), 'utf8')
      const doc = parseFrontmatter(content)
      if (doc.data['mozhouId'] === volumeNodeId && doc.data['nodeType'] === 'volume') {
        return {
          relPath,
          data: doc.data,
          body: doc.body,
        }
      }
    } catch {
      continue
    }
  }

  throw new VolumeNotFoundError(volumeNodeId)
}

/**
 * 将指定卷大纲节点的状态标记为 completed（纯原子写入 + manifest 同步）。
 */
export function markVolumeCompleted(
  root: string,
  volumeNodeId: VolumeNodeId,
  db?: Database.Database,
): void {
  const info = findVolumeOutline(root, volumeNodeId)
  const currentStatus = typeof info.data['status'] === 'string' ? info.data['status'] : ''
  if (currentStatus === 'completed') {
    return
  }

  const currentRevision = Number(info.data['revision'] ?? 0)
  const nextData: Record<string, FrontmatterFieldValue> = {
    ...info.data,
    status: 'completed',
    revision: currentRevision + 1,
  }

  const newContent = `${emitFrontmatter(nextData)}${info.body}`
  atomicWriteFileSync(join(root, info.relPath), newContent)

  const staleManifest = readManifest(root)
  writeManifest(root, refreshManifestEntries(staleManifest, root, [info.relPath]))
  rebuildProjectionFromCanon(root, db)
}

const SUMMARY_SECTION_TITLE = '## 卷状态摘要'

function extractExistingSummary(info: VolumeOutlineInfo): string | null {
  if (typeof info.data['volumeSummary'] === 'string' && info.data['volumeSummary'].trim().length > 0) {
    return info.data['volumeSummary'].trim()
  }
  const marker = `${SUMMARY_SECTION_TITLE}\n\n`
  const index = info.body.indexOf(marker)
  if (index >= 0) {
    const after = info.body.slice(index + marker.length)
    const nextHeaderIndex = after.indexOf('\n## ')
    const summary = nextHeaderIndex >= 0 ? after.slice(0, nextHeaderIndex) : after
    if (summary.trim().length > 0) {
      return summary.trim()
    }
  }
  return null
}

function updateVolumeOutlineBodyWithSummary(body: string, summary: string): string {
  const marker = `${SUMMARY_SECTION_TITLE}\n\n`
  const index = body.indexOf(marker)
  const newSection = `${SUMMARY_SECTION_TITLE}\n\n${summary}\n`
  if (index >= 0) {
    const before = body.slice(0, index)
    const after = body.slice(index + marker.length)
    const nextHeaderIndex = after.indexOf('\n## ')
    const remainder = nextHeaderIndex >= 0 ? after.slice(nextHeaderIndex) : ''
    return `${before.trimEnd()}\n\n${newSection}${remainder.trimStart()}`
  }
  return `${body.trimEnd()}\n\n${newSection}`
}

/* ----------------------------------------------------------------------------
 * 主事务执行
 * -------------------------------------------------------------------------- */

/**
 * 执行卷边界状态压缩事务：
 * 
 * 1. 冻结卷边界与状态校验（status 必须为 completed）；
 * 2. 幂等性校验：已完成压缩且无新候选事实时直接回放；
 * 3. 规划微事实候选集（纯函数筛选）；
 * 4. 调用注入式 LLM port 生成卷摘要并进行质量校验；
 * 5. 原子落盘：大纲追加摘要、事实流回写 compacted 标记、追加 Event、更新基线、重建投影。
 */
export async function executeVolumeCompaction(
  options: ExecuteVolumeCompactionOptions,
): Promise<VolumeCompactionResult> {
  const { root, volumeNodeId, llm, maxChars } = options

  // 1. 查卷与状态判定
  const outlineInfo = findVolumeOutline(root, volumeNodeId)
  const status = typeof outlineInfo.data['status'] === 'string' ? outlineInfo.data['status'] : 'drafted'
  if (status !== 'completed') {
    throw new VolumeNotCompletedError(volumeNodeId, status)
  }

  const endChapter =
    options.volumeEndChapter
    ?? (typeof outlineInfo.data['endChapter'] === 'number' ? outlineInfo.data['endChapter'] : undefined)
  if (endChapter === undefined || !Number.isSafeInteger(endChapter) || endChapter < 1) {
    throw new VolumeCompactionError(
      `unable to resolve valid volumeEndChapter for volume ${volumeNodeId}; please specify explicitly`,
    )
  }

  // 2. 纯筛选微事实候选
  const snapshot = readNarrativeSnapshot(root)
  const plan = planVolumeCompaction({
    volumeNodeId,
    volumeEndChapter: endChapter,
    snapshot,
  })

  // 3. 幂等检查：若已存在摘要且当前无待折叠微事实，直接回放
  const existingSummary = extractExistingSummary(outlineInfo)
  if (existingSummary !== null && plan.candidates.length === 0) {
    return {
      volumeNodeId,
      volumeEndChapter: endChapter,
      summary: existingSummary,
      compactedFactIds: [],
      idempotentReplay: true,
    }
  }

  // 4. 生成卷摘要（LLM 失败或机检不通过在动盘之前抛错，天然零盘上副作用）
  const summaryResult = await summarizeVolumeFacts({
    plan,
    llm,
    maxChars,
  })

  // 5. 原子写盘事务
  const now = new Date().toISOString()
  const canonTouched: string[] = []

  // 5a. 更新卷大纲文件（写入摘要与递增版本）
  const nextRevision = Number(outlineInfo.data['revision'] ?? 0) + 1
  const updatedData: Record<string, FrontmatterFieldValue> = {
    ...outlineInfo.data,
    volumeSummary: summaryResult.summary,
    compactedAt: now,
    revision: nextRevision,
  }
  const updatedBody = updateVolumeOutlineBodyWithSummary(outlineInfo.body, summaryResult.summary)
  const newOutlineContent = `${emitFrontmatter(updatedData)}${updatedBody}`
  atomicWriteFileSync(join(root, outlineInfo.relPath), newOutlineContent)
  canonTouched.push(outlineInfo.relPath)

  // 5b. 回写微事实的 compactedIntoVolumeId 标记行
  const factStream = TRACKING_STREAMS.find((s) => s.kind === 'temporalFact')
  if (factStream === undefined) {
    throw new VolumeCompactionError("tracking stream for kind 'temporalFact' is missing")
  }
  const factPath = join(root, factStream.path)

  if (summaryResult.factsCompacted.length > 0) {
    const compactedRows = summaryResult.factsCompacted.map((fact) =>
      buildCompactedFactRow({
        fact,
        volumeNodeId,
        updatedAtIso: now,
      }),
    )
    const appendLines = compactedRows.map((row) => `${JSON.stringify(row)}\n`).join('')
    appendFileSync(factPath, appendLines, 'utf8')
    canonTouched.push(factStream.path)
  }

  // 5c. 追加审计事件至 Event Ledger
  const eventPayload = {
    type: 'VOLUME_COMPACTED',
    volumeNodeId,
    volumeEndChapter: endChapter,
    factIds: summaryResult.factsCompacted.map((f) => f.id),
    summaryLength: summaryResult.summary.length,
    timestamp: now,
  }
  appendFileSync(join(root, RUNTIME_EVENTS_PATH), `${JSON.stringify(eventPayload)}\n`, 'utf8')

  // 5d. 刷新 Manifest 基线
  const currentManifest = readManifest(root)
  writeManifest(root, refreshManifestEntries(currentManifest, root, canonTouched))

  // 5e. 重建 SQLite 投影
  rebuildProjectionFromCanon(root, options.db)

  return {
    volumeNodeId,
    volumeEndChapter: endChapter,
    summary: summaryResult.summary,
    compactedFactIds: summaryResult.factsCompacted.map((f) => f.id),
    idempotentReplay: false,
  }
}
