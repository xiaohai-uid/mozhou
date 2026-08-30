/**
 * 叙事状态流语义层（实现票 #19 / T4；T6 增补保护门禁与级联失效查询）。
 *
 * T3 的 commitChapter 只做不解释的字节级追加；本模块补上行的语义半边：
 *   1. 行级校验——TemporalFact / KnowledgeState / RelationshipState / TimelineEvent
 *      四族记录落流前的冻结 Schema 校验（宁败不脏：坏行在动第一字节前被拦截）；
 *   2. 增量折叠——append-only 流按 id 末行胜出折叠成当前活跃视图（旧 commit
 *      痕迹永不改写，I5 ⇒ 折叠是纯读派生，不回写任何行）；
 *   3. queryActiveFacts 读路径——章区间过滤 + POV/秘密零泄漏门禁 +
 *      knownSinceChapter 生效（Q7/Q10/US24/US25）；
 *   4. 时间线 worldTimeOrder 全书严格单调硬门禁（Q12/M2：乱序插入即拦截）；
 *   5. T6 增补——assertNoProtectedSupersession（I1：protectedUserContent
 *      事实行不可被自动化来源同 id 取代）+ invalidatedKnowledgeStates
 *      （I3：引用事实 rejected 的认知行级联失效可查询）。
 *
 * 零依赖纯函数域：输入是已 JSON.parse 的普通对象，输出品牌化类型或抛错。
 * 文件 IO 归数据面（@mozhou/data-plane），本模块不做任何 IO。
 *
 * 零泄漏门禁纪律（验收①）：`secret.*` 事实对未授权视角**不存在**而非被隐藏——
 * 查询结果里没有计数、没有占位、没有可区分痕迹；下游 k-hop 建边只能看见
 * 本函数返回的事实，被滤秘密天然零候选零建边。
 */
import type {
  EntityRef,
  FactId,
  FactImportance,
  FactRiskClass,
  FactSource,
  FactStatus,
  FactValue,
  EpistemicLevel,
  KnowledgeHolder,
  KnowledgeState,
  KnowledgeStateId,
  OutlineNodeId,
  PovEntity,
  RelationshipState,
  RelationshipStateId,
  TemporalFact,
  TimelineEvent,
  TimelineEventId,
  VolumeNodeId,
} from './kernel-schema.js'
import { ProtectedContentViolationError } from './protection.js'

/* ----------------------------------------------------------------------------
 * 错误
 * -------------------------------------------------------------------------- */

/** 追踪流行违规：形状坏 / 引用悬空。kind 定位流，detail 定位字段。 */
export class TrackingRowError extends Error {
  override readonly name: string = 'TrackingRowError'

  constructor(readonly kind: string, detail: string) {
    super(`tracking row violation in '${kind}': ${detail}`)
  }
}

/** M2 时间线单调硬门禁触发：新序数必须严格大于当前活跃最大序数。 */
export class TimelineOrderViolationError extends TrackingRowError {
  override readonly name = 'TimelineOrderViolationError'

  constructor(readonly offendingOrder: number, readonly currentMaxOrder: number | null) {
    super(
      'timelineEvent',
      currentMaxOrder === null
        ? `worldTimeOrder ${offendingOrder} must be a positive integer`
        : `worldTimeOrder ${offendingOrder} is not greater than live max ${currentMaxOrder} — timeline must stay strictly increasing (M2)`,
    )
  }
}

/* ----------------------------------------------------------------------------
 * 共享形状守卫
 * -------------------------------------------------------------------------- */

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
const ENTITY_REF_PATTERN = /^(char|item|location|faction|concept):.+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(kind: string, field: string, detail: string): never {
  throw new TrackingRowError(kind, `field '${field}' ${detail}`)
}

function describe(value: unknown): string {
  // JSON.stringify 覆盖标量与对象；undefined/function/symbol 返回 undefined，
  // 用 Object.prototype.toString 兜底——全程不触碰 String(obj) 的默认序列化
  const json = JSON.stringify(value)
  return json === undefined ? Object.prototype.toString.call(value) : json
}

