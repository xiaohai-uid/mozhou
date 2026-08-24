/**
 * 保护位与 stale 传播（实现票 #22 / T6）。
 *
 * 规格锚点：kernel-schema I1/I2 + ADR-0019 §4 双轨保护。
 * - I1 工件级保护：`protectedUserContent = true` 的工件对一切自动化通道只读——
 *   自动流程不得清除或改写其内容；作者亲笔神圣不可侵犯；
 * - I2 stale 只是建议性重验信号：上游重算对下游的唯一合法动作是把受影响工件
 *   标记为 stale（StaleMarker{reason, upstreamRefs, markedAt}），永不触发
 *   自动删除/重生成。保护位挡内容，stale 通道传信号——这就是双轨。
 * - I3 级联失效的纯计算半边在 narrative-state.ts（invalidatedKnowledgeStates）。
 *
 * 零依赖纯函数域：不做任何 IO；时间戳由调用方注入（可测试确定性）。
 */
import type {
  AuthorProvenance,
  DependencyManifest,
  DependencyManifestEntry,
  EntityKind,
  StaleMarker,
} from './kernel-schema.js'

/* ----------------------------------------------------------------------------
 * 错误
 * -------------------------------------------------------------------------- */

/** I1 违例：自动化通道试图改写保护位工件。kind/id 定位工件，detail 定位通道。 */
export class ProtectedContentViolationError extends Error {
  override readonly name = 'ProtectedContentViolationError'

  constructor(readonly kind: string, readonly id: string, detail: string) {
    super(`protected content violation at '${kind}' ${id}: ${detail}`)
  }
}

/** 依赖钉版形状违例：提交请求或事件行回读里的 DependencyManifest 不合冻结形状。 */
export class DependencyManifestError extends Error {
  override readonly name = 'DependencyManifestError'

  constructor(detail: string) {
    super(`dependency manifest violation: ${detail}`)
  }
}

/* ----------------------------------------------------------------------------
 * I1 工件级保护守卫
 * -------------------------------------------------------------------------- */

/**
 * 自动化写入前置守卫（I1）：provenance.protectedUserContent === true 即抛错。
 * 作者/应用壳的人工写路径不走此守卫——保护位约束的只是自动流程。
 */
export function assertAutomationReadOnly(
  provenance: AuthorProvenance,
  ref: { readonly kind: string; readonly id: string },
): void {
  if (provenance.protectedUserContent) {
    throw new ProtectedContentViolationError(
      ref.kind,
      ref.id,
      'artifact is protectedUserContent — automation channels are read-only (I1)',
    )
  }
}

/* ----------------------------------------------------------------------------
 * StaleMarker 构造与依赖命中计算（I2）
 * -------------------------------------------------------------------------- */

export interface StaleMarkerInput {
  readonly reason: StaleMarker['reason']
  /** 触发传播的上游精确版本，至少一条——无引用的标记无法定向重算。 */
  readonly upstreamRefs: readonly DependencyManifestEntry[]
  /** ISO-8601 UTC；由调用方注入保持本模块纯函数。 */
  readonly markedAt: string
}

/** 冻结形状构造：upstreamRefs 原样保留（DependencyManifestEntry 同构，Q14）。 */
export function buildStaleMarker(input: StaleMarkerInput): StaleMarker {
  if (!Number.isFinite(Date.parse(input.markedAt))) {
    throw new DependencyManifestError(`markedAt must be an ISO-8601 timestamp, got ${input.markedAt}`)
  }
  if (input.upstreamRefs.length === 0) {
    throw new DependencyManifestError('upstreamRefs must carry at least one entry')
  }
  return {
    reason: input.reason,
    upstreamRefs: input.upstreamRefs,
    markedAt: input.markedAt,
  }
}

/**
 * 依赖命中：清单条目与上游变更按 (kind, id) 对齐，revision 漂移即命中。
 * 未被本章依赖的上游变更、以及版本未变的条目都不产生传播（US28 钉版语义：
 * {kind, id, revision} 让影响定位精确到「编译时读到的那个版本」）。
 */
export function matchStaleDependencies(
  manifest: DependencyManifest,
  upstreamChanges: readonly DependencyManifestEntry[],
): DependencyManifestEntry[] {
  const changes = new Map<string, DependencyManifestEntry>()
  for (const change of upstreamChanges) {
    changes.set(`${change.kind}:${change.id}`, change)
  }
  const hits: DependencyManifestEntry[] = []
  for (const entry of manifest.entries) {
    const change = changes.get(`${entry.kind}:${entry.id}`)
    if (change !== undefined && change.revision !== entry.revision) {
      hits.push(change)
    }
  }
  return hits.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.kind < b.kind ? -1 : 0))
}

/** 传播决策：命中非空 ⇒ 下游获得带原因/引用/时间的标记；否则 null（原样放行）。 */
export function computeStaleMarker(input: {
  readonly manifest: DependencyManifest
  readonly upstreamChanges: readonly DependencyManifestEntry[]
  readonly reason: StaleMarker['reason']
  readonly markedAt: string
}): StaleMarker | null {
  const hits = matchStaleDependencies(input.manifest, input.upstreamChanges)
  if (hits.length === 0) {
    return null
  }
  return buildStaleMarker({ reason: input.reason, upstreamRefs: hits, markedAt: input.markedAt })
}

/* ----------------------------------------------------------------------------
 * DependencyManifest 行解析（提交请求校验与事件行回读共用同一冻结形状）
 * -------------------------------------------------------------------------- */

const ENTITY_KINDS: readonly EntityKind[] = [
  'book',
  'authorIntent',
  'outlineNode',
  'scene',
  'temporalFact',
  'knowledgeState',
  'narrativePromise',
  'relationshipState',
  'timelineEvent',
  'styleProfile',
  'chapterCommit',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 校验单条依赖钉版（Q14）：kind ∈ EntityKind、id 非空串、revision 为 ≥0 安全整数。
 */
export function parseDependencyManifestEntry(row: unknown, index: number): DependencyManifestEntry {
  if (!isRecord(row)) {
    throw new DependencyManifestError(`entry #${index} must be an object, got ${JSON.stringify(row)}`)
  }
  const kind = row['kind']
  if (typeof kind !== 'string' || !(ENTITY_KINDS as readonly string[]).includes(kind)) {
    throw new DependencyManifestError(`entry #${index} field 'kind' must be one of ${ENTITY_KINDS.join('|')}, got ${JSON.stringify(kind)}`)
  }
  const id = row['id']
  if (typeof id !== 'string' || id.length === 0) {
    throw new DependencyManifestError(`entry #${index} field 'id' must be a non-empty string`)
  }
  const revision = row['revision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new DependencyManifestError(`entry #${index} (${id}) field 'revision' must be an integer >= 0, got ${JSON.stringify(revision)}`)
  }
  return { kind: kind as EntityKind, id, revision }
}

/** 整张依赖清单解析：entries 必须为数组，逐条过 parseDependencyManifestEntry。 */
export function parseDependencyManifest(rows: unknown): DependencyManifest {
  if (!Array.isArray(rows)) {
    throw new DependencyManifestError(`entries must be an array, got ${JSON.stringify(rows)}`)
  }
  return { entries: rows.map((row, index) => parseDependencyManifestEntry(row, index)) }
}
