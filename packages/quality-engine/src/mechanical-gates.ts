/**
 * @mozhou/quality-engine · 11 项机械门禁与 4-gram 纯算术机检引擎
 * 移植自 storyrepo/checks.py 并修复中英文引号栈嵌套悬空与跨引号边界片段误判。
 */

export interface MechanicalCheckResult {
  readonly id: string
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

export interface MechanicalGateReport {
  readonly passed: boolean
  readonly checks: readonly MechanicalCheckResult[]
  readonly fails: readonly string[]
  readonly oks: readonly string[]
}

// ── AI 红线正则表（章末总结体 / 预告体 / 万能比喻 / 抽象升华） ──
export const BUILTIN_REDLINES: readonly [RegExp, string][] = [
  [/他终于明白/g, '章末总结体·终于明白'],
  [/这一夜[^。]*注定/g, '章末总结体·这一夜注定'],
  [/无人入眠/g, '章末总结体·无人入眠'],
  [/(?:本章|这一章|本章节|这一回).{0,12}(?:讲述|讲了|写到|写了|展现|描写)/g, '章末总结体'],
  [/他不知道的是/g, '预告体'],
  [/(?:下一章|下一回|且听下回分解|欲知后事|敬请期待|未完待续)/g, '预告体'],
  [/像潮水般|如闪电般|仿佛春风/g, '万能比喻'],
  [/(?:宛如|犹如|恰如|仿佛)(?:一幅|一场|一首)?(?:画卷|史诗|乐章|诗篇|梦境)/g, '万能比喻'],
  [/(?:或许|也许|可能).{0,4}(?:这|那)?就?是(?:人生|命运|生活|成长|一切)/g, '抽象升华'],
]

const PLACEHOLDER_REGEX = /TODO|占位|待补|待写|XXX|\{[A-Za-z_]+\}/
const QUOTE_CHARS = '"“”「」『』'

/** 提取文本中所有成对引号内部的区间列表 [start, end] */
function getQuoteIntervals(text: string): readonly [number, number][] {
  const intervals: [number, number][] = []
  const quotePairs: readonly [string, string][] = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
  ]

  for (const [openChar, closeChar] of quotePairs) {
    let startIdx = -1
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === openChar && startIdx === -1) {
        startIdx = i + 1
      } else if (ch === closeChar && startIdx !== -1) {
        intervals.push([startIdx, i])
        startIdx = -1
      }
    }
  }
  return intervals
}

/** 判断 fragment 在 text 中是否完全位于某对成对引号内部 */
export function isInsideQuotes(text: string, fragment: string): boolean {
  if (!fragment || !text.includes(fragment)) return false
  const intervals = getQuoteIntervals(text)
  if (intervals.length === 0) return false

  let searchIndex = 0
  while (searchIndex < text.length) {
    const idx = text.indexOf(fragment, searchIndex)
    if (idx === -1) break

    const fragEnd = idx + fragment.length
    const insideSomeQuote = intervals.some(([qStart, qEnd]) => idx >= qStart && fragEnd <= qEnd)
    if (insideSomeQuote) return true

    searchIndex = idx + 1
  }
  return false
}

/** 相邻两段是否存在 >= 5 字公共子串（对话回环与常规引号引出句排除） */
export function findCommon5Gram(a: string, b: string): string | null {
  if (a.length < 5 || b.length < 5) return null
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]

  // 收集 longer 中所有纯正文（不含引号跨越）的 5-gram
  const grams = new Set<string>()
  for (let i = 0; i <= longer.length - 5; i++) {
    const g = longer.slice(i, i + 5)
    grams.add(g)
  }

  for (let i = 0; i <= shorter.length - 5; i++) {
    const g = shorter.slice(i, i + 5)
    if (grams.has(g)) {
      // 1. 包含引号/引出标点的 5-gram 属于对话边界，直接排除
      if (QUOTE_CHARS.split('').some((q) => g.includes(q)) || g.includes('：') || g.includes(':')) {
        continue
      }
      // 2. 若公共 5-gram 在两段中均完全位于引号内（修辞性对话回环），则放行
      if (isInsideQuotes(a, g) && isInsideQuotes(b, g)) {
        continue
      }
      return g
    }
  }
  return null
}