function requireString(kind: string, row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') {
    fail(kind, field, `must be a string, got ${describe(value)}`)
  }
  return value
}

function requireSafeInteger(kind: string, row: Record<string, unknown>, field: string, min: number): number {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    fail(kind, field, `must be an integer >= ${min}, got ${describe(value)}`)
  }
  return value
}

function requireIsoTimestamp(kind: string, row: Record<string, unknown>, field: string): string {
  const value = requireString(kind, row, field)
  if (!Number.isFinite(Date.parse(value))) {
    fail(kind, field, `must be an ISO-8601 timestamp, got ${value}`)
  }
  return value
}

/** 前缀 + ULID 身份校验（Q4：品牌化 ID 在 Markdown/JSONL 内可 grep 的前提）。 */
function requirePrefixedUlid(kind: string, row: Record<string, unknown>, field: string, prefix: string): string {
  const id = requireString(kind, row, field)
  if (!id.startsWith(`${prefix}_`) || !ULID_PATTERN.test(id.slice(prefix.length + 1))) {
    fail(kind, field, `must be a ${prefix}_ prefixed ULID, got ${id}`)
  }
  return id
}

function requireEntityRef(kind: string, row: Record<string, unknown>, field: string): EntityRef {
  const value = requireString(kind, row, field)
  if (!ENTITY_REF_PATTERN.test(value)) {
    fail(kind, field, `must be a namespaced EntityRef (char|item|location|faction|concept):<slug>, got ${value}`)
  }
  return value as EntityRef
}

interface ValidatedHead {
  readonly id: string
  readonly bookId: string
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

function validateHead(kind: string, row: Record<string, unknown>, idPrefix: string): ValidatedHead {
  return {
    id: requirePrefixedUlid(kind, row, 'id', idPrefix),
    bookId: requirePrefixedUlid(kind, row, 'bookId', 'book'),
    revision: requireSafeInteger(kind, row, 'revision', 0),
    createdAt: requireIsoTimestamp(kind, row, 'createdAt'),
    updatedAt: requireIsoTimestamp(kind, row, 'updatedAt'),
  }
}

function requireProvenance(
  kind: string,
  row: Record<string, unknown>,
): { origin: 'author' | 'ai' | 'external'; protectedUserContent: boolean } {
  const provenance = row['provenance']
  if (!isRecord(provenance)) {
    fail(kind, 'provenance', `must be an object, got ${describe(provenance)}`)
  }
  const origin = provenance['origin']
  if (origin !== 'author' && origin !== 'ai' && origin !== 'external') {
    fail(kind, 'provenance.origin', `must be author|ai|external, got ${describe(origin)}`)
  }
  const protectedFlag = provenance['protectedUserContent']
  if (typeof protectedFlag !== 'boolean') {
    fail(kind, 'provenance.protectedUserContent', `must be a boolean, got ${describe(protectedFlag)}`)
  }
  return { origin, protectedUserContent: protectedFlag }
}

/** 秘密谓词命名空间判定（Q7）。 */
export function isSecretPredicate(predicate: string): boolean {
  return predicate.startsWith('secret.')
}

/* ----------------------------------------------------------------------------
 * TemporalFact
 * -------------------------------------------------------------------------- */

const FACT_IMPORTANCE: readonly FactImportance[] = ['trivial', 'notable', 'critical']
const FACT_STATUS: readonly FactStatus[] = ['planned', 'candidate', 'confirmed', 'rejected']
const FACT_RISK: readonly FactRiskClass[] = ['low', 'medium', 'high']

function requireEnum<T extends string>(kind: string, row: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const value = row[field]
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(kind, field, `must be one of ${allowed.join('|')}, got ${describe(value)}`)
  }
  return value as T
}

function requireChapterInterval(kind: string, row: Record<string, unknown>): { validFrom: number; validUntil: number | null } {
  const validFrom = requireSafeInteger(kind, row, 'validFrom', 1)
  const rawUntil = row['validUntil']
  let validUntil: number | null
  if (rawUntil === null) {
    validUntil = null
  } else if (typeof rawUntil === 'number' && Number.isSafeInteger(rawUntil)) {
    validUntil = rawUntil
  } else {
    fail(kind, 'validUntil', `must be null or an integer, got ${describe(rawUntil)}`)
  }
  if (validUntil !== null && validUntil < validFrom) {
    fail(kind, 'validUntil', `${validUntil} precedes validFrom ${validFrom}`)
  }
  return { validFrom, validUntil }
}

