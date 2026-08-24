/**
 * stale 传播服务（实现票 #22 / T6）。
 *
 * 规格锚点：kernel-schema I1/I2 + ADR-0019 §4 双轨保护 + US9/US10/US28。
 * - 上游正典/大纲变更后，依赖它的下游章节据 DependencyManifest（Q14 钉版）
 *   被定位，其**章大纲节点** frontmatter 获得
 *   `staleReason / staleMarkedAt / staleUpstreamRefs` 三字段——
 *   带原因、带精确上游版本引用、带时间；
 * - 正文文件一个字节都不动：作者文字零丢失由「只写规划面」结构性保证；
 * - 保护位工件的唯一合法自动触点就是本通道：stale 标记是附加元数据，
 *   不改写任何作者内容字段（I1 挡内容重写，I2 定义信号通道）；
 * - stale 只是建议性重验信号（I2）：不置 OutlineNodeStatus='stale'、
 *   不触发删除/重生成；作者确认后的清除归后续交互票。
 *
 * 依赖钉版的物理落点：ChapterCommit 无独立实体文件（T3 三件套），
 * dependencyManifest 随 ChapterCommitted 事件行持久化；事件账本在运行时区，
 * 丢失时传播退化为「无可标记章节」——安全降级，永不误标。
 *
 * 崩溃窗口取舍：多文件标记无 pending-commit 级日志——任一中断最坏留下
 * 「文件已标而基线未刷」状态，下次启动被对账提案捕获交作者过目，
 * canon 内容本身无损（宁可见、不可脏）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeStaleMarker,
  parseDependencyManifest,
  parseDependencyManifestEntry,
} from '@mozhou/kernel'
import type { DependencyManifest, DependencyManifestEntry, StaleMarker } from '@mozhou/kernel'
import { assertPreWriteHash, atomicReplace, type PlaneContext } from './chapter.js'
import { RUNTIME_EVENTS_PATH, chapterOutlinePath } from './layout.js'
import { refreshManifestEntries, writeManifest } from './manifest.js'
import { emitFrontmatter, parseFrontmatter, type FrontmatterFieldValue } from './yaml-frontmatter.js'

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

/* ----------------------------------------------------------------------------
 * 章大纲节点上的 StaleMarker 编解码（frontmatter 三平铺字段）
 * -------------------------------------------------------------------------- */

const STALE_REASON_FIELD = 'staleReason'
const STALE_MARKED_AT_FIELD = 'staleMarkedAt'
const STALE_UPSTREAM_REFS_FIELD = 'staleUpstreamRefs'

const STALE_REASONS: readonly StaleMarker['reason'][] = [
  'upstream_canon_changed',
  'upstream_outline_changed',
  'dependency_manifest_mismatch',
]

/** 从章大纲节点 frontmatter 读回标记；三字段不齐即视为无标记（宁缺勿猜）。 */
export function readOutlineStaleMarker(fields: Readonly<Record<string, FrontmatterFieldValue>>): StaleMarker | null {
  const reason = fields[STALE_REASON_FIELD]
  const markedAt = fields[STALE_MARKED_AT_FIELD]
  const refs = fields[STALE_UPSTREAM_REFS_FIELD]
  if (reason === undefined && markedAt === undefined && refs === undefined) {
    return null
  }
  if (
    typeof reason !== 'string' ||
    !(STALE_REASONS as readonly string[]).includes(reason) ||
    typeof markedAt !== 'string' ||
    !Array.isArray(refs)
  ) {
    throw new Error(`malformed stale marker fields on outline node: ${JSON.stringify({ reason, markedAt })}`)
  }
  return {
    reason: reason as StaleMarker['reason'],
    markedAt,
    upstreamRefs: refs.map((entry, index) => parseDependencyManifestEntry(entry, index)),
  }
}

