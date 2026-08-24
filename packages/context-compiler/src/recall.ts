/**
 * 关键词 + k-hop + embedding 三通道召回算子（实现票 #21 / T8a、#24 / T8b-2）。
 *
 * 冻结依据：docs/specs/khop-graph-recall-spec.md（#12）· ADR-0022 ·
 * token-budget-assembly-spec §候选契约（#8）· entity-directory-spec §5 检测接线（#13）。
 *
 * 管线位置：
 *   草稿文本 ──detectKeywordTriggers──▶ 触发集 T ─┐
 *   canon 快照 ──khopGraphRecall─────────────────┼─▶ mergeRecallChannels ─▶ RecallResult
 *   可见语料 ──embeddingRecall（T8b 兜底）───────┘      {candidates, excluded}
 *
 * 检测扫描面（T10a #26 增补）：keywordScanFace 可裁剪 keyword 通道的卡输入面
 * （detectedOff 档跳过别名检测）；图/embedding 语料恒为全量卡面——实体 id 直引，
 * 不消费别名表（entity-directory-spec §5）。
 *
 * 本模块零 IO、零 LLM：输入是已折叠的 NarrativeStateSnapshot 与目录卡扫描面，
 * 输出 #8 装配的直接消费契约。确定性纪律（INV-K4）：一切平局显式收口——
 * 分数降序后 id 升序（ULID ASC）、跨通道精确平局走 merge.priority、
 * excluded 记录按 identifier 收口；同 canon 同输入必得同结果。
 *
 * 阈值口径（spec §5/G2 的实现级钉死）：threshGraph 作用于「到达路径的边权积」
 * （rel→w_rel×strength、fact_ref→w_factref×桥接重要度、event→w_event），不乘
 * w_hop——否则默认权重下 event(0.5)×h2(0.5)=0.25 恒低于 0.30，event 边在候选侧
 * 系统性死亡，违背「三类边恒开二跳」的裁决意图；relevanceScore 终分仍乘 h2。
 * 阈值淘汰由图通道在多路径收敛后施加（各通道阈值先于合并施加），淘汰记录经
 * 合并器做跨通道救援抑制（他通道救回者不记淘汰）。
 *
 * 打分口径（规格 §6 的两处实现级细化，代码与测试同步钉死）：
 *   - 触发自身事实（hops=1）：路径只含「主体挂载」不含边 ⇒ 不乘 w_type，
 *     score = w_importance(事实) × h1；
 *   - 邻域事实（hops=2）：score = 到达邻居的最优路径边权 × h2，其中
 *     路径边权 = w_type × w_impact(边宿主)：rel→max(relStrengthFloor,|affinity|/100)、
 *     fact_ref→桥接事实 importance、event→1（TimelineEvent 无 importance 字段，
 *     保持最简）；同一邻居多类边并行取最大权重，数值平局按 rel>fact_ref>event 先到先得；
 *   - 触发实体卡由图通道以 score=1.0、hops=1 发出（触发自身是零距离强关联，
 *     与 keyword 主名命中的精确平局由 merge.priority keyword>graph_khop 收口）；
 *   - embedding 通道（T8b-2）：score = clamp01(内积)——provider 契约已 L2 归一化，
 *     内积即 cosine；阈值 config.embedding.thresh 仅作入选门（spec §6/T9 R3：
 *     相对排序优先于绝对值），语料 = POV 可见子图事实 + 目录卡（brief 缺省回退
 *     name，双空不入语料）——G0 单一门禁点跨通道同构，strict 滤除者零候选
 *     （INV-K1 不因兜底软化）；子阈值条目从未成为候选，不记 excluded
 *     （记录范围裁决与 cap 落选同类）。
 */
import type {
  ActivationEvidence,
  AssemblyChannel,
  AliasRule,
  EntityRef,
  FactImportance,
  NarrativeStateSnapshot,
  ParseFailure,
  PovEntity,
  RelationshipState,
  TemporalFact,
  TimelineEvent,
} from '@mozhou/kernel'
import { detectEntityMentions, isSecretPredicate } from '@mozhou/kernel'
import type { LocalEmbeddingProvider } from './embedding.js'

/* ----------------------------------------------------------------------------
 * 配置（khop-graph-recall-spec §2 默认表；入 configVersion 参与 recomputationHash）
 * -------------------------------------------------------------------------- */

export interface KhopRecallWeightsConfig {
  readonly edgeType: { readonly rel: number; readonly fact_ref: number; readonly event: number }
  readonly importance: Record<FactImportance, number>
  /** h1=触发自身材料；h2=邻域材料（spec：触发自身=1 跳，邻域=2 跳）。 */
  readonly hop: { readonly h1: number; readonly h2: number }
  readonly relStrengthFloor: number
}

export interface KeywordScoringConfig {
  readonly primaryNameScore: number
  readonly aliasScore: number
  readonly mentionBoost: { readonly step: number; readonly cap: number }
}