function requireFactValue(kind: string, row: Record<string, unknown>): FactValue {
  const value = row['value']
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    fail(kind, 'value', 'must be a string|number|boolean scalar (M2 数值断言免解析的前提)')
  }
  return value
}

function requireFactSource(kind: string, row: Record<string, unknown>): FactSource {
  const source = row['source']
  if (!isRecord(source)) {
    fail(kind, 'source', `must be an object, got ${describe(source)}`)
  }
  if (source['kind'] === 'chapter') {
    const chapterIndex = source['chapterIndex']
    if (typeof chapterIndex !== 'number' || !Number.isSafeInteger(chapterIndex) || chapterIndex < 1) {
      fail(kind, 'source.chapterIndex', `must be an integer >= 1, got ${describe(chapterIndex)}`)
    }
    return { kind: 'chapter', chapterIndex }
  }
  if (source['kind'] === 'outlineNode') {
    const outlineNodeId = source['outlineNodeId']
    if (typeof outlineNodeId !== 'string' || !/^(book|volume|arc|chapter)_[0-9A-HJKMNP-TV-Z]{26}$/.test(outlineNodeId)) {
      fail(kind, 'source.outlineNodeId', `must be an outline node ULID id, got ${describe(outlineNodeId)}`)
    }
    return { kind: 'outlineNode', outlineNodeId: outlineNodeId as OutlineNodeId }
  }
  fail(kind, 'source.kind', `must be chapter|outlineNode, got ${describe(source['kind'])}`)
}

export function parseTemporalFactRow(row: unknown): TemporalFact {
  const kind = 'temporalFact'
  if (!isRecord(row)) {
    fail(kind, '(root)', `must be a JSON object, got ${describe(row)}`)
  }
  const head = validateHead(kind, row, 'fact')
  const subject = requireEntityRef(kind, row, 'subject')
  const predicate = requireString(kind, row, 'predicate')
  if (predicate.length === 0) {
    fail(kind, 'predicate', 'must be non-empty')
  }
  const riskClass = requireEnum(kind, row, 'riskClass', FACT_RISK)
  if (isSecretPredicate(predicate) && riskClass !== 'high') {
    // Q7：秘密 = secret.* 谓词命名空间 + 高风险级；两者必须同现
    fail(kind, 'riskClass', `secret.* predicate requires riskClass 'high', got '${riskClass}'`)
  }

  return {
    ...head,
    subject,
    predicate,
    value: requireFactValue(kind, row),
    ...requireChapterInterval(kind, row),
    importance: requireEnum(kind, row, 'importance', FACT_IMPORTANCE),
    riskClass,
    source: requireFactSource(kind, row),
    status: requireEnum(kind, row, 'status', FACT_STATUS),
    compactedIntoVolumeId:
      row['compactedIntoVolumeId'] === null
        ? null
        : (requirePrefixedUlid(kind, row, 'compactedIntoVolumeId', 'volume') as VolumeNodeId),
    provenance: requireProvenance(kind, row),
  } as unknown as TemporalFact
}

/* ----------------------------------------------------------------------------
 * KnowledgeState
 * -------------------------------------------------------------------------- */

function requireKnowledgeHolder(kind: string, row: Record<string, unknown>): KnowledgeHolder {
  const holder = row['holder']
  if (holder === 'reader' || holder === 'protagonist') {
    return holder
  }
  if (typeof holder === 'string' && /^char:.+$/.test(holder)) {
    return holder as KnowledgeHolder
  }
  fail(kind, 'holder', `must be reader|protagonist|char:<slug>, got ${describe(holder)}`)
}

