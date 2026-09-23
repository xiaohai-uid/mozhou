/**
 * 编译器全链路集成（实现票 #26 / T10a）：compile() 端到端贯通——
 * 目录卡四档激活 → 三通道召回 → 两阶段 Reserved 预算装配 → 服务端 Receipt 一证一文件。
 *
 * 冻结依据：entity-directory-spec §5/§6 D1/D3/D5（四档激活与 Research 隔离）·
 * khop-graph-recall-spec（#12）· token-budget-assembly-spec（#8）· ADR-0020/0021/0022 ·
 * context-receipt-physical-format-spec（#9 收敛定案）。
 *
 * 管线位置（接缝收口在 ContextCompiler）：
 *   目录卡扫描面 ──activateCards 四档分流──┐
 *   draftText ──recallCandidates 三通道───┼─▶ assembleBudgetedContext ─▶ persistReceipt ─▶ CompileResult
 *   structural / storyText / snapshot ────┘
 *
 * 四档激活语义（D1：仅裁决激活与否；secret.* 与 POV 门禁中央强制，任何档位不得绕过）：
 *   - always      ⇒ 结构层注入（section = `entity:<ref>`，ref 升序稳定排版——文件名只是
 *                   皮，重命名不影响 Receipt diff），受 structuralCapTokens 约束，
 *                   超出 = CompileConfigError（D5）；不进候选池——结构层+候选池双吃预算
 *                   是重复计费；
 *   - detected    ⇒ 正常参与 keyword 别名检测（默认档）；
 *   - detectedOff ⇒ 跳过 keyword 检测（别名表不被消费）；图/embedding 通道仍可达
 *                   （实体 id 直引）——「关检测」≠「永不出现」；
 *   - never       ⇒ 全通道出局：先于检测裁剪扫描面，草稿提及也不激活（AC②：
 *                   Always/Never 档在全链路中优先于检测逻辑）。
 *
 * Research 参考区硬隔离（US17）：携带 research 区 fileRel 的卡在编译入口即拒绝——
 * 确定性错误面而非静默吸收。目录值镜像 @mozhou/data-plane layout.ts RESEARCH_DIRS
 * （包边界解耦不跨包依赖；值冻结于工单 #6 Q6/#13，两侧同步漂移即实现 bug）。
 *
 * 失败路径（AC③ 一律显式异常禁止降级静默）：
 *   - 召回合并后候选集为空 ⇒ EmptyRecallError（零设定上下文的生成尝试被拒绝）；
 *   - 预算溢出 ⇒ ConvergenceError（装配器既有语义原样穿透）；
 *   - 配置面 ⇒ CompileConfigError（Research 卡 / 结构层爆池）/ TokenizerUnavailable
 *     （无精确计量器的模型拒绝装配）。
 *
 * Receipt 服务端收口（I4/N10）：assembledBy 恒 'server'；一证一文件落盘
 * `.mozhou/receipts/rcpt_<ULID>.json` + ContextCompiled 指针事件追加（INV-R1 先证后
 * 指针）。凭证身份（ULID/时钟）在本层铸造——装配纯函数纪律不被 IO 触碰；测试经
 * receiptId / nowIso 注入获得完全确定性。
 */
import type {
  AiContextTier,
  AliasRule,
  BookId,
  ContextReceipt,
  ContextReceiptId,
  EntityRef,
  NarrativeStateSnapshot,
} from '@mozhou/kernel'
import { newUlid } from '@mozhou/kernel'
import {
  assembleBudgetedContext,
  CompileConfigError,
  type AssemblyModelProfile,
  type AssembleTask,
  type BudgetAssemblyConfig,
  type ContextPacket,
  type ExactTokenizer,
  type ReceiptIdentity,
  type StructuralSection,
} from './assemble.js'
import { persistReceipt, type PersistedReceiptLocation } from './receipt-file.js'
import {
  recallCandidates,
  type GraphRecallScope,
  type KhopRecallConfig,
  type RecallEntityCard,
} from './recall.js'
import type { LocalEmbeddingProvider } from './embedding.js'