/** 就地写入三平铺字段 + revision 原地变更 +1（KernelEntityHead 事务纪律），正文区原样保留。 */
function applyMarkerToOutlineNode(
  root: string,
  relPath: string,
  marker: StaleMarker,
): { readonly nodeId: string; readonly newRevision: number } {
  const raw = readFileSync(join(root, relPath), 'utf8')
  const document = parseFrontmatter(raw)

  const mozhouId = document.data['mozhouId']
  if (typeof mozhouId !== 'string' || mozhouId.length === 0) {
    throw new Error(`outline node ${relPath} lost its mozhouId`)
  }
  const currentRevision = document.data['revision']
  const newRevision = typeof currentRevision === 'number' && Number.isSafeInteger(currentRevision) ? currentRevision + 1 : 1

  const fields: Record<string, FrontmatterFieldValue> = { ...document.data }
  fields['revision'] = newRevision
  fields[STALE_REASON_FIELD] = marker.reason
  fields[STALE_MARKED_AT_FIELD] = marker.markedAt
  fields[STALE_UPSTREAM_REFS_FIELD] = marker.upstreamRefs.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    revision: entry.revision,
  }))

  atomicReplace(root, relPath, `${emitFrontmatter(fields)}${document.body}`)
  return { nodeId: mozhouId, newRevision }
}

/* ----------------------------------------------------------------------------
 * 传播主入口
 * -------------------------------------------------------------------------- */

export interface StalePropagationRequest {
  readonly reason: StaleMarker['reason']
  /**
   * 上游变更后的当前版本表（{kind, id, revision}）。逐条过冻结形状校验；
   * 与各章钉版按 (kind, id) 对齐、revision 漂移即命中（US28 影响精确到版）。
   */
  readonly upstreamChanges: readonly DependencyManifestEntry[]
  /** ISO-8601 UTC；显式注入保持可测试确定性。 */
  readonly markedAt: string
}

export interface StalePropagationResult {
  readonly reason: StaleMarker['reason']
  /** 依赖钉版被命中、标记已落盘的章节（按章序）。 */
  readonly markedChapters: readonly number[]
  /** 有钉版但未被命中的章节（按章序）；无钉版章节不在传播视野内。 */
  readonly untouchedChapters: readonly number[]
}

/**
 * 上游变更 → 下游 stale 传播（验收②）：读各章钉版 → 逐章计算命中 →
 * 命中章的章大纲节点写标记（写前 hash 校验 S3 + 原子替换）→ 刷新基线与投影行。
 * 全程零正文触碰；保护位章大纲节点同样可标——stale 是 I1 之外的合法通道。
 */
export function propagateStaleMarkers(ctx: PlaneContext, request: StalePropagationRequest): StalePropagationResult {
  const changes = request.upstreamChanges.map((entry, index) => parseDependencyManifestEntry(entry, index))
  const pins = readChapterDependencyPins(ctx.root)

  const markedChapters: number[] = []
  const untouchedChapters: number[] = []
  const touchedRelPaths: string[] = []

  for (const pin of [...pins.values()].sort((a, b) => a.chapterIndex - b.chapterIndex)) {
    const marker = computeStaleMarker({
      manifest: pin.manifest,
      upstreamChanges: changes,
      reason: request.reason,
      markedAt: request.markedAt,
    })
    if (marker === null) {
      untouchedChapters.push(pin.chapterIndex)
      continue
    }

    const relPath = chapterOutlinePath(pin.chapterIndex)
    // S3 写前校验：盘上内容 ≠ 基线即拒（外部编辑中的大纲先走对账，不被静默叠加）
    assertPreWriteHash(ctx, relPath)
    const { nodeId, newRevision } = applyMarkerToOutlineNode(ctx.root, relPath, marker)
    ctx.db.prepare('UPDATE outline_nodes SET revision = ? WHERE id = ?').run(newRevision, nodeId)
    touchedRelPaths.push(relPath)
    markedChapters.push(pin.chapterIndex)
  }

  if (touchedRelPaths.length > 0) {
    // 自己的写入自己吸收进基线——下次启动扫描不得把自己的标记当外部修改
    ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, touchedRelPaths)
    writeManifest(ctx.root, ctx.manifest)
  }

  return { reason: request.reason, markedChapters, untouchedChapters }
}