export interface EmbeddingRecallConfig {
  /**
   * cosine 相似度入选门。历史：0.80 为 T9 R3 起步值（bge 分布集中 [0.6,1] 的
   * 保守猜测）；2026-08-24 经自有语料标定（scripts/embedding-calib/calibrate.mjs，
   * 报告 docs/research/embedding-threshold-calibration.md）实测 Youden J 最优
   * t*=0.46——0.80 下 TPR=0（通道全灭），故默认值改判 0.46。
   * 入 configVersion 参与 recomputationHash。
   */
  readonly thresh: number
}

export interface KhopRecallConfig {
  /** 永久封顶 2（ADR-0022：条件触发已裁决否决；字段保留进 configVersion）。 */
  readonly maxHop: number
  /** 一参两用：每实体每跳的候选产出宽度与出边扩展宽度。 */
  readonly branchCap: number
  /** 图通道全局候选上限（触发卡豁免，INV-K2）。 */
  readonly khopCap: number
  /** 非触发来源条目的分数门槛。 */
  readonly threshGraph: number
  readonly weights: KhopRecallWeightsConfig
  readonly keyword: KeywordScoringConfig
  readonly embedding: EmbeddingRecallConfig
}

export const DEFAULT_KHOP_RECALL_CONFIG: KhopRecallConfig = {
  maxHop: 2,
  branchCap: 10,
  khopCap: 40,
  threshGraph: 0.3,
  weights: {
    edgeType: { rel: 0.9, fact_ref: 0.7, event: 0.5 },
    importance: { critical: 1.0, notable: 0.7, trivial: 0.3 },
    hop: { h1: 1.0, h2: 0.5 },
    relStrengthFloor: 0.3,
  },
  keyword: {
    primaryNameScore: 1.0,
    aliasScore: 0.85,
    mentionBoost: { step: 0.05, cap: 0.15 },
  },
  embedding: { thresh: 0.46 },
}

/** 精确平局收口序（spec §2 merge.priority；未知通道排其后保持入参序）。 */
const MERGE_PRIORITY: readonly AssemblyChannel[] = ['manual_pin', 'keyword', 'graph_khop', 'embedding']

/* ----------------------------------------------------------------------------
 * 结果形状（#8 消费契约）
 * -------------------------------------------------------------------------- */

/** tier 词表（khop-graph-recall-spec §8 受控增补表；promise 两档本票不产）。 */
export type RecallTier = 'entity_card' | 'world_rule' | 'active_fact' | 'distant_recall' | 'promise_due'

export interface RecalledCandidate {
  /** FactId（ULID）或 EntityRef（目录卡）。 */
  readonly id: string
  readonly tier: RecallTier
  readonly channel: AssemblyChannel
  /** ∈[0,1]（各通道公式自带 clamp）。 */
  readonly relevanceScore: number
  readonly pinned?: boolean
  readonly atomicOverride?: boolean
  /** 胜出通道证据（AC③：raw 分 max 合并记胜出证据；ReceiptEntry.activation 的上游）。 */
  readonly activation?: ActivationEvidence
  /** 条目正文面（v1：卡=brief 缺省空串；事实=`subject predicate=value` 行渲染；
   *  渲染格式所有权随 #8 接线票据演进）。 */
  readonly content: string
}

export interface RecallExclusion {
  readonly identifier: string
  readonly reason: 'pov_filtered' | 'interval_not_active' | 'relevance_below_threshold' | 'duplicate'
  readonly channel?: AssemblyChannel
}

export interface RecallResult {
  readonly candidates: readonly RecalledCandidate[]
  readonly excluded: readonly RecallExclusion[]
  /** 解析失败逐条记录（T9 #25）：各通道前置解析失败的原样合并（通道序），逐条独立——
   *  每个失败引用一条 {source, detail}，不聚合计数；装配端原样落 Receipt.parseFailures。 */
  readonly parseFailures: readonly ParseFailure[]
}

/* ----------------------------------------------------------------------------
 * keyword 快通道（别名/正则；匹配内核复用 @mozhou/kernel detectEntityMentions）
 * -------------------------------------------------------------------------- */

/** 目录卡检测面的最小结构（data-plane EntityCardScan 结构性满足）。 */
export interface RecallEntityCard {
  readonly ref: EntityRef
  readonly name: string
  readonly aliases?: readonly AliasRule[]
  readonly excludedPhrases?: readonly string[]
  readonly brief?: string
}

export interface KeywordTrigger {
  readonly ref: EntityRef
  /** ∈[0,1]：主名/别名基分 + 提及加分，clamp 后。 */
  readonly score: number
  /** 命中的激活键（胜出规则文本；ActivationEvidence.keyword.keys 上游）。 */
  readonly keys: readonly string[]
}