/* ----------------------------------------------------------------------------
 * 错误模式（AC③：失败路径确定性错误面）
 * -------------------------------------------------------------------------- */

/** 召回合并后候选集为空——拒绝零设定上下文的静默生成。修正方向：补目录卡/
 *  追踪事实、放宽 POV 或检查 draftText 与别名表的匹配。 */
export class EmptyRecallError extends Error {
  constructor(taskType: string, chapterIndex: number | undefined) {
    super(
      `empty recall: task=${taskType} chapter=${chapterIndex ?? '-'} merged zero candidates ` +
        'from all channels — refusing silent degradation (T10a AC3)',
    )
    this.name = 'EmptyRecallError'
  }
}

/* ----------------------------------------------------------------------------
 * 输入契约
 * -------------------------------------------------------------------------- */

/** 编译输入的目录卡最小面（data-plane EntityCardScan 结构性满足；fileRel 仅用于
 *  Research 区隔离守卫，缺省视为非研究区）。 */
export interface CompileCard {
  readonly ref: EntityRef
  readonly name: string
  /** 装配策略四档（扫描面恒带；无缺省——调用方必须显式携带档位语义）。 */
  readonly aiContext: AiContextTier
  readonly aliases?: readonly AliasRule[]
  readonly excludedPhrases?: readonly string[]
  /** 进 prompt 的压缩面；null/缺省 = 空 AI 面（brief 缺省回退归数据面读取层）。 */
  readonly brief?: string | null
  /** 书根相对 POSIX 路径（EntityCardScan 自带；Research 区守卫消费）。 */
  readonly fileRel?: string
}

export interface CompileInput {
  readonly task: AssembleTask
  /** 书根：Receipt 一证一文件的落盘锚点。 */
  readonly bookRoot: string
  readonly bookId: BookId
  /** 草稿/场景原文：keyword 检测与 embedding 查询指纹的共同输入。 */
  readonly draftText: string
  /** 目录卡全量扫描面（含 never/always 档；四档分流在本层完成）。 */
  readonly cards: readonly CompileCard[]
  readonly snapshot: NarrativeStateSnapshot
  readonly scope: GraphRecallScope
  /** 基础结构层注入段（Author Intent / 任务框架 / 风格画像）；always 卡段追加其后。 */
  readonly structural: { readonly sections: readonly StructuralSection[] }
  /** 有序近期正文切片（章节续写语境；review/fact_extraction 可空）。 */
  readonly storyText?: readonly string[] | undefined
  readonly modelProfile: AssemblyModelProfile
  /** 缺省 ⇒ TokenizerUnavailable（无精确计量器的模型拒绝装配）。 */
  readonly tokenizer?: ExactTokenizer | undefined
  /** 提供即启用 embedding 兜底第三通道。 */
  readonly embedding?: LocalEmbeddingProvider
  readonly config?: BudgetAssemblyConfig | undefined
  readonly recallConfig?: KhopRecallConfig | undefined
  /** 测试确定性注入：缺省铸新 ULID。 */
  readonly receiptId?: ContextReceiptId | undefined
  /** 测试确定性注入：指针事件与凭证 createdAt 时钟；缺省取当前时钟。 */
  readonly nowIso?: string | undefined
}

export interface CompileResult {
  readonly packet: ContextPacket
  readonly receipt: ContextReceipt
  readonly location: PersistedReceiptLocation
}

/* ----------------------------------------------------------------------------
 * 四档激活（D1/D3/D5；纯函数——同卡面必得同分流）
 * -------------------------------------------------------------------------- */

export interface CardActivation {
  /** always 档的结构层注入段（ref 升序；content = brief ?? ''）。 */
  readonly alwaysSections: readonly StructuralSection[]
  /** detected + detectedOff 档的召回扫描面（never 已出局）。 */
  readonly recallFace: readonly RecallEntityCard[]
  /** keyword 别名检测扫描面（仅 detected 档）。 */
  readonly keywordScanFace: ReadonlySet<EntityRef>
}

