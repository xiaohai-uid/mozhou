/**
 * Receipt 重放引擎（实现票 #25 / T9）——「可复算」的运行时兑现。
 *
 * 冻结依据：context-receipt-physical-format-spec §3.1（复算契约伪代码）·
 * ADR-0021 §4（recomputability = archived minimal replay surface）· INV-R6。
 *
 * 语义一句话（spec §3.1）：任意时刻拿 replayInputs 重跑装配必得同 recomputationHash；
 * 任一输入被改写/退役则 fail loudly 且定位到具体条目——静默分歧在结构上不可能。
 *
 * 复算边界 = 预算装配四阶段（structural/reserve/converge/story_text）；
 * recall_filter 透传条目按 receipt 自身 entries 原样重建（召回本身不承诺逐字节重放，
 * 但淘汰记录是装配输入面的一部分，receipt 内已有权威副本）。embedding 索引漂移
 * 不影响重放：relevanceScore 是召回时点产物，已随 replayInputs 归档（AC2 的根基）。
 */
import type { ContextReceipt } from '@mozhou/kernel'
import {
  CompileConfigError,
  DEFAULT_BUDGET_ASSEMBLY_CONFIG,
  assembleBudgetedContext,
  canonicalJson,
  configVersionOf,
  sha256Hex,
  type AssemblyResult,
  type AssembleInput,
  type BudgetAssemblyConfig,
  type ExactTokenizer,
} from './assemble.js'
import type { RecallExclusion, RecalledCandidate, RecallTier } from './recall.js'

/* ----------------------------------------------------------------------------
 * 错误模式
 * -------------------------------------------------------------------------- */

/** 重放面类别：候选内容 / 结构层 section / 正文切片。 */
export type ReplaySurface = 'candidate' | 'structural_section' | 'story_text_slice'

/** 输入漂移（spec §3.1 InputDrift）：内容变异或退役，ref 定位到具体条目。 */
export class ReplayInputDriftError extends Error {
  constructor(
    readonly surface: ReplaySurface,
    readonly ref: string,
    detail: string,
  ) {
    super(`replay input drift at ${surface} "${ref}": ${detail}`)
    this.name = 'ReplayInputDriftError'
  }
}

/** 重放运行时不一致：tokenizer/config 版本与归档值不符（拿错计量器/配置即拒绝重放）。 */
export class ReplayVersionMismatchError extends Error {
  constructor(kind: 'tokenizer' | 'config', detail: string) {
    super(`replay version mismatch (${kind}): ${detail}`)
    this.name = 'ReplayVersionMismatchError'
  }
}

