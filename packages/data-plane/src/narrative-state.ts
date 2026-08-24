/**
 * 叙事状态流读取与提交期语义门禁（实现票 #19 / T4）。
 *
 * 真源纪律：读路径直读追踪 jsonl（投影可弃 ⇒ 语义层不依赖 SQLite）。
 * - readNarrativeSnapshot：四族行逐行校验 + 增量折叠成活跃视图；
 *   坏行宁败不脏（TrackingRowError 指明流与字段），重建扫描不受影响；
 * - assertCommitAppendsLegal：commitChapter 的写前语义门禁——行形状、
 *   认知/时间线对事实的引用完整性、M2 时间线序数单调；任何违例在
 *   pending-commit 日志写下第一字节之前抛出，零盘上副作用；
 * - queryActiveFacts：结构化查询芯的 IO 接线（POV/秘密零泄漏在 kernel 纯函数域）。
 *
 * 刻意取舍：伏笔流（narrativePromise）不在本票四族之内，原样字节透传，
 * 行语义校验随其实现票扩张。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  foldNarrativeRows,
  liveMaxTimelineOrder,
  assertTimelineBatchOrdered,
  queryActiveFacts as filterVisibleFacts,
  invalidatedKnowledgeStates,
  assertNoProtectedSupersession,
  TrackingRowError,
  parseKnowledgeStateRow,
  parseRelationshipStateRow,
  parseTemporalFactRow,
  parseTimelineEventRow,
  type FactId,
  type KnowledgeState,
  type NarrativeStateSnapshot,
  type QueryActiveFactsRequest,
  type RelationshipState,
  type TemporalFact,
  type TimelineEvent,
} from '@mozhou/kernel'
import { TRACKING_STREAMS, type TrackingKind } from './layout.js'

function jsonlLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

function readSemanticRows(root: string, kind: Exclude<TrackingKind, 'narrativePromise'>): unknown[] {
  const stream = TRACKING_STREAMS.find((candidate) => candidate.kind === kind)
  if (stream === undefined) {
    throw new Error(`unreachable: no tracking stream registered for kind '${kind}'`)
  }
  const content = readFileSync(join(root, stream.path), 'utf8')
  return jsonlLines(content).map((line, index) => {
    try {
      return JSON.parse(line) as unknown
    } catch (error) {
      throw new TrackingRowError(kind, `line ${index + 1} is not valid JSON: ${(error as Error).message}`)
    }
  })
}

interface SemanticBatch {
  temporalFact: TemporalFact[]
  knowledgeState: KnowledgeState[]
  relationshipState: RelationshipState[]
  timelineEvent: TimelineEvent[]
}

function parseBatch(appends: Partial<Record<TrackingKind, readonly unknown[]>>): SemanticBatch {
  return {
    temporalFact: (appends['temporalFact'] ?? []).map(parseTemporalFactRow),
    knowledgeState: (appends['knowledgeState'] ?? []).map(parseKnowledgeStateRow),
    relationshipState: (appends['relationshipState'] ?? []).map(parseRelationshipStateRow),
    timelineEvent: (appends['timelineEvent'] ?? []).map(parseTimelineEventRow),
  }
}

/** 四族流的当前活跃视图：逐行校验后按 id 末行胜出折叠。 */
export function readNarrativeSnapshot(root: string): NarrativeStateSnapshot {
  return foldNarrativeRows({
    temporalFact: readSemanticRows(root, 'temporalFact'),
    knowledgeState: readSemanticRows(root, 'knowledgeState'),
    relationshipState: readSemanticRows(root, 'relationshipState'),
    timelineEvent: readSemanticRows(root, 'timelineEvent'),
  })
}

/**
 * 提交期语义门禁（T4；T6 增补保护位半边）：在相位机动第一字节之前拦截非法增量。
 * - 行形状：四族各自冻结 Schema 校验（含 secret.* ⇒ riskClass high 同现律，Q7）；
 * - 保护位：protectedUserContent 事实行不可被 ai/external 来源同 id 取代
 *   （T6 / I1，assertNoProtectedSupersession——违例零盘上副作用）；
 * - 引用完整性：认知行 factId 与时间线 impactFactIds 必须解析到「存量活跃 ∪ 本批」
 *   的事实（跨批悬空引用即断链，宁败不脏）；
 * - M2 时间线单调：批内严格递增且全部严格大于存量活跃最大序数。
 */
export function assertCommitAppendsLegal(
  root: string,
  appends: Partial<Record<TrackingKind, readonly unknown[]>>,
): void {
  const snapshot = readNarrativeSnapshot(root)
  const batch = parseBatch(appends)

  // T6 / I1：保护位事实行的自动化取代在动第一字节前拦截
  assertNoProtectedSupersession(snapshot.facts, batch.temporalFact)

  const factUniverse = new Set<FactId>(snapshot.facts.keys())
  for (const fact of batch.temporalFact) {
    factUniverse.add(fact.id)
  }

  for (const ks of batch.knowledgeState) {
    if (!factUniverse.has(ks.factId)) {
      throw new TrackingRowError('knowledgeState', `field 'factId' ${ks.factId} resolves to no live or batch fact`)
    }
  }
  for (const event of batch.timelineEvent) {
    for (const factId of event.impactFactIds) {
      if (!factUniverse.has(factId)) {
        throw new TrackingRowError('timelineEvent', `field 'impactFactIds' entry ${factId} resolves to no live or batch fact`)
      }
    }
  }

  assertTimelineBatchOrdered(batch.timelineEvent, liveMaxTimelineOrder(snapshot))
}

/** 结构化查询芯（#7 冻结形态）的 IO 接线：直读真源 → 折叠 → POV 门禁过滤。 */
export function queryActiveFacts(root: string, request: QueryActiveFactsRequest): TemporalFact[] {
  const snapshot = readNarrativeSnapshot(root)
  return filterVisibleFacts(snapshot, request)
}

/** I3 级联失效查询的 IO 接线：直读真源 → 折叠 → 引用 rejected 事实的认知行。 */
export function queryInvalidatedKnowledgeStates(root: string): KnowledgeState[] {
  return invalidatedKnowledgeStates(readNarrativeSnapshot(root))
}
