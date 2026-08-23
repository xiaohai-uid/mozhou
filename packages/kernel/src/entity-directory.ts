/**
 * 实体目录卡检测语义（工单 #16 / T2；冻结依据 entity-directory-spec Q3/§5）：
 *
 *   - exact 全串匹配优先、regex 兜底变体（中文分词不可靠的对策）；
 *   - 数组顺序即优先级：逐卡取第一个命中的规则，命中即该卡入候选集；
 *   - caseSensitive 默认 false，仅影响拉丁字母；
 *   - 卡级排除词表按出现位置压制：与排除词发生区间重叠的那次命中不触发，
 *     同规则的其余出现位置与其后的低优先规则照常参与（「老王 vs 老王村」场景）。
 *
 * 本函数是 keyword 快通道（#7 决议②三通道之一）的纯匹配内核：
 * 零依赖、零 IO、零 LLM；扫描面与时机归 T8a 召回票接线。
 */
import type { AliasRule, EntityRef } from './kernel-schema.js'

/** 检测输入的最小结构面（EntityCardFrontmatter 结构性满足）。 */
export interface DetectableEntity {
  readonly ref: EntityRef;
  readonly aliases?: readonly AliasRule[];
  readonly excludedPhrases?: readonly string[];
}

/** 单卡命中记录：只报每卡胜出（最高优先）的那次命中。 */
export interface EntityMention {
  readonly ref: EntityRef;
  /** 盘文里实际命中的子串。 */
  readonly matchedText: string;
  /** 胜出别名规则的下标（数组顺序即优先级）。 */
  readonly aliasIndex: number;
  readonly kind: 'exact' | 'regex';
}

interface Span {
  readonly start: number;
  readonly end: number;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

function findExactOccurrences(haystack: string, needle: string, caseSensitive: boolean): Span[] {
  const hay = caseSensitive ? haystack : haystack.toLowerCase()
  const nee = caseSensitive ? needle : needle.toLowerCase()
  if (nee.length === 0) {
    return []
  }
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

function findRegexOccurrences(haystack: string, pattern: string, caseSensitive: boolean): Span[] {
  // 每次新建正则：g 标志 + matchAll 的状态不跨调用泄漏；u 标志保证 CJK 字符类语义
  const matcher = new RegExp(pattern, caseSensitive ? 'gu' : 'giu')
  const spans: Span[] = []
  for (const match of haystack.matchAll(matcher)) {
    if (match[0].length > 0) {
      spans.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return spans
}

/**
 * 对给定文本跑实体目录检测，返回全部命中实体（每卡一条，保持入参卡序）。
 * 无卡引用合法（D6）：文本里出现没有卡的名词不产生任何输出——检测只覆盖有卡实体。
 */
export function detectEntityMentions(
  entities: readonly DetectableEntity[],
  text: string,
): EntityMention[] {
  if (text.length === 0) {
    return []
  }

  const mentions: EntityMention[] = []
  for (const entity of entities) {
    const aliases = entity.aliases ?? []
    const excludedSpans: Span[] = []
    for (const phrase of entity.excludedPhrases ?? []) {
      // 排除词一律大小写不敏感比对（消歧辅助词，非检测键）
      excludedSpans.push(...findExactOccurrences(text, phrase, false))
    }

    // 数组顺序即优先级：第一条存在「未被排除压制的出现位置」的规则胜出
    for (const [index, rule] of aliases.entries()) {
      if (rule.text.length === 0) {
        continue
      }
      const occurrences =
        rule.kind === 'regex'
          ? findRegexOccurrences(text, rule.text, rule.caseSensitive ?? false)
          : findExactOccurrences(text, rule.text, rule.caseSensitive ?? false)
      const surviving = occurrences.find((span) => !excludedSpans.some((excluded) => overlaps(span, excluded)))
      if (surviving !== undefined) {
        mentions.push({
          ref: entity.ref,
          matchedText: text.slice(surviving.start, surviving.end),
          aliasIndex: index,
          kind: rule.kind,
        })
        break
      }
    }
  }
  return mentions
}
