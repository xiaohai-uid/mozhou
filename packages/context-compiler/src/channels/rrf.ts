/**
 * @mozhou/context-compiler · channels/rrf.ts
 * 加权倒数排名融合（Weighted Reciprocal Rank Fusion, RRF · P1-2）。
 * 独立通道模块：从 recall.ts 抽取，聚焦排序融合算法本身。
 * 自包含设计：只依赖 @mozhou/kernel 的 AssemblyChannel 类型，不反向引用
 * recall.ts（结构化类型天然兼容），彻底消除模块间循环依赖。
 */
import type { AssemblyChannel } from '@mozhou/kernel'

/** 通道输入条目的最小结构（与 recall.ts ChannelInput 结构化兼容）。 */
export interface RRFEntryLike {
  readonly id: string
  readonly tier: 'entity_card' | 'world_rule' | 'active_fact' | 'distant_recall' | 'promise_due'
  readonly relevanceScore: number
  readonly pinned?: boolean | undefined
  readonly atomicOverride?: boolean | undefined
  readonly content?: string | undefined
}

/** 通道输入（与 recall.ts ChannelInput 结构化兼容）。 */
export interface RRFChannelInput {
  readonly channel: AssemblyChannel
  readonly entries: readonly RRFEntryLike[]
  readonly exclusions?: readonly {
    readonly identifier: string
    readonly reason: 'pov_filtered' | 'interval_not_active' | 'relevance_below_threshold' | 'duplicate'
    readonly channel?: AssemblyChannel | undefined
  }[] | undefined
  readonly parseFailures?: readonly unknown[] | undefined
}

/** 融合结果（与 recall.ts RecallResult 结构化兼容）。 */
export interface RRFResult {
  readonly candidates: readonly RRFEntryLike[]
  readonly excluded: readonly {
    readonly identifier: string
    readonly reason: 'pov_filtered' | 'interval_not_active' | 'relevance_below_threshold' | 'duplicate'
    readonly channel?: AssemblyChannel | undefined
  }[]
  readonly parseFailures: readonly unknown[]
}

export interface RRFChannelWeights {
  readonly keyword?: number | undefined
  readonly graph_khop?: number | undefined
  readonly embedding?: number | undefined
}

export interface RRFMergeOptions {
  /** RRF 平滑分母常量，论文与实践基准推荐 k=60 */
  readonly k?: number | undefined
  /** 各通道加权系数，缺省 1.0 */
  readonly weights?: RRFChannelWeights | undefined
}

/**
 * 加权倒数排名融合。
 * 遵循终审裁决（Q4）：
 * 1. 严格在 G0 时态与 POV 权限前置硬过滤之后执行；
 * 2. 对各通道内部条目按分数降序排序确定 1-based rank；
 * 3. 累计公式：score(d) = Σ (w_i / (k + rank_i(d)))；
 * 4. 同 id 去重，保留组合 RRF 得分；
 * 5. 最终按融合分降序，平局按 id ASC 确定性排序。
 */
export function mergeChannelsWithRRF(
  channels: readonly RRFChannelInput[],
  options: RRFMergeOptions = {},
): RRFResult {
  const k = options.k ?? 60
  const weights: Partial<Record<AssemblyChannel, number>> = {
    keyword: options.weights?.keyword ?? 1.0,
    graph_khop: options.weights?.graph_khop ?? 1.0,
    embedding: options.weights?.embedding ?? 1.0,
  }

  const rrfScores = new Map<string, number>()
  const entryMeta = new Map<string, { tier: RRFEntryLike['tier']; primaryChannel: AssemblyChannel; content: string; pinned?: boolean; atomicOverride?: boolean }>()
  const exclusions: {
    readonly identifier: string
    readonly reason: 'pov_filtered' | 'interval_not_active' | 'relevance_below_threshold' | 'duplicate'
    readonly channel?: AssemblyChannel | undefined
  }[] = []
  for (const channel of channels) {
    if (channel.exclusions) exclusions.push(...channel.exclusions)

    const sortedEntries = [...channel.entries].sort((a, b) => b.relevanceScore - a.relevanceScore)
    const seen = new Set<string>()

    sortedEntries.forEach((entry, idx) => {
      if (seen.has(entry.id)) return
      seen.add(entry.id)

      const rank = idx + 1
      const weight = weights[channel.channel] ?? 1.0
      const contribution = weight / (k + rank)

      const currentScore = rrfScores.get(entry.id) ?? 0
      rrfScores.set(entry.id, currentScore + contribution)

      const meta = entryMeta.get(entry.id)
      entryMeta.set(entry.id, {
        tier: meta?.tier ?? entry.tier,
        primaryChannel: meta?.primaryChannel ?? channel.channel,
        content: meta?.content ?? entry.content ?? '',
        pinned: (meta?.pinned ?? false) || entry.pinned === true,
        atomicOverride: (meta?.atomicOverride ?? false) || entry.atomicOverride === true,
      })
    })
  }

  const candidates: RRFEntryLike[] = Array.from(rrfScores.entries()).map(([id, score]) => {
    const meta = entryMeta.get(id)!
    return {
      id,
      tier: meta.tier,
      channel: meta.primaryChannel,
      content: meta.content,
      relevanceScore: Math.round(score * 10000) / 10000,
      ...(meta.pinned ? { pinned: true } : {}),
      ...(meta.atomicOverride ? { atomicOverride: true } : {}),
    }
  })

  candidates.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1
    }
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore
    }
    return a.id.localeCompare(b.id)
  })

  const parseFailures = channels.flatMap((channel) => channel.parseFailures ?? [])

  return { candidates, excluded: exclusions, parseFailures }
}