/** 兜底硬断言：确定性纪律下不可达；触发即装配/重放两侧实现分歧（实现 bug）。 */
export class ReplayHashMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`replay hash mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ReplayHashMismatchError'
  }
}

/* ----------------------------------------------------------------------------
 * 输入契约：内容解析器 + 重放运行时
 * -------------------------------------------------------------------------- */

/**
 * 内容解析器：真源读取的最小接缝（组合根按 id/section 取当前内容；测试用 Map 满足）。
 * 返回 undefined = 条目退役/缺失 ⇒ 显式漂移失败，绝不静默跳过。
 */
export interface ReplayContentResolver {
  candidateContent(id: string): string | undefined
  structuralSectionContent(section: string): string | undefined
  /** 当前正文切片序列（调用方以与原装配相同的切片方式重切；序即语义）。 */
  storyTextSlices(): readonly string[]
}

export interface ReplayRuntime {
  /** 精确计量器；version 必须 === replayInputs.tokenizerVersion。 */
  readonly tokenizer: ExactTokenizer
  /** 缺省 = DEFAULT_BUDGET_ASSEMBLY_CONFIG；configVersion 必须与归档值一致。 */
  readonly config?: BudgetAssemblyConfig | undefined
}

/* ----------------------------------------------------------------------------
 * 主入口：digest 锚校验 → 版本校验 → 内容逐条复核 → 从 replayInputs 重建装配 → 哈希断言
 * -------------------------------------------------------------------------- */

const RECALL_FILTER_REASONS: readonly RecallExclusion['reason'][] = [
  'pov_filtered',
  'interval_not_active',
  'relevance_below_threshold',
  'duplicate',
]

/** INV-R6 锚：inputsDigest ≡ sha256(canonicalJson(replayInputs))——凭证体自洽性前置检查。 */
function assertInputsDigestAnchor(receipt: ContextReceipt): void {
  const actual = sha256Hex(canonicalJson(receipt.replayInputs))
  if (actual !== receipt.inputsDigest) {
    throw new ReplayInputDriftError(
      'candidate',
      'inputsDigest',
      `receipt body inconsistent per INV-R6 anchor: expected ${receipt.inputsDigest}, computed ${actual}`,
    )
  }
}

export function replayReceiptFromInputs(
  receipt: ContextReceipt,
  resolver: ReplayContentResolver,
  runtime: ReplayRuntime,
): AssemblyResult {
  assertInputsDigestAnchor(receipt)
  const replay = receipt.replayInputs

  /* ---- 版本组校验：拿错计量器/配置即拒绝（宁败不假绿） ---- */
  if (runtime.tokenizer.version !== replay.tokenizerVersion) {
    throw new ReplayVersionMismatchError(
      'tokenizer',
      `archived "${replay.tokenizerVersion}" vs provided "${runtime.tokenizer.version}"`,
    )
  }
  const config = runtime.config ?? DEFAULT_BUDGET_ASSEMBLY_CONFIG
  if (configVersionOf(config) !== replay.configVersion) {
    throw new ReplayVersionMismatchError('config', `archived "${replay.configVersion}" does not match provided config`)
  }

  /* ---- 竞争池候选：逐条 digest 复核（漂移定位到 id），终序 = 归档 desirability 序 ---- */
  const candidates: RecalledCandidate[] = replay.candidates.map((candidate) => {
    if (!(candidate.tier in config.tiers)) {
      // tier 词表外的归档值：配置家族不匹配，按编译配置错误显式失败
      throw new CompileConfigError(`archived candidate "${candidate.id}" has unknown tier "${candidate.tier}"`)
    }
    const content = resolver.candidateContent(candidate.id)
    if (content === undefined) {
      throw new ReplayInputDriftError('candidate', candidate.id, 'content source retired or missing')
    }
    const digest = sha256Hex(content)
    if (digest !== candidate.contentDigest) {
      throw new ReplayInputDriftError('candidate', candidate.id, `contentDigest ${digest} != ${candidate.contentDigest}`)
    }
    return {
      id: candidate.id,
      tier: candidate.tier as RecallTier,
      channel: candidate.channel,
      relevanceScore: candidate.relevanceScore,
      ...(candidate.pinned === true ? { pinned: true } : {}),
      ...(candidate.atomicOverride === true ? { atomicOverride: true } : {}),
      ...(candidate.activation === undefined ? {} : { activation: candidate.activation }),
      content,
    }
  })

  /* ---- 结构层：section 名解析当前内容并复核 digest（数组序 = 原注入序） ---- */
  const structuralSections = replay.structuralSections.map((section) => {
    const content = resolver.structuralSectionContent(section.section)
    if (content === undefined) {
      throw new ReplayInputDriftError('structural_section', section.section, 'section source retired or missing')
    }
    const digest = sha256Hex(content)
    if (digest !== section.contentDigest) {
      throw new ReplayInputDriftError(
        'structural_section',
        section.section,
        `contentDigest ${digest} != ${section.contentDigest}`,
      )
    }
    return { section: section.section, content }
  })

  /* ---- 正文切片：长度对齐 + 逐位 digest 复核 ---- */
  const storySlices = resolver.storyTextSlices()
  if (storySlices.length !== replay.storyTextSlices.length) {
    throw new ReplayInputDriftError(
      'story_text_slice',
      '<slices>',
      `slice count ${storySlices.length} != ${replay.storyTextSlices.length}`,
    )
  }
  storySlices.forEach((slice, index) => {
    const archived = replay.storyTextSlices[index]
    if (archived === undefined) {
      throw new ReplayInputDriftError('story_text_slice', `<slice:${index}>`, 'archive row missing')
    }
    const digest = sha256Hex(slice)
    if (digest !== archived.digest) {
      throw new ReplayInputDriftError('story_text_slice', `<slice:${index}>`, `digest ${digest} != ${archived.digest}`)
    }
  })

  /* ---- recall_filter 透传重建：receipt.entries 是淘汰记录的权威副本（ADR-0021 §4） ---- */
  const excluded: RecallExclusion[] = []
  for (const entry of receipt.entries) {
    if (entry.stage !== 'recall_filter') {
      continue
    }
    if (!RECALL_FILTER_REASONS.includes(entry.exclusionReason as RecallExclusion['reason'])) {
      throw new CompileConfigError(
        `recall_filter entry "${entry.identifier}" carries non-recall reason "${String(entry.exclusionReason)}"`,
      )
    }
    excluded.push({
      identifier: entry.identifier,
      reason: entry.exclusionReason as RecallExclusion['reason'],
      ...(entry.assemblySource === undefined ? {} : { channel: entry.assemblySource }),
    })
  }

  /* ---- 从重放面重建装配输入（身份信封取自凭证自身，恒同原件） ---- */
  const input: AssembleInput = {
    task: {
      type: receipt.taskType,
      ...(receipt.chapterIndex === undefined ? {} : { chapterIndex: receipt.chapterIndex }),
    },
    modelProfile: { id: replay.modelProfileId, contextWindow: replay.contextWindowTokens },
    tokenizer: runtime.tokenizer,
    recall: {
      candidates,
      excluded,
      parseFailures: [...receipt.parseFailures],
    },
    structural: { sections: structuralSections },
    storyText: storySlices,
    receiptIdentity: {
      receiptId: receipt.id,
      bookId: receipt.bookId,
      createdAtIso: receipt.createdAt,
    },
    config,
  }

  const result = assembleBudgetedContext(input)

  /* ---- 终局硬断言（spec §3.1 伪代码位；确定性纪律下仅实现分歧可触达） ---- */
  if (result.receipt.recomputationHash !== receipt.recomputationHash) {
    throw new ReplayHashMismatchError(receipt.recomputationHash, result.receipt.recomputationHash)
  }
  return result
}
