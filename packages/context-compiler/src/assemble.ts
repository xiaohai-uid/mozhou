/**
 * 两阶段 Reserved 预算装配（实现票 #23 / T7；T9 #25 增补：parseFailures 逐条透传、
 * replayInputs 归档激活证据）。
 *
 * 冻结依据：docs/specs/token-budget-assembly-spec.md（#8）· ADR-0020 ·
 * kernel-schema §8（ReceiptEntry / ExclusionReason / storyTextQuota / ReplayInputs）·
 * context-receipt-physical-format-spec §3.1（重放输入面）。
 *
 * 管线位置：
 *   RecallResult（T8a 双通道召回）──┐
 *   structural sections ────────────┼─▶ assembleBudgetedContext ─▶ AssemblyResult
 *   storyText 切片 · modelProfile ──┘        { packet, receipt }
 *
 * 决定性纪律（INV-1）：装配是 (inputs, modelProfile, configVersion, tokenizerVersion)
 * 上的纯函数——无时钟、无随机、无哈希遍历序依赖；同输入必产出逐字节相同的
 * packet 与 receipt。因此 receipt 身份信封（id/bookId/createdAt）由调用方铸造后经
 * input.receiptIdentity 注入——两次独立生成可各持不同身份而共享同一
 * recomputationHash；函数内部绝不触碰时钟与随机源。
 *
 * Token 计量权威源（spec §3）：唯一入口是注入的 ExactTokenizer（服务端精确
 * tokenizer 的封装，version 参与哈希）；估算器被类型面挡在预算核算之外。
 * 未注入即抛 TokenizerUnavailable——无精确计量器的模型拒绝装配，绝不降级估算。
 *
 * 分隔符开销计入所在条目（spec §3）：每条目渲染恒为 `content + ENTRY_DELIMITER`，
 * packet.text 为全部条目渲染的顺序拼接。真实 BPE 在拼接边界仍可能产生跨界合并
 * 漂移，由 Phase 2 收敛循环兜底（INV-5 有界迭代，超限 ConvergenceError fail
 * loudly；victim 恒取 desirability 最低者，绝不静默截正文）。
 */
import { createHash } from 'node:crypto'
import type {
  ActivationEvidence,
  AssemblyChannel,
  BookId,
  CompileTaskType,
  ContextReceipt,
  ContextReceiptId,
  ExclusionReason,
  ReceiptEntry,
  ReplayCandidate,
  ReplayInputs,
} from '@mozhou/kernel'
import type { RecallResult, RecallTier } from './recall.js'

/* ----------------------------------------------------------------------------
 * 错误模式（spec §9：一律显式异常，禁止降级静默）
 * -------------------------------------------------------------------------- */

export class CompileConfigError extends Error {
  constructor(detail: string) {
    super(`compile config error: ${detail}`)
    this.name = 'CompileConfigError'
  }
}

export class ConvergenceError extends Error {
  constructor(iterations: number) {
    super(`convergence error: packet exceeded budget after ${iterations} iterations`)
    this.name = 'ConvergenceError'
  }
}

export class TokenizerUnavailable extends Error {
  constructor(modelProfileId: string) {
    super(`tokenizer unavailable: model profile "${modelProfileId}" has no exact tokenizer`)
    this.name = 'TokenizerUnavailable'
  }
}

/* ----------------------------------------------------------------------------
 * 输入契约
 * -------------------------------------------------------------------------- */

/** 精确 token 计量器（预算核算唯一权威源；version 参与 recomputationHash）。 */
export interface ExactTokenizer {
  readonly version: string
  count(text: string): number
}

export interface AssemblyModelProfile {
  readonly id: string
  readonly contextWindow: number
}

/** 结构层固定注入段（Author Intent / 任务框架 / Scenario Style Profile）。 */
export interface StructuralSection {
  /** 条目标识（Receipt diff 按 identifier 对齐），如 'author_intent'。 */
  readonly section: string
  readonly content: string
}

