/**
 * 卷边界状态压缩（State Compaction）纯函数域（US#8 · ADR-0011 · ADR-0019 #3）。
 *
 * 三层拆分（按"事务系统"实现，不是加一个 summarize 按钮）：
 *   1. planVolumeCompaction()——纯筛选：完结卷内 validUntil 已过期、非 critical、
 *      非保护位、无活跃引用（KnowledgeState / TimelineEvent 活跃行）的微事实
 *      候选集 + 逐条排除原因（确定性审计面）。ADR-0011 折叠规则：
 *      `valid_until <= VolumeEnd 且 importance ≠ critical`。
 *   2. buildVolumeSummaryPrompt() / validateVolumeSummary()——LLM 摘要的确定性
 *      输入与完整性下限门（ADR-0019 #3：长程压缩只许 LLM 摘要、禁关键词抽取；
 *      LLM 判断力归注入端口，本模块只做可机检的完整性校验）。
 *   3. buildCompactedFactRow()——压缩标记行的冻结形状构造（I6 行保留纪律：
 *      同 id 末行胜出，原行永不物理删除；Q14 事务性 revision +1）。
 *
 * 零依赖纯函数域：无 IO、无时钟——时间戳由调用方注入（protection.ts 先例）。
 * 事务 IO 半边归 @mozhou/data-plane/src/compaction.ts（journal → 追加 → 回执）。
 */
import type {
  EntityRef,
  FactId,
  TemporalFact,
  VolumeNodeId,
} from './kernel-schema.js'
import type { NarrativeStateSnapshot } from './narrative-state.js'
import { ProtectedContentViolationError } from './protection.js'

/* ----------------------------------------------------------------------------
 * 错误
 * -------------------------------------------------------------------------- */

/** 压缩纯函数域输入违例：参数形状/取值非法（宁败不脏）。 */
export class VolumeCompactionInputError extends Error {
  override readonly name = 'VolumeCompactionInputError'

  constructor(detail: string) {
    super(`volume compaction input violation: ${detail}`)
  }
}

/* ----------------------------------------------------------------------------
 * 1. planVolumeCompaction —— 候选筛选（纯函数）
 * -------------------------------------------------------------------------- */

/** 排除原因词表（确定性、互斥；首条命中即定因，顺序即裁决序）。 */
export type CompactionExclusionReason =
  | 'already_compacted'
  | 'not_confirmed'
  | 'interval_still_active_or_unbounded'
  | 'importance_critical'
  | 'protected_user_content'
  | 'active_knowledge_reference'
  | 'active_timeline_reference'

export interface CompactionExclusion {
  readonly factId: FactId
  readonly reason: CompactionExclusionReason
}

export interface VolumeCompactionPlan {
  readonly volumeNodeId: VolumeNodeId
  /** 卷末章索引（含端点）：validUntil ≤ 此值的终态微事实才可折叠（ADR-0011）。 */
  readonly volumeEndChapter: number
  /** 候选微事实，按 factId 字典序升序（ULID = 时间序，输出确定性）。 */
  readonly candidates: readonly TemporalFact[]
  /** 被排除事实及原因，按 factId 字典序升序（审计面）。 */
  readonly exclusions: readonly CompactionExclusion[]
}

export interface PlanVolumeCompactionInput {
  readonly volumeNodeId: VolumeNodeId
  readonly volumeEndChapter: number
  readonly snapshot: NarrativeStateSnapshot
}

/**
 * 卷压缩计划（纯筛选，零副作用）。
 *
 * 裁决序（首条命中即定因，保证同输入同输出）：
 *   already_compacted → not_confirmed → interval_still_active_or_unbounded
 *   → importance_critical → protected_user_content（I1）
 *   → active_knowledge_reference → active_timeline_reference
 *
 * "仍有活跃引用"= 当前活跃视图（折叠后）中存在引用该事实的 KnowledgeState 行
 * 或 TimelineEvent 行（impactFactIds）。伏笔流不引用事实 id（NarrativePromise
 * 无 factId 字段），不构成活跃引用。
 */
