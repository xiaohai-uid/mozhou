/**
 * apps/web · 对账落定出口 → 语义分析批次接线（T28/T29 · #69/#70；t66 D12/D14/D17/D20）。
 *
 * 规格链：change-impact-engine-spec §0「canon 改动落定 → 数据面公共出口回调 → 确定性
 * 遍历圈定受影响下游 → 语义旁路只读评估」；§3 D18/D19/D20 把公共落定出口钉为
 * `ReconciliationOptions.onSettled` 单点；§4 D12 节流（有序受影响章逐章单报）、
 * D13 降级三级、D14 入账序（报告文件先 → SemanticAnalyzed 指针事件后）。
 *
 * 本模块补的正是那条断链：`runSemanticBatch` / `analyzeSemantic` 此前在 apps/web
 * 零调用，且 `AnalyzeDeps.evaluate`（真 LLM 回调）在生产无适配器。这里做三件事：
 *
 * 1. **受影响章 → 批次项**：受影响章由落定后的确定性传播给出（reconciliationRoutes
 *    的 propagateStaleMarkers 命中集）。每章锚点取该章最新编译凭证
 *    （账本平铺 ContextCompiled 指针行 → loadReceiptForResume），缺凭证即跳过该章——
 *    没有 receiptId/recomputationHash 就无法声明「评估哪版编译」（D10），宁缺不误标；
 *    affectedRefs 的变更摘要指纹按章算：`matchStaleDependencies`（内核单缝）给出
 *    「本章钉版真正读到的上游变更」，与 reconcile 传播同一判据，不另造一套匹配。
 * 2. **真 LLM 适配器**：BYOK 端点（resolveChatEndpoint）→ createSemanticEvaluator；
 *    端点缺失 = L0 显式跳过（不产报告、不静默 mock，AGENTS §4.14/15）；
 * 3. **落定后触发**：dispatchSettledSemanticAnalysis 供 onSettled 回调调用，异步旁路，
 *    异常只落 stderr，绝不把已落盘的作者决策伪装成失败（沿 propagateSettledChanges 先例）。
 *
 * 边界：advisory-only。本模块只写 `.mozhou/semantic-analysis/` 报告与 SemanticAnalyzed
 * 指针事件，不触碰正文/canon/提案/路由（D08 MUST-NOT 字面化）。
 */
import { createHash } from 'node:crypto'
import { createLocalTokenizer } from '@mozhou/context-compiler'
import { readChapterDependencyPins } from '@mozhou/data-plane'
import { matchStaleDependencies, newUlid } from '@mozhou/kernel'
import type { ContextReceiptId, DependencyManifestEntry } from '@mozhou/kernel'
import { loadReceiptForResume, readPipelineLedger } from '@mozhou/pipeline'
import type { PipelineLedgerRow } from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'
import { runSemanticBatch } from '@mozhou/flywheel'
import type { AffectedRef, AnalyzeDeps, SemanticBatchItem, SemanticBatchOutcome } from '@mozhou/flywheel'
import { resolveChatEndpoint } from './llm/openaiStream.js'
import { buildSemanticPrompt, createSemanticEvaluator } from './llm/semanticEvaluator.js'

/** 输入计量的随仓精确词表（惰性装载；与 draftContext 预算路径同一把尺）。 */
let tokenizerSingleton: ReturnType<typeof createLocalTokenizer> | null = null
function countTokens(text: string): number {
  tokenizerSingleton ??= createLocalTokenizer()
  return tokenizerSingleton.count(text)
}

/**
 * 变更摘要指纹（D17：diffs 以引用摘要进载荷、不内嵌全文）。
 * 输入面是版本化实体三元组，故用「排序后的 `kind:id@revision` 集合」做稳定序列化，
 * 避开对象键序/时间戳/ULID 随机分量——同输入必得同指纹（对齐 impact 投影的指纹纪律）。
 */
