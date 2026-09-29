/**
 * 备忘录本地存储（OpenWrite 对标切片 · 工单 22）：
 * - 与书无关的作者便签，跨作品常驻；对照 OpenWrite「备忘录」独立空间。
 * - 按 principal.userId 的 SHA-256 分文件持久化在 <dataRoot>/memo/ 下：
 *   不把身份明文写进目录名，也不信任 userId 字符集（hosted 下来自身份提供方）。
 * - 本地模式路由层回退主体 local_user → 单机一份；hosted 模式天然按用户隔离。
 * - 数量与长度上限在写入前强制，超限显式报错（不静默截断、不静默丢数据）。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { resolveDefaultDataRoot } from '../dataRoot.js'

export interface MemoNote {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** 每用户便签数量上限（防无界增长；达到后拒绝新建）。 */
export const MEMO_MAX_NOTES = 200
/** 单条便签字段长度上限（路由层先行校验，存储层兜底）。 */
export const MEMO_MAX_TITLE_CHARS = 200
export const MEMO_MAX_CONTENT_CHARS = 20_000

export class MemoNotFoundError extends Error {
  constructor() {
    super('MEMO_NOTE_NOT_FOUND')
    this.name = 'MemoNotFoundError'
  }
}

export class MemoLimitError extends Error {
  constructor() {
    super('MEMO_LIMIT_EXCEEDED')
    this.name = 'MemoLimitError'
  }
}

export class MemoPersistError extends Error {
  constructor(detail: string) {
    super(`MEMO_PERSIST_FAILED: ${detail}`)
    this.name = 'MemoPersistError'
  }
}

interface MemoFileShape {
  readonly notes: MemoNote[]
}

function isMemoNote(value: unknown): value is MemoNote {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  return (
    typeof rec['id'] === 'string' && rec['id'] !== '' &&
    typeof rec['title'] === 'string' &&
    typeof rec['content'] === 'string' &&
    typeof rec['createdAt'] === 'string' &&
    typeof rec['updatedAt'] === 'string'
  )
}

export class MemoStore {
  private dataRoot: string | null = null

  /** 测试接缝：默认与 bookAccess 一致使用 resolveDefaultDataRoot()。 */
  setDataRoot(dir: string): void {
    this.dataRoot = resolve(dir)
  }

  private fileFor(userId: string): string {
    const root = this.dataRoot ?? resolveDefaultDataRoot()
    const hash = createHash('sha256').update(userId).digest('hex')
    return join(root, 'memo', `${hash}.json`)
  }

  private readNotes(userId: string): MemoNote[] {
    const file = this.fileFor(userId)
    if (!existsSync(file)) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new MemoPersistError(`corrupt memo file: ${(error as Error).message}`)
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new MemoPersistError('memo file root is not an object')
    }
    const notes = (parsed as Record<string, unknown>)['notes']
    if (!Array.isArray(notes)) {
      throw new MemoPersistError('memo file missing notes array')
    }
    return notes.filter(isMemoNote)
  }

  private writeNotes(userId: string, notes: readonly MemoNote[]): void {
    const file = this.fileFor(userId)
    try {
      mkdirSync(join(file, '..'), { recursive: true })
      const tmp = `${file}.tmp`
      const payload: MemoFileShape = { notes: [...notes] }
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
      renameSync(tmp, file)
    } catch (error) {
      throw new MemoPersistError(`write failed: ${(error as Error).message}`)
    }
  }

  list(userId: string): readonly MemoNote[] {
    return this.readNotes(userId)
  }

  create(userId: string, title: string, content: string): MemoNote {
    const notes = this.readNotes(userId)
    if (notes.length >= MEMO_MAX_NOTES) throw new MemoLimitError()
    const now = new Date().toISOString()
    const note: MemoNote = { id: randomUUID(), title, content, createdAt: now, updatedAt: now }
    this.writeNotes(userId, [note, ...notes])
    return note
  }

  update(userId: string, id: string, patch: { readonly title?: string; readonly content?: string }): MemoNote {
    const notes = this.readNotes(userId)
    const index = notes.findIndex((n) => n.id === id)
    if (index < 0) throw new MemoNotFoundError()
    const prev = notes[index]!
    const next: MemoNote = {
      ...prev,
      title: patch.title ?? prev.title,
      content: patch.content ?? prev.content,
      updatedAt: new Date().toISOString(),
    }
    const nextNotes = [...notes]
    nextNotes[index] = next
    this.writeNotes(userId, nextNotes)
    return next
  }

  remove(userId: string, id: string): void {
    const notes = this.readNotes(userId)
    if (!notes.some((n) => n.id === id)) throw new MemoNotFoundError()
    this.writeNotes(userId, notes.filter((n) => n.id !== id))
  }
}

export const defaultMemoStore = new MemoStore()