export interface AssembleTask {
  readonly type: CompileTaskType
  readonly chapterIndex?: number
}

/** Receipt 身份信封：调用方在生成时刻铸造（ULID + ISO-8601 UTC 时钟），
 *  装配函数本身不触时钟——recomputationHash 恒不覆盖此信封。 */
export interface ReceiptIdentity {
  readonly receiptId: ContextReceiptId
  readonly bookId: BookId
  readonly createdAtIso: string
}

interface TierPolicy {
  /** rank 小者优先（desirability 序第二键）。 */
  readonly rank: number
  readonly defaultTrim: 'atomic' | 'truncated'
  /** truncated 档必填：留头截断的 token 上限。 */
  readonly truncateCap?: number
}

export type AssemblyTierName = RecallTier | 'rolling_recap'

export interface BudgetAssemblyConfig {
  readonly marginTokens: number
  readonly outputReserve: { readonly minTokens: number; readonly ratio: number }
  readonly structuralCapTokens: number
  readonly poolMinTokens: number
  readonly maxConvergeIter: number
  readonly quotaRatioByTask: Record<CompileTaskType, number>
  readonly tiers: Record<AssemblyTierName, TierPolicy>
}

/** spec §2 配置默认表（整体替换式覆盖：传 config 即整表自备，不做深合并）。 */
export const DEFAULT_BUDGET_ASSEMBLY_CONFIG: BudgetAssemblyConfig = {
  marginTokens: 64,
  outputReserve: { minTokens: 1024, ratio: 0.15 },
  structuralCapTokens: 4096,
  poolMinTokens: 512,
  maxConvergeIter: 8,
  quotaRatioByTask: {
    chapter_writing: 0.4,
    scene_beat: 0.3,
    review: 0.15,
    fact_extraction: 0.1,
    // T16 受控增补行（#40，chapter-pipeline-spec §4 第 2 条 / S3）：十步管线
    // 第 2 步 Compile 的任务档；正文保底配额与 chapter_writing 同族（0.4）。
    CHAPTER_DRAFTING: 0.4,
  },
  tiers: {
    entity_card: { rank: 1, defaultTrim: 'atomic' },
    active_fact: { rank: 1, defaultTrim: 'atomic' },
    promise_due: { rank: 1, defaultTrim: 'atomic' },
    world_rule: { rank: 2, defaultTrim: 'truncated', truncateCap: 512 },
    rolling_recap: { rank: 3, defaultTrim: 'truncated', truncateCap: 256 },
    distant_recall: { rank: 4, defaultTrim: 'truncated', truncateCap: 128 },
  },
}

export interface AssembleInput {
  readonly task: AssembleTask
  readonly modelProfile: AssemblyModelProfile
  /** 缺省 ⇒ TokenizerUnavailable（无精确计量器的模型拒绝装配）。 */
  readonly tokenizer?: ExactTokenizer | undefined
  /** 双通道召回输出（T8a）：candidates 进竞争池，excluded 原样透传进 Receipt。 */
  readonly recall: RecallResult
  readonly structural: { readonly sections: readonly StructuralSection[] }
  /** 有序近期正文切片（章节续写语境；review/fact_extraction 可空）。 */
  readonly storyText?: readonly string[] | undefined
  readonly receiptIdentity: ReceiptIdentity
  readonly config?: BudgetAssemblyConfig | undefined
}

/* ----------------------------------------------------------------------------
 * 输出契约
 * -------------------------------------------------------------------------- */

export interface PacketStructuralPiece {
  readonly section: string
  readonly text: string
  readonly tokens: number
}

export interface PacketSettingEntry {
  readonly identifier: string
  readonly tier: RecallTier | 'rolling_recap'
  readonly text: string
  readonly tokens: number
  readonly trimType: 'none' | 'atomic' | 'truncated'
  /** desirability 全序中的序位（预订序），供收敛审计与单调 diff。 */
  readonly desirabilityPosition: number
}