function changeSummaryDigestOf(entries: readonly DependencyManifestEntry[]): string {
  const canonical = entries
    .map((entry) => `${entry.kind}:${entry.id}@${entry.revision}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * 该章最新编译凭证指针：扫账本**平铺** ContextCompiled 行（CHAPTER_DRAFTING + 同章号），
 * 后到者胜（行序即权威时序，沿 ledger.ts 头注）。
 *
 * 为什么不用 `projectSession(rows, chapterIndex).lastReceiptId`：那条路只认「会话窗口内」
 * 的指针——projection.ts:159-176 要求该章存在 TaskStarted（openedAtPosition !== null）
 * 且未 finished/committed，projection.ts:88-96 又在每次 TaskStarted 时把 lastReceiptId
 * 清空。而 TaskStarted 在全仓非测试代码里的唯一发射点是 session.ts:258
 * （ChapterProductionSession.start），其生产调用方只有 /api/session.open；真实作者旅程
 * （apps/web/src 内 grep 'api/session' 零命中）走
 * /api/draft.stream → buildDraftContext → runCompileStep（pipelineRoutes.ts:382 /
 * draftContext.ts:138），落平铺 ContextCompiled 行而不开窗口 ⇒ 用 projectSession 取锚点
 * 会让本批次在生产恒被短路（零报告、零上游调用）。平铺行自带 chapterIndex
 * （receipt-file.ts:106），其自身归属即权威，不需要窗口做中介。
 */
function latestReceiptIdForChapter(rows: readonly PipelineLedgerRow[], chapterIndex: number): ContextReceiptId | null {
  let found: ContextReceiptId | null = null
  for (const row of rows) {
    if (row.kind !== 'domain') continue
    if (row.row['type'] !== 'ContextCompiled') continue
    if (row.row['taskType'] !== 'CHAPTER_DRAFTING') continue
    if (row.row['chapterIndex'] !== chapterIndex) continue
    const receiptId = row.row['receiptId']
    // 形状守卫后再断言：`rcpt_` 前缀即 ContextReceiptId 的类型契约（kernel-schema.ts:57），
    // 不盲 cast——坏行宁可当「无凭证」跳过并留痕。
    if (typeof receiptId === 'string' && receiptId.startsWith('rcpt_')) found = receiptId as ContextReceiptId
  }
  return found
}

export interface SettledSemanticRequest {
  readonly root: string
  /** 落定提案 id（幂等锚 + reconciliationRef）。 */
  readonly proposalId: string
  /** 真正升格进投影的上游变更表（与 reconcile 传播同源；批次锚与逐章 refs 的真源）。 */
  readonly upstreamChanges: readonly DependencyManifestEntry[]
  /** 确定性传播给出的受影响章（升序去重由本模块负责）。 */
  readonly affectedChapters: readonly number[]
  /** 测试注入：缺省由 BYOK 端点构建真 LLM 适配器。 */
  readonly deps?: AnalyzeDeps | undefined
  /** 报告 id 铸造（测试确定性注入；缺省 ULID）。 */
  readonly newReportId?: (() => string) | undefined
}

export type SettledSemanticSkipReason = 'no_affected_chapters' | 'no_receipt_anchor' | 'provider_unavailable'

export interface SettledSemanticOutcome {
  readonly status: 'ran' | 'skipped'
  readonly reason?: SettledSemanticSkipReason
  /** ran 时为批次结果；skipped 时为 null（不产报告、不产事件）。 */
  readonly batch: SemanticBatchOutcome | null
  /** 真正进入批次的章（有编译凭证锚点者）。 */
  readonly analyzedChapters: readonly number[]
  /** 因缺凭证锚点被跳过的章（显式记录，不静默补锚）。 */
  readonly skippedChapters: readonly number[]
}

interface ResolvedDeps {
  readonly deps: AnalyzeDeps
  /** 报告 provider 字段 = 实际出站模型标识（可见性优先，不写路由身份）。 */
  readonly provider: string
}

/** 缺省适配器装配：无真实端点 ⇒ null（调用方按 L0 显式跳过收口）。 */
function resolveDefaultDeps(): ResolvedDeps | null {
  const endpoint = resolveChatEndpoint(process.env)
  if (endpoint === null) return null
  return { deps: { evaluate: createSemanticEvaluator({ endpoint, countTokens }) }, provider: endpoint.model }
}

/**
 * 落定语义批次主入口：受影响章 → 批次项（逐章 receipt 锚点）→ runSemanticBatch。
 * 不产报告的情形一律以显式 reason 返回，绝不返回「假装成功」的空结果。
 */
export async function runSettledSemanticAnalysis(request: SettledSemanticRequest): Promise<SettledSemanticOutcome> {
  const chapters = [...new Set(request.affectedChapters)].sort((a, b) => a - b)
  if (chapters.length === 0) {
    return { status: 'skipped', reason: 'no_affected_chapters', batch: null, analyzedChapters: [], skippedChapters: [] }
  }

  const resolved = request.deps === undefined ? resolveDefaultDeps() : null
  const deps = request.deps ?? resolved?.deps ?? null
  const provider = resolved?.provider ?? 'byok'
  if (deps === null) {
    console.warn(
      `[semantic] 落定语义批次 ${request.proposalId} 跳过：未配置真实 LLM 端点（BYOK）——L0 显式跳过，不产报告、不静默 mock`,
    )
    return {
      status: 'skipped',
      reason: 'provider_unavailable',
      batch: null,
      analyzedChapters: [],
      skippedChapters: chapters,
    }
  }

  const rows = readPipelineLedger(request.root)
  const pins = readChapterDependencyPins(request.root)
  const batchDigest = changeSummaryDigestOf(request.upstreamChanges)
  const mint = request.newReportId ?? newUlid
  const items: SemanticBatchItem[] = []
  const analyzedChapters: number[] = []
  const skippedChapters: number[] = []

  for (const chapterIndex of chapters) {
    const receiptId = latestReceiptIdForChapter(rows, chapterIndex)
    if (receiptId === null) {
      // 无编译凭证 ⇒ 无「评估哪版编译」可声明（D10）；不编造锚点，记录后跳过。
      // 必须显式留痕：这是「批次看起来接通、其实零动作」的唯一可观测面。
      console.warn(
        `[semantic] 章 ${chapterIndex} 跳过：账本无该章 ContextCompiled 凭证指针（该章未编译），无法声明评估锚点`,
      )
      skippedChapters.push(chapterIndex)
      continue
    }

    // 逐章变更摘要（D17「受影响章 diffs」）：本章钉版真正读到的上游变更。
    // 与 reconcile 传播同一判据（kernel matchStaleDependencies 单缝），不另造匹配。
    const pin = pins.get(chapterIndex)
    const chapterChanges = pin === undefined ? [] : matchStaleDependencies(pin.manifest, request.upstreamChanges)
    if (chapterChanges.length === 0) {
      // 传播命中集里的章必然有非空命中；走到这里说明账本在两读之间变了——显式跳过不猜。
      console.warn(`[semantic] 章 ${chapterIndex} 无逐章变更命中（钉版与上游变更表不一致），跳过`)
      skippedChapters.push(chapterIndex)
      continue
    }
    const chapterDigest = changeSummaryDigestOf(chapterChanges)

    let receipt
    try {
      receipt = loadReceiptForResume(request.root, receiptId)
    } catch (error) {
      // 指针事件存在而凭证缺失 = INV-R1 违例：显式落 stderr，不静默、不伪造锚点。
      console.warn(
        `[semantic] 章 ${chapterIndex} 凭证 ${receiptId} 读回失败，跳过：${(error as Error).message}`,
      )
      skippedChapters.push(chapterIndex)
      continue
    }

    const reconciliationRef = { proposalId: request.proposalId, changeSummaryDigest: batchDigest }
    const anchor = {
      receiptId,
      recomputationHash: receipt.recomputationHash,
      taskType: receipt.taskType,
      chapterIndex,
      reconciliationRef,
    }
    const affectedRefs: readonly AffectedRef[] = [{ chapterIndex, changeSummaryDigest: chapterDigest }]
    const prompt = buildSemanticPrompt({ anchor, affectedRefs })
    items.push({
      taskRef: `semantic:${request.proposalId}:${chapterIndex}`,
      chapterIndex,
      reportId: mint(),
      receiptId,
      recomputationHash: receipt.recomputationHash,
      taskType: receipt.taskType,
      affectedRefs,
      // 输入计量与实际出站文本同源（预算闸 D11 才对得上真实成本）。
      contextTokens: countTokens(prompt.system) + countTokens(prompt.user),
      provider,
      reconciliationRef,
    })
    analyzedChapters.push(chapterIndex)
  }

  if (items.length === 0) {
    return { status: 'skipped', reason: 'no_receipt_anchor', batch: null, analyzedChapters, skippedChapters }
  }

  const batch = await runSemanticBatch({
    bus: new PublishBus(),
    bookRoot: request.root,
    items,
    deps,
  })
  return { status: 'ran', batch, analyzedChapters, skippedChapters }
}

/**
 * 落定回调用的异步旁路触发：不返回 Promise、不抛出——语义层是 advisory-only 旁路，
 * 其失败绝不回灌到已落盘的作者决策（沿 propagateSettledChanges 的失败面纪律）。
 */
export function dispatchSettledSemanticAnalysis(request: SettledSemanticRequest): void {
  void runSettledSemanticAnalysis(request)
    .then((outcome) => {
      if (outcome.status === 'skipped') {
        // 跳过一律已在决策点逐条留痕（provider_unavailable 在 runSettledSemanticAnalysis
        // 的 L0 分支、逐章跳过在循环内 console.warn），此处不重复刷屏；
        // 唯一无留痕的是 no_affected_chapters（零输入、非缺口），本就无需告警。
        return
      }
      const batch = outcome.batch
      if (batch === null) return
      const { reported, refused, deferred } = batch
      console.log(
        `[semantic] 落定语义批次 ${request.proposalId}：reported=${reported} refused=${refused} deferred=${deferred}` +
          `（章 ${outcome.analyzedChapters.join(',') || '-'}；跳过 ${outcome.skippedChapters.join(',') || '-'}）`,
      )
    })
    .catch((error) => {
      console.error(`[semantic] 落定语义批次失败 ${request.proposalId}: ${(error as Error).message}`)
    })
}