export function parseKnowledgeStateRow(row: unknown): KnowledgeState {
  const kind = 'knowledgeState'
  if (!isRecord(row)) {
    fail(kind, '(root)', `must be a JSON object, got ${describe(row)}`)
  }
  const head = validateHead(kind, row, 'knst')
  // exactOptionalPropertyTypes：可选键缺席 = 键不存在，不得显式写 undefined
  const sceneId = row['knownSinceSceneId']
  const distortion = row['distortion']
  const level = row['level']
  // ADR-0026 迁移规则：存量行（level 缺席）读路径一次性折算 knows；
  // 在场值必须 ∈ 词表（宁败不猜），不静默改写非法值。
  const parsedLevel =
    level === undefined || level === null
      ? MIGRATED_DEFAULT_LEVEL
      : level === 'knows' || level === 'suspects' || level === 'believes'
        ? level
        : fail(kind, 'level', `must be knows|suspects|believes, got ${describe(level)}`)
  return {
    ...head,
    factId: requirePrefixedUlid(kind, row, 'factId', 'fact') as FactId,
    holder: requireKnowledgeHolder(kind, row),
    level: parsedLevel,
    knownSinceChapter: requireSafeInteger(kind, row, 'knownSinceChapter', 1),
    ...(sceneId === undefined ? {} : { knownSinceSceneId: requirePrefixedUlid(kind, row, 'knownSinceSceneId', 'scene') }),
    ...(distortion === undefined ? {} : { distortion: requireString(kind, row, 'distortion') }),
  } as unknown as KnowledgeState
}

/**
 * ADR-0026 迁移缺省：仅用于 pre-epistemic 存量行（无 level 字段）——历史行
 * 语义即「确认知情」。新构造必须显式声明 level；schema 升版后此缺省将移除。
 */
export const MIGRATED_DEFAULT_LEVEL: EpistemicLevel = 'knows'

/* ----------------------------------------------------------------------------
 * RelationshipState
 * -------------------------------------------------------------------------- */

export function parseRelationshipStateRow(row: unknown): RelationshipState {
  const kind = 'relationshipState'
  if (!isRecord(row)) {
    fail(kind, '(root)', `must be a JSON object, got ${describe(row)}`)
  }
  const head = validateHead(kind, row, 'rels')
  const entityA = requireEntityRef(kind, row, 'entityA')
  const entityB = requireEntityRef(kind, row, 'entityB')
  if (entityA === entityB) {
    fail(kind, 'entityB', `must differ from entityA (${entityA})`)
  }
  const affinityScore = row['affinityScore']
  if (typeof affinityScore !== 'number' || !Number.isFinite(affinityScore) || affinityScore < -100 || affinityScore > 100) {
    fail(kind, 'affinityScore', `must be a finite number in [-100, 100], got ${describe(affinityScore)}`)
  }
  const relationshipType = requireString(kind, row, 'relationshipType')
  if (relationshipType.length === 0) {
    fail(kind, 'relationshipType', 'must be non-empty')
  }

  return {
    ...head,
    entityA,
    entityB,
    relationshipType,
    affinityScore,
    ...requireChapterInterval(kind, row),
    sourceChapterIndex: requireSafeInteger(kind, row, 'sourceChapterIndex', 1),
  } as unknown as RelationshipState
}

/* ----------------------------------------------------------------------------
 * TimelineEvent
 * -------------------------------------------------------------------------- */

function requireEntityRefList(kind: string, row: Record<string, unknown>, field: string): EntityRef[] {
  const list = row[field]
  if (!Array.isArray(list)) {
    fail(kind, field, `must be an array, got ${describe(list)}`)
  }
  return list.map((entry) => {
    if (typeof entry !== 'string' || !ENTITY_REF_PATTERN.test(entry)) {
      fail(kind, field, `entries must be namespaced EntityRefs, got ${describe(entry)}`)
    }
    return entry as EntityRef
  })
}

function requireFactIdList(kind: string, row: Record<string, unknown>, field: string): FactId[] {
  const list = row[field]
  if (!Array.isArray(list)) {
    fail(kind, field, `must be an array, got ${describe(list)}`)
  }
  return list.map((entry) => {
    if (typeof entry !== 'string' || !entry.startsWith('fact_') || !ULID_PATTERN.test(entry.slice('fact_'.length))) {
      fail(kind, field, `entries must be fact_ prefixed ULIDs, got ${describe(entry)}`)
    }
    return entry as FactId
  })
}