export interface KeywordChannelResult {
  /** 已按 keyword 分数降序、ref 升序预处理（G1 序，直接喂图通道）。 */
  readonly triggers: readonly KeywordTrigger[]
  readonly parseFailures: readonly ParseFailure[]
}

interface Span {
  readonly start: number
  readonly end: number
}

function findExactSpans(haystack: string, needle: string, caseSensitive: boolean): Span[] {
  if (needle.length === 0) {
    return []
  }
  const hay = caseSensitive ? haystack : haystack.toLowerCase()
  const nee = caseSensitive ? needle : needle.toLowerCase()
  const spans: Span[] = []
  let from = 0
  for (;;) {
    const at = hay.indexOf(nee, from)
    if (at === -1) {
      return spans
    }
    spans.push({ start: at, end: at + nee.length })
    from = at + 1
  }
}

function findRegexSpans(haystack: string, pattern: string, caseSensitive: boolean): Span[] {
  const matcher = new RegExp(pattern, caseSensitive ? 'gu' : 'giu')
  const spans: Span[] = []
  for (const match of haystack.matchAll(matcher)) {
    if (match[0].length > 0 && match.index !== undefined) {
      spans.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return spans
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function compareDescScoreAscId(a: { id: string; relevanceScore: number }, b: { id: string; relevanceScore: number }): number {
  return b.relevanceScore - a.relevanceScore || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const compareFactEntry = (
  a: { readonly fact: TemporalFact; readonly score: number },
  b: { readonly fact: TemporalFact; readonly score: number },
): number => compareDescScoreAscId({ id: a.fact.id, relevanceScore: a.score }, { id: b.fact.id, relevanceScore: b.score })

/**
 * keyword 快通道：别名/正则检测（exact 全串优先、regex 兜底、卡级排除词压制，
 * 数组顺序即优先级——匹配内核为 kernel detectEntityMentions 冻结语义）+ 打分成形。
 *
 * 主名识别：建卡时 name 自动入 aliases 首位（作者可删）——检测前把 name 作为
 * 首位 virtual exact 规则并入规则数组，胜出规则下标 0 ⇒ primaryNameScore，
 * 其余 ⇒ aliasScore；提及加分按「胜出规则的未被排除压制的出现次数」计
 * （entity-directory-spec Q3 压制语义的镜像），boost=min(cap, step×(n−1))。
 *
 * 非法 regex 别名不炸通道：预校验剔除并记 parseFailures（Receipt 字段③上游）。
 */
export function detectKeywordTriggers(
  cards: readonly RecallEntityCard[],
  text: string,
  config: KhopRecallConfig,
): KeywordChannelResult {
  const parseFailures: ParseFailure[] = []
  const triggers: KeywordTrigger[] = []

  for (const card of cards) {
    const nameRule: AliasRule = { text: card.name, kind: 'exact' }
    const nameFirst = card.name.length > 0
    const rawRules: readonly AliasRule[] = nameFirst ? [nameRule, ...(card.aliases ?? [])] : (card.aliases ?? [])

    // regex 预校验：非法模式剔除记失败，防检测内核抛错中断整书扫描
    const rules: AliasRule[] = []
    for (const [index, rule] of rawRules.entries()) {
      if (rule.kind !== 'regex') {
        rules.push(rule)
        continue
      }
      try {
        new RegExp(rule.text, rule.caseSensitive ?? false ? 'u' : 'iu')
        rules.push(rule)
      } catch (error) {
        parseFailures.push({
          source: `${card.ref} aliases[${index}]`,
          detail: `invalid regex: ${(error as Error).message}`,
        })
      }
    }
    if (rules.length === 0) {
      continue
    }

    const [mention] = detectEntityMentions(
      [{ ref: card.ref, aliases: rules, excludedPhrases: card.excludedPhrases ?? [] }],
      text,
    )
    if (mention === undefined) {
      continue
    }

    // 提及计数：胜出规则在文中的出现 span，经排除词压制后存活数（Q3 镜像语义）
    const winningRule = rules[mention.aliasIndex]!
    const excludedSpans: Span[] = []
    for (const phrase of card.excludedPhrases ?? []) {
      excludedSpans.push(...findExactSpans(text, phrase, false))
    }
    const occurrences =
      winningRule.kind === 'regex'
        ? findRegexSpans(text, winningRule.text, winningRule.caseSensitive ?? false)
        : findExactSpans(text, winningRule.text, winningRule.caseSensitive ?? false)
    const mentionCount = occurrences.filter((span) => !excludedSpans.some((excluded) => overlaps(span, excluded))).length

    const base = nameFirst && mention.aliasIndex === 0 ? config.keyword.primaryNameScore : config.keyword.aliasScore
    const boost = Math.min(config.keyword.mentionBoost.cap, config.keyword.mentionBoost.step * (mentionCount - 1))
    triggers.push({
      ref: card.ref,
      score: clamp01(base + boost),
      keys: [winningRule.text],
    })
  }

  triggers.sort((a, b) => b.score - a.score || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  return { triggers, parseFailures }
}

/* ----------------------------------------------------------------------------
 * k-hop 图通道（POV 可见子图；G0 门禁 → G1 触发层 → G2 邻域扩展 → G3 收口）
 * -------------------------------------------------------------------------- */

export interface GraphRecallScope {
  readonly chapterIndex: number
  readonly pov: PovEntity
}

/** 图通道产出条目（阈值已在通道内施加：非豁免条目的路径边权积 ≥ threshGraph）。 */
export interface GraphRecallEntry {
  readonly id: string
  readonly tier: RecallTier
  readonly relevanceScore: number
  readonly activation: Extract<ActivationEvidence, { kind: 'graph_khop' }>
  readonly content: string
  readonly atomicOverride?: boolean
}

export interface GraphRecallResult {
  readonly entries: readonly GraphRecallEntry[]
  readonly exclusions: readonly RecallExclusion[]
}

const ENTITY_VALUE_PATTERN = /^(char|item|location|faction|concept):[a-z0-9][a-z0-9-]*$/

interface VisibleCanon {
  /** POV 可见子图内的事实，按 subject 归组。 */
  readonly factsBySubject: ReadonlyMap<string, readonly TemporalFact[]>
  readonly relationships: readonly RelationshipState[]
  readonly events: readonly TimelineEvent[]
  /** 视角授权的秘密事实集合（secret.* 门禁行）。 */
  readonly authorizedSecrets: ReadonlySet<string>
}

/**
 * G0 子图过滤（单一门禁点，遍历与候选共用，INV-K1）：
 * confirmed ∧ 区间活跃 ∧ secret.* 需当前视角授权认知行（非秘密公开；
 * distortion 只改渲染不改门禁）。被滤事实同时失去候选资格与建桥资格。
 */
function buildVisibleCanon(snapshot: NarrativeStateSnapshot, scope: GraphRecallScope): VisibleCanon {
  const authorizedSecrets = new Set<string>()
  for (const ks of snapshot.knowledgeStates.values()) {
    if (ks.holder === scope.pov && ks.knownSinceChapter <= scope.chapterIndex) {
      authorizedSecrets.add(ks.factId)
    }
  }

  const factsBySubject = new Map<string, TemporalFact[]>()
  for (const fact of snapshot.facts.values()) {
    if (fact.status !== 'confirmed') {
      continue
    }
    if (fact.validFrom > scope.chapterIndex || (fact.validUntil !== null && fact.validUntil < scope.chapterIndex)) {
      continue
    }
    if (isSecretPredicate(fact.predicate) && !authorizedSecrets.has(fact.id)) {
      continue
    }
    const group = factsBySubject.get(fact.subject)
    if (group === undefined) {
      factsBySubject.set(fact.subject, [fact])
    } else {
      group.push(fact)
    }
  }

  const relationships: RelationshipState[] = []
  for (const rel of snapshot.relationships.values()) {
    if (rel.validFrom <= scope.chapterIndex && (rel.validUntil === null || rel.validUntil >= scope.chapterIndex)) {
      relationships.push(rel)
    }
  }
  return { factsBySubject, relationships, events: [...snapshot.timelineEvents.values()], authorizedSecrets }
}

function factTier(fact: TemporalFact): RecallTier {
  if (fact.compactedIntoVolumeId !== null) {
    return 'distant_recall'
  }
  return fact.subject.startsWith('concept:') ? 'world_rule' : 'active_fact'
}

function factContent(fact: TemporalFact): string {
  return `${fact.subject} ${fact.predicate}=${String(fact.value)}`
}

function importanceWeight(config: KhopRecallConfig, importance: FactImportance): number {
  return config.weights.importance[importance]
}

function relStrength(config: KhopRecallConfig, affinityScore: number): number {
  return Math.max(config.weights.relStrengthFloor, Math.abs(affinityScore) / 100)
}

/**
 * k-hop 图召回本体（伪代码级对应 spec §5 G0-G3）。
 *
 * 记录范围裁决（Receipt 噪声控制）：仅触发层材料被区间/POV 滤除者发射
 * excluded（判定优先级：区间 → POV → 状态静默）；二跳静默跳过、
 * branchCap/khopCap 落选者不记录；阈值淘汰统一在合并阶段发射。
 *
 * @param cardBriefs 触发卡正文面（brief 缺省回退归装配侧；缺图时内容为空串）。
 */
export function khopGraphRecall(
  snapshot: NarrativeStateSnapshot,
  triggers: readonly KeywordTrigger[],
  scope: GraphRecallScope,
  config: KhopRecallConfig,
  cardBriefs?: ReadonlyMap<string, string>,
): GraphRecallResult {
  const orderedTriggers = [...triggers].sort(
    (a, b) => b.score - a.score || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
  )
  if (orderedTriggers.length === 0) {
    return { entries: [], exclusions: [] }
  }

  const canon = buildVisibleCanon(snapshot, scope)
  const triggerRefs = new Set(orderedTriggers.map((t) => t.ref))

  // 触发层被滤材料的诊断记录（区间 → POV → 状态静默）
  const exclusions: RecallExclusion[] = []
  for (const fact of snapshot.facts.values()) {
    if (!triggerRefs.has(fact.subject)) {
      continue
    }
    if (fact.status !== 'confirmed') {
      continue // 计划/未验证非正典是预期行为，无诊断价值，静默
    }
    if (fact.validFrom > scope.chapterIndex || (fact.validUntil !== null && fact.validUntil < scope.chapterIndex)) {
      exclusions.push({ identifier: fact.id, reason: 'interval_not_active', channel: 'graph_khop' })
      continue
    }
    if (isSecretPredicate(fact.predicate) && !canon.authorizedSecrets.has(fact.id)) {
      exclusions.push({ identifier: fact.id, reason: 'pov_filtered', channel: 'graph_khop' })
    }
  }
  exclusions.sort((a, b) => (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0))

  // 多路径收敛累积器：score 取最大路径积；sourceEntity 取产生最大分的触发根；
  // 平局取 G1 序靠前者（orderedTriggers 序遍历 + 严格大于替换即天然成立）；
  // pathWeight = 胜出路径的边权积（阈值裁决基准，不含 w_hop）。
  interface Accumulation {
    readonly entry: GraphRecallEntry
    readonly pathWeight: number
    readonly thresholdExempt: boolean
  }
  const accumulated = new Map<string, Accumulation>()

  const emitFact = (
    fact: TemporalFact,
    score: number,
    pathWeight: number,
    hops: 1 | 2,
    sourceEntity: EntityRef,
    thresholdExempt: boolean,
  ): void => {
    const clamped = clamp01(score)
    const next: Accumulation = {
      entry: {
        id: fact.id,
        tier: factTier(fact),
        relevanceScore: clamped,
        activation: { kind: 'graph_khop', sourceEntity, hops, score: clamped },
        content: factContent(fact),
      },
      pathWeight,
      thresholdExempt,
    }
    const existing = accumulated.get(fact.id)
    if (existing === undefined) {
      accumulated.set(fact.id, next)
      return
    }
    if (clamped > existing.entry.relevanceScore) {
      // 豁免是到达路径的 OR：一跳到达过即豁免，胜出路径只改分与证据
      accumulated.set(fact.id, { ...next, thresholdExempt: existing.thresholdExempt })
    } else if (thresholdExempt) {
      accumulated.set(fact.id, { ...existing, thresholdExempt: true })
    }
  }

  for (const trigger of orderedTriggers) {
    // ★ G1 触发卡硬必入（唯一容量豁免者，INV-K2）；score=1.0 见文件头打分口径
    if (!accumulated.has(trigger.ref)) {
      accumulated.set(trigger.ref, {
        entry: {
          id: trigger.ref,
          tier: 'entity_card',
          relevanceScore: 1.0,
          activation: { kind: 'graph_khop', sourceEntity: trigger.ref, hops: 1, score: 1.0 },
          content: cardBriefs?.get(trigger.ref) ?? '',
          atomicOverride: true,
        },
        pathWeight: Number.POSITIVE_INFINITY,
        thresholdExempt: true,
      })
    }

    // G1 自身事实：top-branchCap，免阈值免去重（多路径累积器天然去重），不免 branchCap
    const ownFacts = [...(canon.factsBySubject.get(trigger.ref) ?? [])]
      .map((fact) => ({
        fact,
        score: importanceWeight(config, fact.importance) * config.weights.hop.h1,
      }))
      .sort(compareFactEntry)
      .slice(0, config.branchCap)
    for (const { fact, score } of ownFacts) {
      emitFact(fact, score, Number.POSITIVE_INFINITY, 1, trigger.ref, true)
    }

    // G2 邻域扩展（二跳恒开一次）：三类边汇入，每邻居取最优路径权重
    const neighborPaths = new Map<string, { weight: number }>()
    const considerNeighbor = (neighbor: EntityRef, weight: number): void => {
      if (neighbor === trigger.ref) {
        return
      }
      const existing = neighborPaths.get(neighbor)
      // 数值平局保持先到（迭代序 rel → fact_ref → event 即类型优先序）
      if (existing === undefined || weight > existing.weight) {
        neighborPaths.set(neighbor, { weight })
      }
    }

    for (const rel of canon.relationships) {
      let other: EntityRef | null = null
      if (rel.entityA === trigger.ref) {
        other = rel.entityB
      } else if (rel.entityB === trigger.ref) {
        other = rel.entityA
      }
      if (other !== null) {
        considerNeighbor(other, config.weights.edgeType.rel * relStrength(config, rel.affinityScore))
      }
    }

    for (const bridge of canon.factsBySubject.get(trigger.ref) ?? []) {
      if (typeof bridge.value !== 'string' || !ENTITY_VALUE_PATTERN.test(bridge.value)) {
        continue // FactValue 标量纪律：整体匹配 EntityRef 文法才算引用
      }
      considerNeighbor(
        bridge.value as EntityRef,
        config.weights.edgeType.fact_ref * importanceWeight(config, bridge.importance),
      )
    }

    for (const event of canon.events) {
      if (!event.participants.includes(trigger.ref)) {
        continue
      }
      for (const participant of event.participants) {
        considerNeighbor(participant, config.weights.edgeType.event)
      }
      if (event.locationRef !== undefined) {
        considerNeighbor(event.locationRef, config.weights.edgeType.event)
      }
    }

    const neighbors = [...neighborPaths.entries()]
      .map(([ref, path]) => ({ ref, weight: path.weight }))
      .sort((a, b) => b.weight - a.weight || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
      .slice(0, config.branchCap)

    for (const neighbor of neighbors) {
      const neighborFacts = [...(canon.factsBySubject.get(neighbor.ref) ?? [])]
        .map((fact) => ({ fact, score: neighbor.weight * config.weights.hop.h2 }))
        .sort(compareFactEntry)
        .slice(0, config.branchCap)
      for (const { fact, score } of neighborFacts) {
        emitFact(fact, score, neighbor.weight, 2, trigger.ref, false)
      }
    }
  }

  // 阈值裁决（收敛后统一施加；豁免=触发卡+自身事实的一跳到达）
  const thresholdKills: RecallExclusion[] = []
  for (const [id, acc] of accumulated) {
    if (!acc.thresholdExempt && acc.pathWeight < config.threshGraph) {
      thresholdKills.push({ identifier: id, reason: 'relevance_below_threshold', channel: 'graph_khop' })
      accumulated.delete(id)
    }
  }

  // G3 全局收口：分数降序、id 升序取前 khopCap；触发卡豁免容量（INV-K2/K3）
  const all = [...accumulated.values()].map((acc) => acc.entry)
  const cards = all.filter((entry) => entry.tier === 'entity_card')
  const capped = all
    .filter((entry) => entry.tier !== 'entity_card')
    .sort(compareDescScoreAscId)
    .slice(0, config.khopCap)

  for (const killed of thresholdKills) {
    exclusions.push(killed)
  }
  exclusions.sort((a, b) => (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0))
  return { entries: [...cards, ...capped], exclusions }
}

/* ----------------------------------------------------------------------------
 * embedding 兜底通道（T8b-2）：G0 同构语料 + cosine 入选门（零 IO 之外零 LLM；
 * 推理委托 provider，本函数只裁语料、打分与收口）
 * -------------------------------------------------------------------------- */

export interface EmbeddingRecallInput {
  /** 查询文本（v1 = 草稿/场景原文）。 */
  readonly queryText: string
  readonly cards: readonly RecallEntityCard[]
  readonly snapshot: NarrativeStateSnapshot
  readonly scope: GraphRecallScope
  readonly provider: LocalEmbeddingProvider
}

/** embedding 通道产出条目（阈值已在通道内施加：cosine ≥ config.embedding.thresh）。 */
export interface EmbeddingRecallEntry {
  readonly id: string
  readonly tier: RecallTier
  readonly relevanceScore: number
  readonly activation: Extract<ActivationEvidence, { kind: 'embedding' }>
  readonly content: string
}

export interface EmbeddingRecallResult {
  /** 已按分数降序、id 升序收口（INV-K4）。 */
  readonly entries: readonly EmbeddingRecallEntry[]
}

function dotProduct(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`embedding 维度不匹配：query=${a.length} passage=${b.length}（provider 契约违约）`)
  }
  let dot = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
  }
  return dot
}

/**
 * embedding 兜底召回本体。
 *
 * 语料两族（spec §8 tier 表的直达面）：
 *   - 目录卡：passage = brief（缺省回退 name——空 brief 卡仍有语义身份；
 *     双空卡无语义面可嵌，不入语料），tier=entity_card（「embedding 直达亦入」）；
 *   - 事实：经 buildVisibleCanon 复用 G0 单一门禁点（confirmed ∧ 区间活跃 ∧
 *     secret.* 视角授权）——strict 滤除者不进语料，零软泄漏跨通道成立（INV-K1），
 *     「门禁滤除造成的漏召由兜底补位」补的是同子图内的语义可达性，不是被滤材料。
 *
 * 记录范围裁决：子阈值条目从未成为候选，不记 excluded（与 branchCap/khopCap
 * 落选同类）；跨通道救援靠「新增条目」生效，无需淘汰记录参与抑制。
 * 确定性（INV-K4）：同 provider 输出下逐维内积定序固定 ⇒ 同分；平局 id 升序。
 */
export async function embeddingRecall(
  input: EmbeddingRecallInput,
  config: KhopRecallConfig,
): Promise<EmbeddingRecallResult> {
  interface CorpusItem {
    readonly id: string
    readonly tier: RecallTier
    readonly text: string
    readonly content: string
  }
  const corpus: CorpusItem[] = []
  for (const card of input.cards) {
    const text = card.brief !== undefined && card.brief.length > 0 ? card.brief : card.name
    if (text.length === 0) {
      continue
    }
    corpus.push({ id: card.ref, tier: 'entity_card', text, content: card.brief ?? '' })
  }
  const canon = buildVisibleCanon(input.snapshot, input.scope)
  for (const group of canon.factsBySubject.values()) {
    for (const fact of group) {
      corpus.push({ id: fact.id, tier: factTier(fact), text: factContent(fact), content: factContent(fact) })
    }
  }
  if (corpus.length === 0 || input.queryText.length === 0) {
    return { entries: [] }
  }

  // 顺序推理：同一 ONNX session 不做并发假设，代价可忽略（单查询毫秒级）
  const queryVector = await input.provider.queryEmbed(input.queryText)
  const passageVectors = await input.provider.passageEmbed(corpus.map((item) => item.text))

  const entries: EmbeddingRecallEntry[] = []
  for (const [index, item] of corpus.entries()) {
    const similarity = clamp01(dotProduct(queryVector, passageVectors[index]!))
    if (similarity < config.embedding.thresh) {
      continue // 入选门（spec §6：阈值仅作门；相对排序交装配侧 desirability）
    }
    entries.push({
      id: item.id,
      tier: item.tier,
      relevanceScore: similarity,
      activation: { kind: 'embedding', score: similarity },
      content: item.content,
    })
  }
  entries.sort(compareDescScoreAscId)
  return { entries }
}

/* ----------------------------------------------------------------------------
 * 三通道合并：raw 分 max + 胜出证据 + duplicate ≡ identifier 撞车
 * -------------------------------------------------------------------------- */

export interface ChannelInput {
  readonly channel: AssemblyChannel
  readonly entries: readonly {
    readonly id: string
    readonly tier: RecallTier
    readonly relevanceScore: number
    readonly pinned?: boolean
    readonly atomicOverride?: boolean
    readonly activation?: ActivationEvidence
    readonly content: string
  }[]
  /** 通道侧前置淘汰记录（图通道的区间/POV/阈值透传；阈值先于合并施加）。 */
  readonly exclusions?: readonly RecallExclusion[]
  /** 通道侧解析失败逐条记录（T9 #25）：keyword 非法 regex 别名等，透传进 RecallResult。 */
  readonly parseFailures?: readonly ParseFailure[]
}

/**
 * 合并与去重（spec §7）：
 * - 阈值已由各通道在入参前施加（触发豁免只作用于图通道一跳）；
 * - 同 id 多通道命中收敛为一个候选：relevanceScore=max、pinned=OR、
 *   证据记胜出通道，精确平局按 merge.priority 收口（严格大于替换 + 优先序遍历）；
 * - 通道淘汰记录的跨通道救援抑制：该 id 最终进入候选集 ⇒ 淘汰记录撤销；
 * - duplicate ≡ identifier 撞车的防御性记录：单通道内重复提交同 id 即撞车
 *   （正常路径通道各自内部去重 ⇒ 恒 0 次，INV-K5），收敛照常进行。
 */
export function mergeRecallChannels(channels: readonly ChannelInput[]): RecallResult {
  const priorityOf = (channel: AssemblyChannel): number => {
    const at = MERGE_PRIORITY.indexOf(channel)
    return at === -1 ? MERGE_PRIORITY.length : at
  }
  const ordered = [...channels].sort((a, b) => priorityOf(a.channel) - priorityOf(b.channel))

  const merged = new Map<string, RecalledCandidate>()
  const pinnedAccumulator = new Set<string>()
  const atomicAccumulator = new Set<string>()
  const duplicates: RecallExclusion[] = []

  for (const channel of ordered) {
    const seenInChannel = new Set<string>()
    for (const entry of channel.entries) {
      if (seenInChannel.has(entry.id)) {
        duplicates.push({ identifier: entry.id, reason: 'duplicate', channel: channel.channel })
      } else {
        seenInChannel.add(entry.id)
      }

      // pinned / atomicOverride 是条目自身属性（作者意志 / 原子性），随任意通道到达即 OR 合并
      if (entry.pinned === true) {
        pinnedAccumulator.add(entry.id)
      }
      if (entry.atomicOverride === true) {
        atomicAccumulator.add(entry.id)
      }

      const existing = merged.get(entry.id)
      if (existing === undefined) {
        merged.set(entry.id, {
          id: entry.id,
          tier: entry.tier,
          channel: channel.channel,
          relevanceScore: entry.relevanceScore,
          ...(entry.activation === undefined ? {} : { activation: entry.activation }),
          content: entry.content,
        })
      } else if (entry.relevanceScore > existing.relevanceScore) {
        // 胜出通道换座：证据/通道/tier/content 随胜者走；pinned/atomic 由累加器统一 OR
        merged.set(entry.id, {
          ...existing,
          tier: entry.tier,
          channel: channel.channel,
          relevanceScore: entry.relevanceScore,
          ...(entry.activation === undefined ? {} : { activation: entry.activation }),
          content: entry.content,
        })
      }
    }
  }

  const candidates = [...merged.values()]
    .map((candidate) => {
      let withFlags = candidate
      if (pinnedAccumulator.has(candidate.id) && candidate.pinned !== true) {
        withFlags = { ...withFlags, pinned: true }
      }
      if (atomicAccumulator.has(candidate.id) && candidate.atomicOverride !== true) {
        withFlags = { ...withFlags, atomicOverride: true }
      }
      return withFlags
    })
    .sort(compareDescScoreAscId)

  // 淘汰记录的跨通道救援抑制：id 最终进入候选集 ⇒ 其一切淘汰记录撤销
  //（区间/POV 滤除的 id 不可能复活，此过滤只对阈值淘汰的救援路径生效）
  const survived = new Set(candidates.map((candidate) => candidate.id))
  const excluded = [
    ...channels.flatMap((channel) => (channel.exclusions ?? []).filter((e) => !survived.has(e.identifier))),
    ...duplicates,
  ].sort(
    (a, b) =>
      (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0) ||
      (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  )

  // 解析失败逐条透传（T9 #25）：按通道入参序原样拼接，不排序不去重——
  // 每个失败引用保持独立记录项，source/detail 语义归产生通道所有。
  const parseFailures = channels.flatMap((channel) => channel.parseFailures ?? [])

  return { candidates, excluded, parseFailures }
}

/* ----------------------------------------------------------------------------
 * 三通道端到端接线（keyword + graph_khop 恒跑；embedding 由 provider 注入启用）
 * -------------------------------------------------------------------------- */

export interface RecallPipelineInput {
  readonly draftText: string
  readonly cards: readonly RecallEntityCard[]
  readonly snapshot: NarrativeStateSnapshot
  readonly scope: GraphRecallScope
  readonly config?: KhopRecallConfig
  /** 提供即启用 embedding 兜底第三通道；缺省仅 keyword+graph 双通道（三通道互不阻塞）。 */
  readonly embedding?: LocalEmbeddingProvider
  /**
   * 检测扫描面裁剪（T10a #26 四档激活接线）：提供时仅集合内 ref 的卡参与 keyword
   * 别名检测（detectedOff 档跳过检测——别名表不被消费）；图/embedding 语料不受影响
   * （实体 id 直引，本就不消费别名表——entity-directory-spec §5）。缺省全卡可检。
   */
  readonly keywordScanFace?: ReadonlySet<EntityRef>
}

/** 召回管线一站式入口：keyword 快通道 + k-hop 图通道（+ 可选 embedding 兜底）合并。 */
export async function recallCandidates(input: RecallPipelineInput): Promise<RecallResult> {
  const config = input.config ?? DEFAULT_KHOP_RECALL_CONFIG
  const scanFace = input.keywordScanFace
  const detectionFace = scanFace === undefined ? input.cards : input.cards.filter((card) => scanFace.has(card.ref))
  const keyword = detectKeywordTriggers(detectionFace, input.draftText, config)
  const graph = khopGraphRecall(
    input.snapshot,
    keyword.triggers,
    input.scope,
    config,
    new Map(input.cards.map((card) => [card.ref, card.brief ?? ''])),
  )

  const keywordEntries = keyword.triggers.map((trigger) => {
    const card = input.cards.find((candidate) => candidate.ref === trigger.ref)
    return {
      id: trigger.ref,
      tier: 'entity_card' as const,
      relevanceScore: trigger.score,
      activation: { kind: 'keyword' as const, keys: trigger.keys },
      content: card?.brief ?? '',
    }
  })

  const channels: ChannelInput[] = [
    { channel: 'keyword', entries: keywordEntries, parseFailures: keyword.parseFailures },
    { channel: 'graph_khop', entries: graph.entries, exclusions: graph.exclusions },
  ]
  if (input.embedding !== undefined) {
    const fallback = await embeddingRecall(
      {
        queryText: input.draftText,
        cards: input.cards,
        snapshot: input.snapshot,
        scope: input.scope,
        provider: input.embedding,
      },
      config,
    )
    channels.push({ channel: 'embedding', entries: fallback.entries })
  }

  return mergeRecallChannels(channels)
}
