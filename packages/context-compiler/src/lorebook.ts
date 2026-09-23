/**
 * 世界书关键词触发通道 — 对标 SillyTavern World Info activation：
 * 任一关键词命中扫描文本 ⇒ 条目作为 world_rule 层设定候选并入装配。
 * 输出为标准 ChannelInput（channel 'keyword'），与实体卡快通道同池合并、同预算竞争。
 */
import type { ChannelInput } from './recall.js'

/** 世界书条目扫描面（data-plane LorebookEntry 结构性满足）。 */
export interface LorebookScanEntry {
  readonly id: string
  readonly title: string
  readonly keywords: readonly string[]
  readonly content: string
  readonly enabled: boolean
}

export interface LorebookScanOptions {
  /** 基础分（∈[0,1]）；命中更多关键词按 step 递增，封顶 0.85（低于实体卡主名分，设定补充语义）。 */
  readonly baseScore?: number
  readonly step?: number
}

const DEFAULT_BASE_SCORE = 0.55
const DEFAULT_STEP = 0.1
const MAX_SCORE = 0.85

function countKeywordHits(text: string, keyword: string): number {
  if (keyword.length === 0) return 0
  let count = 0
  let cursor = text.indexOf(keyword)
  while (cursor !== -1) {
    count += 1
    cursor = text.indexOf(keyword, cursor + keyword.length)
  }
  return count
}

/** 关键词触发扫描：disabled/空关键词/空内容条目跳过；多条关键词命中取最高分。 */
export function scanLorebookTriggers(
  entries: readonly LorebookScanEntry[],
  text: string,
  options: LorebookScanOptions = {},
): ChannelInput {
  const base = options.baseScore ?? DEFAULT_BASE_SCORE
  const step = options.step ?? DEFAULT_STEP

  const entriesOut: {
    readonly id: string
    readonly tier: 'world_rule'
    readonly relevanceScore: number
    readonly activation: { kind: 'keyword'; keys: string[] }
    readonly content: string
  }[] = []
  for (const entry of entries) {
    if (!entry.enabled) continue
    const keywords = entry.keywords.map((k) => k.trim()).filter((k) => k.length > 0)
    if (keywords.length === 0 || entry.content.trim().length === 0) continue

    let bestHits = 0
    const matchedKeys: string[] = []
    for (const keyword of keywords) {
      const hits = countKeywordHits(text, keyword)
      if (hits > 0) {
        matchedKeys.push(keyword)
        bestHits = Math.max(bestHits, hits)
      }
    }
    if (matchedKeys.length === 0) continue

    const score = Math.min(MAX_SCORE, base + step * (bestHits - 1))
    entriesOut.push({
      id: entry.id,
      tier: 'world_rule',
      relevanceScore: score,
      activation: { kind: 'keyword', keys: matchedKeys },
      content: entry.content.trim(),
    })
  }

  return {
    channel: 'keyword',
    entries: entriesOut,
  }
}