const toRecallCard = (card: CompileCard): RecallEntityCard => ({
  ref: card.ref,
  name: card.name,
  ...(card.aliases === undefined ? {} : { aliases: card.aliases }),
  ...(card.excludedPhrases === undefined ? {} : { excludedPhrases: card.excludedPhrases }),
  ...(card.brief ? { brief: card.brief } : {}),
})

export function activateCards(cards: readonly CompileCard[]): CardActivation {
  const alwaysSections: StructuralSection[] = []
  const recallFace: RecallEntityCard[] = []
  const keywordFace = new Set<EntityRef>()

  for (const card of cards) {
    switch (card.aiContext) {
      case 'always':
        // D5：结构层注入点；ref 升序由调用方入参序无关化（重命名/重排不影响 diff）
        alwaysSections.push({ section: `entity:${card.ref}`, content: card.brief ?? '' })
        break
      case 'detected':
        keywordFace.add(card.ref)
        recallFace.push(toRecallCard(card))
        break
      case 'detectedOff':
        // 别名检测跳过；图/embedding 语料仍含此卡（实体 id 直引）
        recallFace.push(toRecallCard(card))
        break
      case 'never':
        break // 全通道出局：不入任何扫描面
    }
  }

  alwaysSections.sort((a, b) => (a.section < b.section ? -1 : a.section > b.section ? 1 : 0))
  return { alwaysSections, recallFace, keywordScanFace: keywordFace }
}

/* ----------------------------------------------------------------------------
 * Research 区硬隔离（US17；镜像 data-plane layout.ts，见文件头）
 * -------------------------------------------------------------------------- */

const RESEARCH_DIRS = ['市场'] as const

function isResearchRelPath(relPosixPath: string): boolean {
  return RESEARCH_DIRS.some((dir) => relPosixPath === dir || relPosixPath.startsWith(`${dir}/`))
}

function assertNoResearchZone(cards: readonly CompileCard[]): void {
  for (const card of cards) {
    if (card.fileRel !== undefined && isResearchRelPath(card.fileRel)) {
      throw new CompileConfigError(
        `research zone isolation violated: card "${card.ref}" comes from "${card.fileRel}" — ` +
          'research material must never enter compilation (US17)',
      )
    }
  }
}

/* ----------------------------------------------------------------------------
 * compile()：端到端收口
 * -------------------------------------------------------------------------- */

const mintReceiptId = (): ContextReceiptId => `rcpt_${newUlid()}` as ContextReceiptId

/**
 * 编译一章的完整上下文并落盘服务端 Receipt：
 *   Research 守卫 → 四档激活 → 三通道召回 → 空召回门禁 → 预算装配 → persistReceipt。
 * 任一失败路径显式抛错（见模块头），绝不产出半成品凭证。
 */
export async function compile(input: CompileInput): Promise<CompileResult> {
  assertNoResearchZone(input.cards)
  const activation = activateCards(input.cards)

  const recall = await recallCandidates({
    draftText: input.draftText,
    cards: activation.recallFace,
    snapshot: input.snapshot,
    scope: input.scope,
    ...(input.recallConfig === undefined ? {} : { config: input.recallConfig }),
    ...(input.embedding === undefined ? {} : { embedding: input.embedding }),
    keywordScanFace: activation.keywordScanFace,
  })
  if (recall.candidates.length === 0) {
    throw new EmptyRecallError(input.task.type, input.task.chapterIndex)
  }

  const createdAtIso = input.nowIso ?? new Date().toISOString()
  const receiptIdentity: ReceiptIdentity = {
    receiptId: input.receiptId ?? mintReceiptId(),
    bookId: input.bookId,
    createdAtIso,
  }

  const { packet, receipt } = assembleBudgetedContext({
    task: input.task,
    modelProfile: input.modelProfile,
    tokenizer: input.tokenizer,
    recall,
    structural: { sections: [...input.structural.sections, ...activation.alwaysSections] },
    storyText: input.storyText,
    receiptIdentity,
    ...(input.config === undefined ? {} : { config: input.config }),
  })

  // INV-R1 先证后指针：atIso 与凭证时钟同源，事件行与凭证时间线一致
  const location = persistReceipt(input.bookRoot, receipt, { atIso: createdAtIso })
  return { packet, receipt, location }
}
