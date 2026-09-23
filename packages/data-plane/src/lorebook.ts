/**
 * 世界书（Lorebook）持久层 — 对标 SillyTavern World Info 的条目存储。
 * 落盘：设定/世界书.json（版本化数组，tmp+rename 原子写）。
 * 条目 = 关键词触发器 + 注入内容；命中语义在 context-compiler scanLorebookTriggers。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LOREBOOK_RELPATH = '设定/世界书.json'

export interface LorebookEntry {
  /** 条目 id（lb_ 前缀 + ULID；upsert 以 id 幂等）。 */
  readonly id: string
  readonly title: string
  /** 触发关键词：任一关键词命中草稿/近期正文即注入（SillyTavern keys 语义）。 */
  readonly keywords: readonly string[]
  /** 命中后注入装配上下文的设定文本（world_rule 层）。 */
  readonly content: string
  /** 停用条目保留在书里但不参与扫描。 */
  readonly enabled: boolean
}

interface LorebookFile {
  readonly version: 1
  readonly entries: readonly LorebookEntry[]
}

export class LorebookValidationError extends Error {}

const ID_PATTERN = /^lb_[0-9a-z][0-9a-z-]*$/

function assertValidEntry(entry: LorebookEntry): void {
  if (!ID_PATTERN.test(entry.id)) {
    throw new LorebookValidationError(`世界书条目 id 非法（须匹配 ${ID_PATTERN.source}）：${entry.id}`)
  }
  if (entry.title.trim().length === 0) {
    throw new LorebookValidationError('世界书条目标题不能为空')
  }
  const keywords = entry.keywords.map((k) => k.trim()).filter((k) => k.length > 0)
  if (keywords.length === 0) {
    throw new LorebookValidationError(`世界书条目「${entry.title}」至少需要一个触发关键词`)
  }
  if (entry.content.trim().length === 0) {
    throw new LorebookValidationError(`世界书条目「${entry.title}」注入内容不能为空`)
  }
  if (typeof entry.enabled !== 'boolean') {
    throw new LorebookValidationError(`世界书条目「${entry.title}」enabled 必须为布尔值`)
  }
}

function readLorebookFile(root: string): LorebookFile {
  const absolute = join(root, LOREBOOK_RELPATH)
  if (!existsSync(absolute)) {
    return { version: 1, entries: [] }
  }
  const raw: unknown = JSON.parse(readFileSync(absolute, 'utf8'))
  if (raw === null || typeof raw !== 'object' || !Array.isArray((raw as LorebookFile).entries)) {
    throw new LorebookValidationError(`${LOREBOOK_RELPATH} 结构非法（缺少 entries 数组）`)
  }
  return raw as LorebookFile
}

function writeLorebookFile(root: string, file: LorebookFile): void {
  const absolute = join(root, LOREBOOK_RELPATH)
  mkdirSync(join(root, '设定'), { recursive: true })
  const tmp = absolute + '.tmp'
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
  renameSync(tmp, absolute)
}

/** 读世界书（缺文件 = 空世界书，不视为结构违例）。 */
export function readLorebook(root: string): readonly LorebookEntry[] {
  return readLorebookFile(root).entries
}

/** 幂等 upsert：同 id 覆盖，新 id 追加（保持插入序）。 */
export function upsertLorebookEntry(root: string, entry: LorebookEntry): readonly LorebookEntry[] {
  assertValidEntry(entry)
  const file = readLorebookFile(root)
  const normalized: LorebookEntry = {
    ...entry,
    title: entry.title.trim(),
    keywords: entry.keywords.map((k) => k.trim()).filter((k) => k.length > 0),
    content: entry.content.trim(),
  }
  const entries = file.entries.some((existing) => existing.id === normalized.id)
    ? file.entries.map((existing) => (existing.id === normalized.id ? normalized : existing))
    : [...file.entries, normalized]
  writeLorebookFile(root, { version: 1, entries })
  return entries
}

/** 按 id 删除；id 不存在时抛错（调用方显式感知，不静默）。 */
export function deleteLorebookEntry(root: string, id: string): readonly LorebookEntry[] {
  const file = readLorebookFile(root)
  if (!file.entries.some((entry) => entry.id === id)) {
    throw new LorebookValidationError(`世界书条目不存在：${id}`)
  }
  const entries = file.entries.filter((entry) => entry.id !== id)
  writeLorebookFile(root, { version: 1, entries })
  return entries
}