export function parseTimelineEventRow(row: unknown): TimelineEvent {
  const kind = 'timelineEvent'
  if (!isRecord(row)) {
    fail(kind, '(root)', `must be a JSON object, got ${describe(row)}`)
  }
  const head = validateHead(kind, row, 'tle')
  const worldTimeLabel = requireString(kind, row, 'worldTimeLabel')
  if (worldTimeLabel.length === 0) {
    fail(kind, 'worldTimeLabel', 'must be non-empty')
  }
  const locationRef = row['locationRef']
  return {
    ...head,
    worldTimeLabel,
    worldTimeOrder: requireSafeInteger(kind, row, 'worldTimeOrder', 1),
    chapterIndex: requireSafeInteger(kind, row, 'chapterIndex', 1),
    ...(locationRef === undefined ? {} : { locationRef: requireEntityRef(kind, row, 'locationRef') }),
    participants: requireEntityRefList(kind, row, 'participants'),
    summary: requireString(kind, row, 'summary'),
    impactFactIds: requireFactIdList(kind, row, 'impactFactIds'),
  } as unknown as TimelineEvent
}

/* ----------------------------------------------------------------------------
 * 增量折叠：append-only 流 → 当前活跃视图（同 id 末行胜出）
 * -------------------------------------------------------------------------- */

export interface NarrativeStateSnapshot {
  readonly facts: ReadonlyMap<FactId, TemporalFact>
  readonly knowledgeStates: ReadonlyMap<KnowledgeStateId, KnowledgeState>
  readonly relationships: ReadonlyMap<RelationshipStateId, RelationshipState>
  readonly timelineEvents: ReadonlyMap<TimelineEventId, TimelineEvent>
}

export interface NarrativeStreamRows {
  readonly temporalFact?: readonly unknown[]
  readonly knowledgeState?: readonly unknown[]
  readonly relationshipState?: readonly unknown[]
  readonly timelineEvent?: readonly unknown[]
}

/** 校验并折叠四族增量。行序即权威序：同一 id 后到的行覆盖先到的（updated 语义）。 */
export function foldNarrativeRows(rows: NarrativeStreamRows): NarrativeStateSnapshot {
  const facts = new Map<FactId, TemporalFact>()
  for (const row of rows.temporalFact ?? []) {
    const fact = parseTemporalFactRow(row)
    facts.set(fact.id, fact)
  }
  const knowledgeStates = new Map<KnowledgeStateId, KnowledgeState>()
  for (const row of rows.knowledgeState ?? []) {
    const ks = parseKnowledgeStateRow(row)
    knowledgeStates.set(ks.id, ks)
  }
  const relationships = new Map<RelationshipStateId, RelationshipState>()
  for (const row of rows.relationshipState ?? []) {
    const rel = parseRelationshipStateRow(row)
    relationships.set(rel.id, rel)
  }
  const timelineEvents = new Map<TimelineEventId, TimelineEvent>()
  for (const row of rows.timelineEvent ?? []) {
    const event = parseTimelineEventRow(row)
    timelineEvents.set(event.id, event)
  }
  return { facts, knowledgeStates, relationships, timelineEvents }
}

/* ----------------------------------------------------------------------------
 * M2 时间线单调硬门禁
 * -------------------------------------------------------------------------- */

/** 当前活跃时间线的最大序数；空时间线返回 null。 */
export function liveMaxTimelineOrder(snapshot: NarrativeStateSnapshot): number | null {
  let max: number | null = null
  for (const event of snapshot.timelineEvents.values()) {
    if (max === null || event.worldTimeOrder > max) {
      max = event.worldTimeOrder
    }
  }
  return max
}

/**
 * 批内严格递增 + 每条都严格大于存量活跃最大值（Q12/M2）。
 * 存量取折叠后活跃视图——被更新取代的旧行不再约束新插入，
 * 但活跃集内的相对顺序永不倒退。
 */