export interface ContextPacket {
  readonly taskType: CompileTaskType
  readonly chapterIndex?: number
  readonly structural: readonly PacketStructuralPiece[]
  /** 设定条目按 tier 分组（rank ASC）组内预订序（spec §6 固定分区布局）。 */
  readonly settings: readonly PacketSettingEntry[]
  readonly story: { readonly text: string; readonly tokens: number; readonly trimType: 'none' | 'truncated' }
  /** 完整拼装载荷（structural + settings + story 顺序拼接）。 */
  readonly text: string
  readonly totalTokens: number
}

export interface AssemblyResult {
  readonly packet: ContextPacket
  readonly receipt: ContextReceipt
}

/* ----------------------------------------------------------------------------
 * 内部件：canonicalJson / sha256 / 截断原语 / desirability 全序
 * -------------------------------------------------------------------------- */

const ENTRY_DELIMITER = '\n'

const renderPiece = (content: string): string => content + ENTRY_DELIMITER

/** 哈希纪律的规范化序列化（INV-R3）：键字典序、紧凑分隔符、剔除 undefined。
 *  导出供重放面（T9 #25）复用同一公式——inputsDigest 锚定与文件排版互不影响。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** 切割点是否落在 UTF-16 代理对中间（head=尾部悬起高代理 / tail=头部悬落低代理）。 */
function cutsSurrogatePair(text: string, cutLength: number, side: 'head' | 'tail'): boolean {
  if (side === 'head') {
    const last = cutLength > 0 ? text.charCodeAt(cutLength - 1) : 0
    return last >= 0xd800 && last <= 0xdbff
  }
  const start = text.length - cutLength
  const first = start >= 0 && start < text.length ? text.charCodeAt(start) : 0
  return first >= 0xdc00 && first <= 0xdfff
}

/** 取不超 maxTokens 的最长切片（head=留头前缀 / tail=保尾后缀），UTF-16 二分 + 代理对修复。 */
function longestFittingSlice(
  text: string,
  maxTokens: number,
  tokenizer: ExactTokenizer,
  side: 'head' | 'tail',
): string {
  if (tokenizer.count(text) <= maxTokens) {
    return text
  }
  let ok = 0
  let bad = text.length // 前置条件：全串已确认超限
  while (bad - ok > 1) {
    const mid = Math.floor((ok + bad) / 2)
    const slice = side === 'head' ? text.slice(0, mid) : text.slice(text.length - mid)
    if (tokenizer.count(slice) <= maxTokens) {
      ok = mid
    } else {
      bad = mid
    }
  }
  while (ok > 0 && cutsSurrogatePair(text, ok, side)) {
    ok -= 1
  }
  return side === 'head' ? text.slice(0, ok) : text.slice(text.length - ok)
}

/**
 * Desirability 全序（spec §3）：pinned DESC > tierRank ASC > relevanceScore DESC >
 * id ASC（ULID 字典序收口平局——时间单调前缀退化为「先创建者优先」，零额外状态）。
 */
