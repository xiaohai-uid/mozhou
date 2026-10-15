/**
 * apps/web/server/recycle · 回收站（软删除 + 恢复）。
 *
 * 对应 OpenWrite 的回收站设计：删除不是抹掉，而是移到隔离区并留一条可恢复的记录。
 * 工具层的 `file_manage` 删除动作走这里（`ToolHost.trash`），所以「智能体能删文件」
 * 不等于「内容会丢」——这是工具层敢于开放删除的前提。
 *
 * 布局（回收站根之下，一条一个目录）：
 *   <id>/meta.json   原始路径、删除时间、是否目录
 *   <id>/payload     被移走的内容本体
 *
 * 恢复策略：原路径已被占用时**拒绝恢复**，绝不覆盖新内容。用户可自行改回或先清理。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'

const META_FILE = 'meta.json'
const PAYLOAD = 'payload'

export interface TrashEntry {
  readonly id: string
  readonly originalPath: string
  readonly name: string
  readonly deletedAt: string
  readonly isDirectory: boolean
}

export type RestoreResult =
  | { readonly ok: true; readonly restoredTo: string }
  | { readonly ok: false; readonly error: string }

export class RecycleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RecycleError'
  }
}

/** 条目 id：时间戳 + 随机后缀，既能排序又不重名（用 CSPRNG，避免可预测与撞名）。 */
function newEntryId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '')
  return stamp + '-' + randomBytes(4).toString('hex')
}

/**
 * 把条目 id 解析成回收站根之下的目录。
 *
 * 刻意**不用 `resolve(id)`**：`resolve` 会把 id 当成相对 cwd 的路径，外部传入的
 * `../../x` 或绝对路径会直接绕过回收站根目录。这里先按白名单字符校验，再用 `join` 拼，
 * 保证结果一定落在 root 之下；不合法一律返回 null（调用方按「条目不存在」处理）。
 */
function entryDirFor(root: string, id: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
  return join(root, id)
}

function readEntryMeta(dir: string): TrashEntry | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8')) as Partial<TrashEntry>
    if (typeof parsed.id !== 'string' || typeof parsed.originalPath !== 'string' || typeof parsed.deletedAt !== 'string') {
      return null
    }
    return {
      id: parsed.id,
      originalPath: parsed.originalPath,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.originalPath,
      deletedAt: parsed.deletedAt,
      isDirectory: parsed.isDirectory === true,
    }
  } catch {
    return null
  }
}

export class RecycleStore {
  private readonly root: string

  constructor(options: { readonly root: string }) {
    this.root = resolve(options.root)
  }

  get trashRoot(): string {
    return this.root
  }

  /** 把目标移入回收站。目标不存在即显式失败，不假装成功。 */
  trash(targetPath: string, now: Date = new Date()): TrashEntry {
    const target = resolve(targetPath)
    if (!existsSync(target)) {
      throw new RecycleError(404, 'TRASH_TARGET_MISSING', '要删除的路径不存在：' + target)
    }
    const isDirectory = statSync(target).isDirectory()
    const id = newEntryId(now)
    const entryDir = join(this.root, id)
    mkdirSync(entryDir, { recursive: true })
    const entry: TrashEntry = {
      id,
      originalPath: target,
      name: target.split(/[\\/]/).filter(Boolean).pop() ?? target,
      deletedAt: now.toISOString(),
      isDirectory,
    }
    writeFileSync(join(entryDir, META_FILE), JSON.stringify(entry, null, 2), 'utf8')
    renameSync(target, join(entryDir, PAYLOAD))
    return entry
  }

  /** 列出回收站条目，最近删除的在前。损坏条目跳过而不是让整表失败。 */
  list(): readonly TrashEntry[] {
    if (!existsSync(this.root)) return []
    const entries: TrashEntry[] = []
    for (const name of readdirSync(this.root)) {
      const dir = join(this.root, name)
      if (!statSync(dir).isDirectory()) continue
      const meta = readEntryMeta(dir)
      if (meta !== null) entries.push(meta)
    }
    return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  /** 恢复一条。原路径被占用时拒绝，绝不覆盖。 */
  restore(id: string): RestoreResult {
    const entryDir = entryDirFor(this.root, id)
    if (entryDir === null) return { ok: false, error: '回收站条目不存在：' + id }
    const meta = existsSync(entryDir) ? readEntryMeta(entryDir) : null
    if (meta === null) return { ok: false, error: '回收站条目不存在：' + id }
    const payload = join(entryDir, PAYLOAD)
    if (!existsSync(payload)) return { ok: false, error: '回收站条目内容缺失，无法恢复：' + id }
    if (existsSync(meta.originalPath)) {
      return { ok: false, error: '原路径已被占用，拒绝覆盖：' + meta.originalPath }
    }
    try {
      mkdirSync(resolve(meta.originalPath, '..'), { recursive: true })
      renameSync(payload, meta.originalPath)
    } catch (error) {
      return { ok: false, error: '恢复失败：' + (error as Error).message }
    }
    rmSync(entryDir, { recursive: true, force: true })
    return { ok: true, restoredTo: meta.originalPath }
  }

  /** 彻底删除一条（不可恢复）。 */
  purge(id: string): boolean {
    const entryDir = entryDirFor(this.root, id)
    if (entryDir === null) return false
    if (!existsSync(entryDir)) return false
    rmSync(entryDir, { recursive: true, force: true })
    return !existsSync(entryDir)
  }
}