export function assertTimelineBatchOrdered(events: readonly TimelineEvent[], liveMax: number | null): void {
  let bound = liveMax
  for (const event of events) {
    if (event.worldTimeOrder <= 0 || (bound !== null && event.worldTimeOrder <= bound)) {
      throw new TimelineOrderViolationError(event.worldTimeOrder, bound)
    }
    bound = event.worldTimeOrder
  }
}

/* ----------------------------------------------------------------------------
 * queryActiveFacts 读路径
 * -------------------------------------------------------------------------- */

export interface QueryActiveFactsRequest {
  /** 查询章索引（含端点的生效区间判断锚点）。 */
  readonly chapter: number
  /** 视角主体：主角或具名角色；reader 不是可查询视角（零泄漏门禁不接受全知视角）。 */
  readonly pov: PovEntity
  /** 限定断言主体；缺省 = 全部主体。 */
  readonly entityIds?: readonly EntityRef[]
}

function assertQueryRequest(request: QueryActiveFactsRequest): void {
  if (typeof request.chapter !== 'number' || !Number.isSafeInteger(request.chapter) || request.chapter < 1) {
    throw new TrackingRowError('query', `chapter must be an integer >= 1, got ${describe(request.chapter)}`)
  }
  if (request.pov !== 'protagonist' && !(typeof request.pov === 'string' && /^char:.+$/.test(request.pov))) {
    throw new TrackingRowError('query', `pov must be protagonist or char:<slug>, got ${describe(request.pov)}`)
  }
}

/**
 * 结构化查询芯（#7 冻结形态）：第 `chapter` 章时点上、断言于 `entityIds`
 * （缺省全部）、且对 `pov` 视角可见的活跃事实，按 (validFrom, id) 确定序返回。
 *
 * 可见性规则：
 * - 区间：validFrom ≤ chapter ≤ (validUntil ?? ∞)，含端点；
 * - 生命周期：status=rejected 即出局（I3 级联失效的查询侧投影）；
 * - 秘密门禁（Q7/US25 零泄漏）：`secret.*` 事实仅当存在一条授权认知行——
 *   holder 与 pov 完全相等且 knownSinceChapter ≤ chapter——才可见；
 *   无认知行的秘密对所有视角不可见（默认拒绝）。非秘密事实是世界客观真，
 *   不要求认知行。被滤秘密在结果集中与不存在不可区分（验收①）。
 */
export function queryActiveFacts(
  state: Pick<NarrativeStateSnapshot, 'facts' | 'knowledgeStates'>,
  request: QueryActiveFactsRequest,
): TemporalFact[] {
  assertQueryRequest(request)

  const authorizedSecrets = new Set<FactId>()
  for (const ks of state.knowledgeStates.values()) {
    // ADR-0026：仅 level=knows 授权确定性秘密知识；suspects/believes 不授权
    //（分别经 queryKnowledgePerspective 以「怀疑/信念」语义呈现）
    if (ks.holder === request.pov && ks.knownSinceChapter <= request.chapter && ks.level === 'knows') {
      authorizedSecrets.add(ks.factId)
    }
  }

  const subjects = request.entityIds === undefined ? null : new Set<string>(request.entityIds)
  const result: TemporalFact[] = []
  for (const fact of state.facts.values()) {
    if (fact.status === 'rejected') continue
    if (fact.validFrom > request.chapter) continue
    if (fact.validUntil !== null && fact.validUntil < request.chapter) continue
    if (subjects !== null && !subjects.has(fact.subject)) continue
    if (isSecretPredicate(fact.predicate) && !authorizedSecrets.has(fact.id)) continue
    result.push(fact)
  }
  return result.sort((a, b) => a.validFrom - b.validFrom || (a.id < b.id ? -1 : 1))
}