export function planVolumeCompaction(input: PlanVolumeCompactionInput): VolumeCompactionPlan {
  const { volumeNodeId, snapshot } = input
  const volumeEndChapter = input.volumeEndChapter
  if (!Number.isSafeInteger(volumeEndChapter) || volumeEndChapter < 1) {
    throw new VolumeCompactionInputError(`volumeEndChapter must be an integer >= 1, got ${volumeEndChapter}`)
  }

  const knowledgeReferenced = new Set<FactId>()
  for (const ks of snapshot.knowledgeStates.values()) {
    knowledgeReferenced.add(ks.factId)
  }
  const timelineReferenced = new Set<FactId>()
  for (const event of snapshot.timelineEvents.values()) {
    for (const factId of event.impactFactIds) {
      timelineReferenced.add(factId)
    }
  }

  const candidates: TemporalFact[] = []
  const exclusions: CompactionExclusion[] = []
  for (const fact of snapshot.facts.values()) {
    if (fact.compactedIntoVolumeId !== null) {
      exclusions.push({ factId: fact.id, reason: 'already_compacted' })
      continue
    }
    if (fact.status !== 'confirmed') {
      exclusions.push({ factId: fact.id, reason: 'not_confirmed' })
      continue
    }
    // ADR-0011：终态微事实 = validUntil 非空且 ≤ 卷末章；无界事实（null）永不折叠。
    if (fact.validUntil === null || fact.validUntil > volumeEndChapter) {
      exclusions.push({ factId: fact.id, reason: 'interval_still_active_or_unbounded' })
      continue
    }
    if (fact.importance === 'critical') {
      exclusions.push({ factId: fact.id, reason: 'importance_critical' })
      continue
    }
    if (fact.provenance.protectedUserContent) {
      exclusions.push({ factId: fact.id, reason: 'protected_user_content' })
      continue
    }
    if (knowledgeReferenced.has(fact.id)) {
      exclusions.push({ factId: fact.id, reason: 'active_knowledge_reference' })
      continue
    }
    if (timelineReferenced.has(fact.id)) {
      exclusions.push({ factId: fact.id, reason: 'active_timeline_reference' })
      continue
    }
    candidates.push(fact)
  }

  const byFactId = (a: { readonly factId: FactId }, b: { readonly factId: FactId }): number =>
    a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  exclusions.sort(byFactId)
  return { volumeNodeId, volumeEndChapter, candidates, exclusions }
}

/* ----------------------------------------------------------------------------
 * 2. 摘要 prompt 与完整性校验（ADR-0019 #3：LLM-only 的确定性护栏半边）
 * -------------------------------------------------------------------------- */

/** 卷摘要字数上限（防失控输出；超出即拒，宁可重试不落盘）。 */
export const VOLUME_SUMMARY_MAX_CHARS = 8000

export type VolumeSummaryFailureCode = 'empty_summary' | 'length_overflow' | 'subject_not_covered'

export interface VolumeSummaryFailure {
  readonly code: VolumeSummaryFailureCode
  readonly detail: string
}

/**
 * 卷摘要完整性下限校验（确定性，零 LLM）：
 *   - 非空（trim 后至少 1 字符）；
 *   - 不超长（≤ maxChars，防失控输出）；
 *   - 主体覆盖：每个候选事实的 subject 引用必须以完整字面（如 `char:lin-xuan`）
 *     出现至少一次——这是可机检的完整性下限，不是质量评判；语义质量归注入端口
 *     的模型与上游重试策略。缺一即拒，摘要绝不带缺口落盘。
 */
export function validateVolumeSummary(
  summary: string,
  requiredSubjects: readonly EntityRef[],
  maxChars: number = VOLUME_SUMMARY_MAX_CHARS,
): VolumeSummaryFailure[] {
  const failures: VolumeSummaryFailure[] = []
  if (summary.trim().length === 0) {
    failures.push({ code: 'empty_summary', detail: 'summary is empty after trim' })
    return failures
  }
  if (summary.length > maxChars) {
    failures.push({
      code: 'length_overflow',
      detail: `summary length ${summary.length} exceeds cap ${maxChars}`,
    })
  }
  const seen = new Set<EntityRef>()
  for (const subject of requiredSubjects) {
    if (seen.has(subject)) {
      continue
    }
    seen.add(subject)
    if (!summary.includes(subject)) {
      failures.push({ code: 'subject_not_covered', detail: `subject ref '${subject}' absent from summary` })
    }
  }
  return failures
}

export interface BuildVolumeSummaryPromptInput {
  readonly volumeNodeId: VolumeNodeId
  readonly volumeEndChapter: number
  readonly facts: readonly TemporalFact[]
}

/**
 * 卷摘要 prompt 构造（确定性：同候选集同 prompt）。
 * 端口契约要求摘要至少逐字引用每个 subject ref（validateVolumeSummary 的覆盖
 * 门据此机检）；这是 LLM 输出的硬约束，不是建议。
 */
export function buildVolumeSummaryPrompt(input: BuildVolumeSummaryPromptInput): string {
  const factLines = input.facts
    .map(
      (fact) =>
        `- ${fact.id} | ${fact.subject} | ${fact.predicate}=${String(fact.value)} | 生效章 ${fact.validFrom}–${fact.validUntil === null ? '∞' : fact.validUntil} | 重要度 ${fact.importance}`,
    )
    .join('\n')
  const subjects = [...new Set(input.facts.map((fact) => fact.subject))].join('、')
  return [
    `你是长篇小说的叙事状态压缩器。第 ${input.volumeEndChapter} 章完结的卷（大纲节点 ${input.volumeNodeId}）`,
    '内的以下终态微事实将被折入卷摘要；此后正文上下文不再逐条召回它们，只保留本摘要。',
    '',
    '候选微事实：',
    factLines,
    '',
    '要求：',
    '1. 用连贯中文摘要保留这些事实的因果与状态要点（谁、何属性、何值、何时失效）。',
    `2. 每个实体必须至少以其引用字面出现一次：${subjects}。`,
    '3. 只输出摘要正文，不要输出列表以外的解释或 markdown 标题。',
  ].join('\n')
}