function compareDesirability(
  cfg: BudgetAssemblyConfig,
  a: { readonly id: string; readonly tier: AssemblyTierName; readonly relevanceScore: number; readonly pinned?: boolean },
  b: { readonly id: string; readonly tier: AssemblyTierName; readonly relevanceScore: number; readonly pinned?: boolean },
): number {
  const pinnedDelta = Number(b.pinned === true) - Number(a.pinned === true)
  if (pinnedDelta !== 0) {
    return pinnedDelta
  }
  const rankDelta = cfg.tiers[a.tier].rank - cfg.tiers[b.tier].rank
  if (rankDelta !== 0) {
    return rankDelta
  }
  if (a.relevanceScore !== b.relevanceScore) {
    return b.relevanceScore - a.relevanceScore
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/* ----------------------------------------------------------------------------
 * 终态化（预订前定形：trimType 判定 + 留头截断 + 精确计数）
 * -------------------------------------------------------------------------- */

type TrimType = 'none' | 'atomic' | 'truncated'

interface FinalizedEntry {
  readonly id: string
  readonly tier: AssemblyTierName
  readonly channel: AssemblyChannel
  readonly relevanceScore: number
  readonly pinned: boolean
  readonly atomicOverride: boolean
  /** 层级修剪类别（策略面）：收敛循环据此判定「可再截」——与结果 trimType 区分
   *  （truncated 档未触帽的条目 trimType='none'，但仍属可收缩类）。 */
  readonly trimClass: 'atomic' | 'truncated'
  readonly activation: ActivationEvidence | undefined
  readonly sourceContent: string
  readonly text: string
  readonly tokens: number
  readonly trimType: TrimType
  /** desirability 全序序位。 */
  readonly position: number
}

function finalizeCandidates(
  candidates: RecallResult['candidates'],
  cfg: BudgetAssemblyConfig,
  tokenizer: ExactTokenizer,
): FinalizedEntry[] {
  const ordered = [...candidates].sort((a, b) => compareDesirability(cfg, a, b))
  return ordered.map((candidate, position) => {
    const policy = cfg.tiers[candidate.tier]
    if (policy.defaultTrim === 'truncated' && (policy.truncateCap === undefined || policy.truncateCap < 1)) {
      throw new CompileConfigError(`tier "${candidate.tier}" is truncated but has no positive truncateCap`)
    }
    const atomic = candidate.atomicOverride === true || policy.defaultTrim === 'atomic'
    const rendered = renderPiece(candidate.content)
    let text = rendered
    let trimType: TrimType = atomic ? 'atomic' : 'truncated'
    if (!atomic) {
      const cap = policy.truncateCap!
      const cut = longestFittingSlice(rendered, cap, tokenizer, 'head')
      trimType = cut.length < rendered.length ? 'truncated' : 'none'
      text = cut
    }
    return {
      id: candidate.id,
      tier: candidate.tier,
      channel: candidate.channel,
      relevanceScore: candidate.relevanceScore,
      pinned: candidate.pinned === true,
      atomicOverride: candidate.atomicOverride === true,
      trimClass: atomic ? 'atomic' : 'truncated',
      ...(candidate.activation === undefined ? { activation: undefined } : { activation: candidate.activation }),
      sourceContent: candidate.content,
      text,
      tokens: tokenizer.count(text),
      trimType,
      position,
    }
  })
}

/* ----------------------------------------------------------------------------
 * 主入口：三层预扣 → 序贯预订 → 放置收敛 → Receipt 发射
 * -------------------------------------------------------------------------- */

export function assembleBudgetedContext(input: AssembleInput): AssemblyResult {
  const cfg = input.config ?? DEFAULT_BUDGET_ASSEMBLY_CONFIG
  const tokenizer = input.tokenizer
  if (tokenizer === undefined) {
    throw new TokenizerUnavailable(input.modelProfile.id)
  }

  /* ---- Phase 0：三层预扣（输出预留 / 结构层 / 正文保底配额均不参与竞争） ---- */
  const windowTokens = input.modelProfile.contextWindow
  if (!(windowTokens > 0)) {
    throw new CompileConfigError(`contextWindow must be positive, got ${windowTokens}`)
  }
  const outputReserve = Math.max(cfg.outputReserve.minTokens, Math.ceil(cfg.outputReserve.ratio * windowTokens))
  const budgetTotal = windowTokens - outputReserve - cfg.marginTokens
  if (!(budgetTotal > 0)) {
    throw new CompileConfigError(`budget total is ${budgetTotal}: context window too small for reserve+margin`)
  }

  const structuralPieces: PacketStructuralPiece[] = input.structural.sections.map((section) => {
    const text = renderPiece(section.content)
    return { section: section.section, text, tokens: tokenizer.count(text) }
  })
  const structuralTokens = structuralPieces.reduce((sum, piece) => sum + piece.tokens, 0)

  const quotaRatio = cfg.quotaRatioByTask[input.task.type]
  if (quotaRatio === undefined || !(quotaRatio > 0 && quotaRatio <= 1)) {
    throw new CompileConfigError(`quotaRatioByTask["${input.task.type}"] must be in (0, 1]`)
  }
  const storyQuotaFloor = Math.ceil(quotaRatio * budgetTotal)
  const competitivePool = budgetTotal - structuralTokens - storyQuotaFloor

  // fail loudly（NAI「lorebook cancel out story text」反面教训的根治点，INV-3 前置守卫）
  if (structuralTokens > cfg.structuralCapTokens) {
    throw new CompileConfigError(
      `structural layer uses ${structuralTokens} tokens, exceeding structuralCapTokens=${cfg.structuralCapTokens}`,
    )
  }
  if (competitivePool < cfg.poolMinTokens) {
    throw new CompileConfigError(
      `competitive pool is ${competitivePool} tokens (< poolMinTokens=${cfg.poolMinTokens}): ` +
        'structural layer or story quota squeezes the pool dry',
    )
  }

  /* ---- Phase 1：终态化 + 序贯预订（前缀语义，序贯即止） ---- */
  const finalized = finalizeCandidates(input.recall.candidates, cfg, tokenizer)
  const reserved: FinalizedEntry[] = []
  let remainingPool = competitivePool
  let remainingNoQuota = budgetTotal - structuralTokens
  let stopper: { entry: FinalizedEntry; reason: ExclusionReason } | undefined
  for (const entry of finalized) {
    if (entry.tokens <= remainingPool) {
      reserved.push(entry)
      remainingPool -= entry.tokens
      remainingNoQuota -= entry.tokens
      continue
    }
    // Q4c 双原因码判定（判定点唯一：预订循环内，两码互斥）
    stopper = {
      entry,
      reason: entry.tokens <= remainingNoQuota ? 'story_text_quota_protected' : 'budget_exhausted',
    }
    break // ★ 序贯即止：入选 ⟺ 装得下的最长前缀（INV-2）
  }

  /* ---- Phase 2：放置（tier 分组组内预订序）+ 正文保尾 + 收敛 ---- */
  // 收敛工作面按预订序排列（= desirability 降序）；packet 布局视图按 tier 分组。
  interface WorkRecord {
    readonly meta: FinalizedEntry
    text: string
    tokens: number
    /** 本轮装配中被收敛循环收缩过（Receipt 归入 converge 段发射）。 */
    converged: boolean
  }
  const records: WorkRecord[] = reserved.map((meta) => ({ meta, text: meta.text, tokens: meta.tokens, converged: false }))
  const layoutView = (): WorkRecord[] =>
    [...records].sort(
      (a, b) => cfg.tiers[a.meta.tier].rank - cfg.tiers[b.meta.tier].rank || a.meta.position - b.meta.position,
    )
  const renderPacketText = (): string =>
    structuralPieces.map((piece) => piece.text).join('') +
    layoutView()
      .map((record) => record.text)
      .join('') +
    storyFinal

  const availForStory = budgetTotal - structuralTokens - records.reduce((sum, record) => sum + record.tokens, 0)

  const storyRendered = (input.storyText ?? []).map(renderPiece).join('')
  let storyFinal = storyRendered
  let storyTrimType: 'none' | 'truncated' = 'none'
  if (tokenizer.count(storyRendered) > availForStory) {
    // 正文保尾：丢最旧留最新；短章省下的池余量由正文自然吸收（不对称回收，Q4b）
    storyFinal = longestFittingSlice(storyRendered, availForStory, tokenizer, 'tail')
    storyTrimType = 'truncated'
  }

  const convergedEvictions: { identifier: string; tokens: number }[] = []
  let usedTokens = tokenizer.count(renderPacketText())
  let iteration = 0
  while (usedTokens > budgetTotal) {
    iteration += 1
    if (iteration > cfg.maxConvergeIter) {
      throw new ConvergenceError(cfg.maxConvergeIter) // INV-5：fail loudly，绝不静默截正文
    }
    const last = records.at(-1)
    if (last === undefined) {
      throw new CompileConfigError('packet exceeds budget with no setting entry left to sacrifice')
    }
    // victim = desirability 升序第一个（预订序末位）；可再截则减半收缩，否则原位淘汰
    if (last.meta.trimClass === 'truncated' && last.tokens > 1) {
      const newText = longestFittingSlice(last.text, Math.max(1, Math.floor(last.tokens / 2)), tokenizer, 'head')
      last.text = newText
      last.tokens = tokenizer.count(newText)
      last.converged = true
    } else {
      records.pop()
      convergedEvictions.push({ identifier: last.meta.id, tokens: last.tokens })
    }
    usedTokens = tokenizer.count(renderPacketText())
  }

  const settingsPieces: PacketSettingEntry[] = layoutView().map((record) => ({
    identifier: record.meta.id,
    tier: record.meta.tier,
    text: record.text,
    tokens: record.tokens,
    trimType: record.meta.trimType,
    desirabilityPosition: record.meta.position,
  }))
  const storyActualTokens = tokenizer.count(storyFinal)

  const packet: ContextPacket = {
    taskType: input.task.type,
    ...(input.task.chapterIndex === undefined ? {} : { chapterIndex: input.task.chapterIndex }),
    structural: structuralPieces,
    settings: settingsPieces,
    story: { text: storyFinal, tokens: storyActualTokens, trimType: storyTrimType },
    text: renderPacketText(),
    totalTokens: usedTokens,
  }

  /* ---- Receipt 发射（确定性条目序：structural → reserve → converge → story_text → recall_filter） ---- */
  const entries: ReceiptEntry[] = []
  let order = 0
  const push = (entry: Omit<ReceiptEntry, 'order'>): void => {
    entries.push({ order, ...entry })
    order += 1
  }
  const activationFields = (meta: FinalizedEntry) => ({
    assemblySource: meta.channel,
    ...(meta.activation === undefined ? {} : { activation: meta.activation }),
  })

  for (const piece of structuralPieces) {
    push({
      stage: 'structural',
      identifier: piece.section,
      included: true,
      assemblySource: 'structural',
      tokens: piece.tokens,
      trimType: 'none',
    })
  }

  for (const record of records) {
    if (record.converged) {
      continue // 收缩者移入 converge 段发射（避免同 identifier 双行）
    }
    push({
      stage: 'reserve',
      identifier: record.meta.id,
      included: true,
      ...activationFields(record.meta),
      reservedTokens: record.tokens,
      tokens: record.tokens,
      trimType: record.meta.trimType,
    })
  }
  if (stopper !== undefined) {
    // 序贯止步的首个落选者，原位保留于预订块末尾（included=false）
    push({
      stage: 'reserve',
      identifier: stopper.entry.id,
      included: false,
      ...activationFields(stopper.entry),
      exclusionReason: stopper.reason,
      tokens: stopper.entry.tokens,
      trimType: 'none', // 出局者记 none（含原子出局：原子免截断不免淘汰）
    })
  }

  for (const record of records) {
    if (!record.converged) {
      continue
    }
    push({
      stage: 'converge',
      identifier: record.meta.id,
      included: true,
      ...activationFields(record.meta),
      reservedTokens: record.meta.tokens,
      tokens: record.tokens,
      trimType: 'truncated',
    })
  }
  for (const eviction of convergedEvictions) {
    push({
      stage: 'converge',
      identifier: eviction.identifier,
      included: false,
      exclusionReason: 'budget_exhausted',
      tokens: eviction.tokens,
      trimType: 'none',
    })
  }

  push({
    stage: 'story_text',
    identifier: 'story_text',
    included: true,
    tokens: storyActualTokens,
    trimType: storyTrimType,
  })

  const passthroughExclusions = [...input.recall.excluded].sort(
    (a, b) =>
      (a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0) ||
      (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  )
  for (const exclusion of passthroughExclusions) {
    push({
      stage: 'recall_filter',
      identifier: exclusion.identifier,
      included: false,
      ...(exclusion.channel === undefined ? {} : { assemblySource: exclusion.channel }),
      exclusionReason: exclusion.reason,
      trimType: 'none',
    })
  }

  /* ---- 重放输入面（#16/Q16）：候选恒按 desirability 终序存储，重放即顺序走查 ---- */
  const replayInputs: ReplayInputs = {
    configVersion: configVersionOf(cfg),
    tokenizerVersion: tokenizer.version,
    modelProfileId: input.modelProfile.id,
    contextWindowTokens: windowTokens,
    candidates: finalized.map(
      (meta): ReplayCandidate => ({
        id: meta.id,
        tier: meta.tier,
        channel: meta.channel,
        relevanceScore: meta.relevanceScore,
        ...(meta.pinned ? { pinned: true } : {}),
        ...(meta.atomicOverride ? { atomicOverride: true } : {}),
        // T9 #25：激活证据随重放面归档——recomputationHash 覆盖 entries（含 activation），
        // converge 淘汰者的证据在 receipt entries 中无第二载体，缺此位则哈希不可复现。
        ...(meta.activation === undefined ? {} : { activation: meta.activation }),
        contentDigest: sha256Hex(meta.sourceContent),
      }),
    ),
    structuralSections: input.structural.sections.map((section) => ({
      section: section.section,
      contentDigest: sha256Hex(section.content),
    })),
    storyTextSlices: (input.storyText ?? []).map((slice) => ({
      digest: sha256Hex(slice),
      tokens: tokenizer.count(renderPiece(slice)),
    })),
  }
  const inputsDigest = sha256Hex(canonicalJson(replayInputs))

  const recomputationHash = sha256Hex(
    canonicalJson({
      configVersion: replayInputs.configVersion,
      tokenizerVersion: replayInputs.tokenizerVersion,
      modelProfileId: replayInputs.modelProfileId,
      inputsDigest,
      entries,
      storyTextQuota: { reservedTokens: storyQuotaFloor, actualTokens: storyActualTokens },
      totalTokens: usedTokens,
    }),
  )

  const receipt: ContextReceipt = {
    id: input.receiptIdentity.receiptId,
    bookId: input.receiptIdentity.bookId,
    revision: 0, // I5：ContextReceipt 不可变实体恒 0
    createdAt: input.receiptIdentity.createdAtIso,
    updatedAt: input.receiptIdentity.createdAtIso,
    taskType: input.task.type,
    ...(input.task.chapterIndex === undefined ? {} : { chapterIndex: input.task.chapterIndex }),
    entries,
    // 解析失败逐条（T9 #25）：召回通道前置解析失败的原样透传——每个失败引用
    // 一条独立 {source, detail} 记录，不聚合不计数；成功装配内部的语义不变（spec §5）。
    parseFailures: input.recall.parseFailures,
    storyTextQuota: { reservedTokens: storyQuotaFloor, actualTokens: storyActualTokens },
    totalTokens: usedTokens,
    assembledBy: 'server', // N10/I4：类型层面把客户端装配表达为非法状态
    replayInputs,
    inputsDigest,
    recomputationHash,
  }

  return { packet, receipt }
}

/** 有效配置的自描述版本号：解析后配置的规范摘要（覆盖项参与 ⇒ 版本随配置漂移可见）。
 *  导出供重放面（T9 #25）做 configVersion 一致性校验。 */
export function configVersionOf(cfg: BudgetAssemblyConfig): string {
  return `budget-assembly/${sha256Hex(canonicalJson(cfg)).slice(0, 32)}`
}