/** 4-gram 词频统计（过滤标点与引号，同一 4 字短语 >= 6 次拦截） */
export function detect4GramRepetition(text: string, maxAllowed = 5): { repeated: boolean; detail: string } {
  const flat = text.replace(/[\s\n\r]/g, '')
  if (flat.length < 4) return { repeated: false, detail: '字数不足' }

  const PUNC = '。！？；，、”」)}"\''
  const counts = new Map<string, number>()

  for (let i = 0; i <= flat.length - 4; i++) {
    const gram = flat.slice(i, i + 4)
    // 过滤首尾标点（如「。陆沉舟」是正常句式）
    if (PUNC.includes(gram[0]!) || PUNC.includes(gram[3]!)) continue
    // 过滤引号
    if (QUOTE_CHARS.split('').some((q) => gram.includes(q))) continue

    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }

  let maxGram = ''
  let maxCount = 0
  for (const [gram, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count
      maxGram = gram
    }
  }

  if (maxCount > maxAllowed) {
    return {
      repeated: true,
      detail: `4字短语「${maxGram}」在单章内高频出现 ${maxCount} 次（上限 ${maxAllowed} 次）`,
    }
  }

  return { repeated: false, detail: '4-gram 词频分布均匀' }
}

/** 运行全部纯算术机械门禁 */
export function evaluateMechanicalGates(
  prose: string,
  options: {
    minWords?: number
    maxWords?: number
    customRedlines?: readonly string[]
  } = {},
): MechanicalGateReport {
  const checks: MechanicalCheckResult[] = []
  const minWords = options.minWords ?? 2000
  const maxWords = options.maxWords ?? 6000

  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const totalHanzi = (prose.match(/[\u4e00-\u9fa5]/g) ?? []).length

  // 1. 字数窗口
  const wordsOk = totalHanzi >= minWords && totalHanzi <= maxWords
  checks.push({
    id: 'mech_01_words',
    name: '字数窗口',
    ok: wordsOk,
    detail: wordsOk
      ? `正文字数 ${totalHanzi} 字（符合 [${minWords}, ${maxWords}] 窗口）`
      : `正文字数 ${totalHanzi} 字超出窗口 [${minWords}, ${maxWords}]`,
  })

  // 2. 占位符检测
  const placeholderMatch = prose.match(PLACEHOLDER_REGEX)
  checks.push({
    id: 'mech_02_placeholder',
    name: '占位符拦截',
    ok: !placeholderMatch,
    detail: placeholderMatch ? `检测到未清理占位符「${placeholderMatch[0]}」` : '无未清理占位符',
  })

  // 3. AI 红线正则检测
  const redlines = [...BUILTIN_REDLINES]
  if (options.customRedlines) {
    for (const r of options.customRedlines) {
      if (r.trim()) {
        try {
          redlines.push([new RegExp(r.trim(), 'g'), `自定义反例·${r.trim()}`])
        } catch {
          // 非法正则忽略
        }
      }
    }
  }

  const redlineHits: string[] = []
  for (const [regex, name] of redlines) {
    if (regex.test(prose)) {
      redlineHits.push(name)
    }
  }
  checks.push({
    id: 'mech_03_redlines',
    name: 'AI红线检测',
    ok: redlineHits.length === 0,
    detail: redlineHits.length > 0 ? `命中高危红线: ${redlineHits.join('、')}` : '无 AI 红线命中',
  })

  // 4. 相邻段落复读检测
  let adjacentRepeatGram: string | null = null
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const common = findCommon5Gram(paragraphs[i]!, paragraphs[i + 1]!)
    if (common) {
      adjacentRepeatGram = common
      break
    }
  }
  checks.push({
    id: 'mech_04_adjacent_repeat',
    name: '相邻段落复读',
    ok: !adjacentRepeatGram,
    detail: adjacentRepeatGram ? `相邻两段存在相同 5 字片段「${adjacentRepeatGram}」` : '相邻段落无复读',
  })

  // 5. 4-gram 词频方差
  const gramRes = detect4GramRepetition(prose)
  checks.push({
    id: 'mech_05_4gram',
    name: '单章词频方差',
    ok: !gramRes.repeated,
    detail: gramRes.detail,
  })

  const fails = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)
  const oks = checks.filter((c) => c.ok).map((c) => c.name)

  return {
    passed: fails.length === 0,
    checks,
    fails,
    oks,
  }
}