export type VolumeSummaryLlmPort = (prompt: string) => Promise<string>

export class VolumeSummaryValidationError extends Error {
  override readonly name = 'VolumeSummaryValidationError'

  constructor(
    readonly failures: readonly VolumeSummaryFailure[],
    detail: string,
  ) {
    super(`volume summary validation failed: ${detail}`)
  }
}

export interface SummarizeVolumeFactsInput {
  readonly plan: VolumeCompactionPlan
  readonly llm: VolumeSummaryLlmPort
  readonly maxChars?: number | undefined
}

export interface SummarizeVolumeFactsResult {
  readonly volumeNodeId: VolumeNodeId
  readonly volumeEndChapter: number
  readonly summary: string
  readonly factsCompacted: readonly TemporalFact[]
}

/**
 * 卷微事实摘要生成（经注入式 LLM port，纯函数域编排，零直连 provider）。
 *
 * 完整性下限保证：
 *   - 候选为空时直接返回空摘要（不调 LLM，零浪费）；
 *   - 候选中全部微事实构造统一 prompt 并注入 LLM；
 *   - 结果必须经 validateVolumeSummary 严检（非空、字数上限、subject 全量覆盖）；
 *   - 校验未过抛出 VolumeSummaryValidationError，阻断下层落盘事务（宁败不脏）。
 */
export async function summarizeVolumeFacts(
  input: SummarizeVolumeFactsInput,
): Promise<SummarizeVolumeFactsResult> {
  const { plan, llm, maxChars = VOLUME_SUMMARY_MAX_CHARS } = input
  if (plan.candidates.length === 0) {
    return {
      volumeNodeId: plan.volumeNodeId,
      volumeEndChapter: plan.volumeEndChapter,
      summary: '',
      factsCompacted: [],
    }
  }

  const prompt = buildVolumeSummaryPrompt({
    volumeNodeId: plan.volumeNodeId,
    volumeEndChapter: plan.volumeEndChapter,
    facts: plan.candidates,
  })

  const rawSummary = await llm(prompt)
  const trimmed = rawSummary.trim()

  const requiredSubjects = [...new Set(plan.candidates.map((f) => f.subject))]
  const failures = validateVolumeSummary(trimmed, requiredSubjects, maxChars)

  if (failures.length > 0) {
    const details = failures.map((f) => `[${f.code}] ${f.detail}`).join('; ')
    throw new VolumeSummaryValidationError(failures, details)
  }

  return {
    volumeNodeId: plan.volumeNodeId,
    volumeEndChapter: plan.volumeEndChapter,
    summary: trimmed,
    factsCompacted: plan.candidates,
  }
}

/* ----------------------------------------------------------------------------
 * 3. buildCompactedFactRow —— 压缩标记行构造（I6 行保留 / Q14 revision +1）
 * -------------------------------------------------------------------------- */

export interface BuildCompactedFactRowInput {
  readonly fact: TemporalFact
  readonly volumeNodeId: VolumeNodeId
  /** ISO-8601 UTC；由调用方注入（本模块无时钟）。 */
  readonly updatedAtIso: string
}

/**
 * 压缩标记行：同 id 追加行，末行胜出折叠后 `compactedIntoVolumeId` 非 null。
 * 内容字段（subject/predicate/value/valid 区间/重要度/风险/来源/状态/provenance）
 * 全部原样保留——压缩只挂标记，绝不改写事实内容（I6/I1）。
 * 双前置守卫（重复折叠与保护位）在动第一字节前抛错（宁败不脏）。
 */
export function buildCompactedFactRow(input: BuildCompactedFactRowInput): TemporalFact {
  const { fact, volumeNodeId, updatedAtIso } = input
  if (fact.compactedIntoVolumeId !== null) {
    throw new VolumeCompactionInputError(
      `fact ${fact.id} is already compacted into ${fact.compactedIntoVolumeId} — double compaction refused`,
    )
  }
  if (fact.provenance.protectedUserContent) {
    throw new ProtectedContentViolationError(
      'temporalFact',
      fact.id,
      'protectedUserContent facts are excluded from compaction candidates (I1) — row build refused',
    )
  }
  if (!Number.isFinite(Date.parse(updatedAtIso))) {
    throw new VolumeCompactionInputError(`updatedAtIso must be an ISO-8601 timestamp, got ${updatedAtIso}`)
  }
  return {
    ...fact,
    revision: fact.revision + 1,
    updatedAt: updatedAtIso,
    compactedIntoVolumeId: volumeNodeId,
  }
}