/**
 * 认知视角查询（ADR-0026 · Task 7）：某视角在某章的 suspects/believes 知识面。
 * queryActiveFacts 只给 knows 授权的权威事实；本查询补出「怀疑/信念」两条
 * 非权威通道，供上下文装配器以限定语义呈现：
 *   - suspects → 「CHARACTER SUSPECTS: <proposition>; do not narrate or act as
 *     confirmed knowledge.」
 *   - believes → 呈现所信命题；有 distortion 时呈现畸变而非真相比照。
 * 返回的是事实 id + 层级 + 建议呈现文本的机械投影；是否入上下文由装配预算裁决。
 */
export interface KnowledgePerspectiveEntry {
  readonly factId: FactId
  readonly level: 'suspects' | 'believes'
  readonly holder: KnowledgeHolder
  /** 建议呈现文本（suspects 带限定后缀；believes 有畸变时呈现畸变）。 */
  readonly presentation: string
}

export function queryKnowledgePerspective(
  state: Pick<NarrativeStateSnapshot, 'facts' | 'knowledgeStates'>,
  request: QueryActiveFactsRequest,
): KnowledgePerspectiveEntry[] {
  assertQueryRequest(request)
  const out: KnowledgePerspectiveEntry[] = []
  for (const ks of state.knowledgeStates.values()) {
    if (ks.holder !== request.pov) continue
    if (ks.knownSinceChapter > request.chapter) continue
    if (ks.level !== 'suspects' && ks.level !== 'believes') continue
    const fact = state.facts.get(ks.factId)
    const proposition =
      fact !== undefined && fact.validFrom <= request.chapter
        ? fact.predicate + ':' + String(fact.value ?? '')
        : ks.factId
    if (ks.level === 'suspects') {
      out.push({
        factId: ks.factId,
        level: 'suspects',
        holder: ks.holder,
        presentation: `CHARACTER SUSPECTS: ${proposition}; do not narrate or act as confirmed knowledge.`,
      })
    } else {
      const believed = ks.distortion !== undefined ? ks.distortion : proposition
      out.push({
        factId: ks.factId,
        level: 'believes',
        holder: ks.holder,
        presentation: `CHARACTER BELIEVES: ${believed}（如与正典冲突，以信念为准呈现，不陈真相）.`,
      })
    }
  }
  return out
}

/* ----------------------------------------------------------------------------
 * T6：I1 追踪流保护门禁 + I3 知识状态级联失效查询
 * -------------------------------------------------------------------------- */

/**
 * 追踪流保护门禁（T6 / I1）：protectedUserContent = true 的事实行是作者亲笔
 * 正典断言，自动化通道（origin = ai | external 的增量来源）不得以同 id 行取代。
 * 作者修订自己的断言（author → author）始终合法。四族之中仅 TemporalFact
 * 携带 provenance，故本门禁只作用于事实流；其余三族的行语义校验归各自实现票。
 */
export function assertNoProtectedSupersession(
  liveFacts: ReadonlyMap<FactId, TemporalFact>,
  incoming: readonly TemporalFact[],
): void {
  for (const row of incoming) {
    const live = liveFacts.get(row.id)
    if (live === undefined || !live.provenance.protectedUserContent) {
      continue
    }
    if (row.provenance.origin !== 'author') {
      throw new ProtectedContentViolationError(
        'temporalFact',
        row.id,
        `live row is protectedUserContent (origin=${live.provenance.origin}); '${row.provenance.origin}' automation channels may not supersede it (I1)`,
      )
    }
  }
}

/**
 * 知识状态级联失效读路径（T6 / I3 / Q11）：KnowledgeState 行无自有生命周期，
 * 引用事实进入 rejected 的那一刻这些认知行即告失效——本查询把失效面显式
 * 可视化（UI 重验清单 / 影响报告的直接输入），按 id 确定序返回。
 * 折叠视图里被取代的旧行天然不出现：失效只看当前活跃事实状态。
 */
export function invalidatedKnowledgeStates(state: NarrativeStateSnapshot): KnowledgeState[] {
  const rejected = new Set<FactId>()
  for (const fact of state.facts.values()) {
    if (fact.status === 'rejected') {
      rejected.add(fact.id)
    }
  }
  const result: KnowledgeState[] = []
  for (const ks of state.knowledgeStates.values()) {
    if (rejected.has(ks.factId)) {
      result.push(ks)
    }
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : 1))
}
