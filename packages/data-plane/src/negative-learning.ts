/**
 * @mozhou/data-plane · AI 味反例动态吸收与金句收割引擎 (Learn Engine)
 * 移植自 storyrepo/learn.py 并消除写死目录耦合，适配墨舟 data-plane。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'

export const MAX_COUNTEREXAMPLES = 200
export const MAX_EVIDENCE_LEN = 20
export const MAX_QUOTE_LEN = 25
export const MAX_PER_CHAPTER_QUOTES = 5

function counterexamplesPath(root: string): string {
  const customStyleDir = join(root, '设定', '文风')
  if (existsSync(customStyleDir)) {
    return join(customStyleDir, '审查反例库.md')
  }
  return join(root, '文风', '审查反例库.md')
}

function quotesDirPath(root: string): string {
  const customStyleDir = join(root, '设定', '文风')
  if (existsSync(customStyleDir)) {
    return join(customStyleDir, '金句库')
  }
  return join(root, '文风', '金句库')
}

/** 读取当前书仓的动态审查反例库列表 */
export function readCounterexamples(root: string): string[] {
  const p = counterexamplesPath(root)
  if (!existsSync(p)) return []

  try {
    const text = readFileSync(p, 'utf-8')
    return text
      .split('\n')
      .map((ln) => ln.trim())
      .filter((ln) => ln.length > 0 && !ln.startsWith('#'))
  } catch {
    return []
  }
}

/**
 * 吸收审查报告中的 AI 味反例：
 * 严重度属于 high 或 critical 且 category == 'ai_flavor' 的短句（<= 20 字），
 * 与既有反例去重后存盘（上限 200 条，超限淘汰旧条目）。返回新增条数。
 */
export function absorbReviewCounterexamples(
  root: string,
  issues: readonly { category: string; severity: string; evidence?: string }[],
): number {
  const existing = readCounterexamples(root)
  const seen = new Set(existing)
  const newItems: string[] = []

  for (const i of issues) {
    if (i.category !== 'ai_flavor') continue
    if (i.severity !== 'critical' && i.severity !== 'high') continue

    const ev = (i.evidence ?? '').trim()
    if (ev && !ev.includes('\n') && ev.length <= MAX_EVIDENCE_LEN && !seen.has(ev)) {
      seen.add(ev)
      newItems.push(ev)
    }
  }

  if (newItems.length === 0) return 0

  const p = counterexamplesPath(root)
  mkdirSync(join(p, '..'), { recursive: true })

  let entries = [...existing, ...newItems]
  if (entries.length > MAX_COUNTEREXAMPLES) {
    entries = entries.slice(-MAX_COUNTEREXAMPLES)
  }

  const content = `# 审查反例库（AI 味高危短语，机检动态合并）\n\n${entries.join('\n')}\n`
  atomicWriteFileSync(p, content)

  return newItems.length
}

/**
 * 收割独立成段的短金句（<= 25 字、无对话引出词 他说/她道），
 * 每章上限 5 条，去重后写入 金句库/{NNN}.md。
 */
export function harvestQuotesFromProse(
  root: string,
  chapterIndex: number,
  prose: string,
): string[] {
  const paragraphs = prose
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const candidates: string[] = []
  for (const p of paragraphs) {
    if (p.length > MAX_QUOTE_LEN) continue
    if (p.startsWith('#') || p.startsWith('*') || p.startsWith('-') || p.startsWith('>')) continue
    if (!/[。！？!?]$/.test(p)) continue
    if (p.includes('他说') || p.includes('她道') || p.includes('道：') || p.includes('说：')) continue

    candidates.push(p)
    if (candidates.length >= MAX_PER_CHAPTER_QUOTES) break
  }

  if (candidates.length === 0) return []

  const d = quotesDirPath(root)
  mkdirSync(d, { recursive: true })
  const targetFile = join(d, `${String(chapterIndex).padStart(3, '0')}.md`)

  const content = `# 第 ${chapterIndex} 章 摘录金句\n\n${candidates.join('\n')}\n`
  atomicWriteFileSync(targetFile, content)

  return candidates
}
