/**
 * apps/web · 作品访问控制、多租户沙箱与每书队列 (Book Access Control · T09)。
 * 
 * 依照 reference/03-public-billing.md T09 规格：
 * 1. 在后端创建每用户 bookId→root 注册表；路径完全由服务器生成；
 * 2. 实际 realpath 必须位于当前 user 的目录内，禁止符号链接穿出；
 * 3. hosted 模式拒绝客户端直接传入 root/dir/parentDir/path 等物理路径；
 * 4. 进程级排他启动锁（同 dataRoot 禁止多实例并发争夺）+ 每书并发队列；
 * 5. 二级凭据归属验证（主体 A + B 的 candidateId/receiptId/jobId → 404）。
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
} from 'node:fs'
import { resolve, sep, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { RequestBoundaryError, assertSafeBookRoot } from './security.js'
import { createBook } from '@mozhou/data-plane'
import type { VerifiedPrincipal } from './auth/session.js'

export interface AuthorizedBook {
  readonly bookId: string
  readonly userId: string
  readonly root: string
  readonly title: string
}

/* ============================================================================
 * 进程级排他启动锁 (DataRoot Process Lock)
 * ========================================================================== */

export class DataRootProcessLock {
  private _lockFd: number | null = null
  private _lockPath: string | null = null

  acquire(dataRoot: string): void {
    const lockPath = resolve(dataRoot, '.mozhou_instance.lock')
    mkdirSync(dataRoot, { recursive: true })

    if (existsSync(lockPath)) {
      try {
        const raw = readFileSync(lockPath, 'utf8').trim()
        const pid = parseInt(raw, 10)
        if (!isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0)
            // 目标进程仍在存活，拒绝争夺
            throw new Error(`DATA_ROOT_LOCKED: another service instance (PID ${pid}) is running on dataRoot: ${dataRoot}`)
          } catch (killErr: unknown) {
            if ((killErr as NodeJS.ErrnoException).code !== 'ESRCH') {
              throw killErr
            }
            // ESRCH 说明是已死进程遗留的失效锁，可以接管
          }
        }
      } catch (err) {
        if ((err as Error).message.startsWith('DATA_ROOT_LOCKED')) {
          throw err
        }
      }
    }

    try {
      const fd = openSync(lockPath, 'w')
      writeFileSync(fd, `${process.pid}\n`, 'utf8')
      this._lockFd = fd
      this._lockPath = lockPath
    } catch (err) {
      throw new Error(`DATA_ROOT_LOCKED: failed to acquire exclusive lock on ${lockPath}: ${(err as Error).message}`)
    }
  }

  release(): void {
    if (this._lockFd !== null) {
      try { closeSync(this._lockFd) } catch { /* ignore */ }
      this._lockFd = null
    }
    if (this._lockPath && existsSync(this._lockPath)) {
      try { unlinkSync(this._lockPath) } catch { /* ignore */ }
      this._lockPath = null
    }
  }
}

/* ============================================================================
 * 每书并发操作队列 (Per-Book Execution Queue)
 * ========================================================================== */

export class BookOperationQueue {
  private readonly _locks = new Map<string, Promise<void>>()

  async withBookLock<T>(bookId: string, fn: () => Promise<T>): Promise<T> {
    while (this._locks.has(bookId)) {
      await this._locks.get(bookId)
    }
    let resolveLock!: () => void
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve
    })
    this._locks.set(bookId, lockPromise)
    try {
      return await fn()
    } finally {
      this._locks.delete(bookId)
      resolveLock()
    }
  }
}

/* ============================================================================
 * 多租户作品访问管理器 (BookAccessManager)
 * ========================================================================== */

export class BookAccessManager {
  private _isHosted = false
  private _dataRoot: string = resolve(process.cwd(), '.mozhou_data')
  private readonly _localRegistry = new Map<string, AuthorizedBook>() // bookId -> AuthorizedBook
  readonly lock = new DataRootProcessLock()
  readonly queue = new BookOperationQueue()

  setHostedMode(hosted: boolean): void {
    this._isHosted = hosted
  }

  isHostedMode(): boolean {
    return this._isHosted || process.env.MOZHOU_HOSTED === 'true'
  }

  setDataRoot(dir: string): void {
    this._dataRoot = resolve(dir)
  }

  getDataRoot(): string {
    return this._dataRoot
  }

  /**
   * 本地模式：注册已有本地书目录为可用 bookId
   */
  registerLocalBook(root: string, bookId?: string): AuthorizedBook {
    const safeRoot = assertSafeBookRoot(root)
    const id = bookId ?? ('bk_loc_' + randomBytes(8).toString('hex'))
    let title = '未命名作品'
    try {
      const b = JSON.parse(readFileSync(resolve(safeRoot, 'book.json'), 'utf8')) as { title?: string }
      title = b.title ?? title
    } catch {
      // ignore
    }
    const book: AuthorizedBook = {
      bookId: id,
      userId: 'local_user',
      root: safeRoot,
      title,
    }
    this._localRegistry.set(id, book)
    this._localRegistry.set(safeRoot, book)
    return book
  }

  /**
   * Hosted 模式：为指定用户创建新作品。路径完全由服务器安全生成。
   */
  createHostedBook(userId: string, title = '未命名作品'): AuthorizedBook {
    if (!userId || typeof userId !== 'string') {
      throw new RequestBoundaryError(401, 'UNAUTHORIZED', 'valid userId required to create book')
    }
    const bookId = 'bk_' + randomBytes(12).toString('hex')
    const userBooksDir = resolve(this._dataRoot, 'users', userId, 'books')
    mkdirSync(userBooksDir, { recursive: true })

    const bookRoot = resolve(userBooksDir, bookId)
    createBook({ dir: bookRoot, title })

    return {
      bookId,
      userId,
      root: bookRoot,
      title,
    }
  }

  /**
   * 列出指定用户的全部已授权作品。
   */
  listUserBooks(userId: string): readonly AuthorizedBook[] {
    if (!this.isHostedMode()) {
      return Array.from(new Set(this._localRegistry.values()))
    }
    const userBooksDir = resolve(this._dataRoot, 'users', userId, 'books')
    if (!existsSync(userBooksDir)) return []

    const results: AuthorizedBook[] = []
    const entries = readdirSync(userBooksDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const bookRoot = resolve(userBooksDir, entry.name)
      const marker = resolve(bookRoot, 'book.json')
      if (!existsSync(marker)) continue
      let title = entry.name
      try {
        const data = JSON.parse(readFileSync(marker, 'utf8')) as { title?: string }
        if (data.title) title = data.title
      } catch {
        // ignore
      }
      results.push({
        bookId: entry.name,
        userId,
        root: bookRoot,
        title,
      })
    }
    return results
  }

  /**
   * 核心解析：根据 Principal 和请求中的标识符解析出唯一合法的 AuthorizedBook。
   * - hosted 模式：
   *   1. 拒绝客户端输入包含 directory traversal 或直接物理路径；
   *   2. 严格按用户目录隔离寻找 bookId；不存在或非本人所有则返回 404；
   *   3. 检查符号链接穿越，发现穿出则 403 阻断；
   * - local 模式：
   *   支持通过注册的 bookId 或已有 safeRoot 打开旧格式测试书。
   */
  resolveAuthorizedBook(
    principal: VerifiedPrincipal | null,
    body: Record<string, unknown>,
  ): AuthorizedBook {
    // 1. Hosted 模式路径注入拦截
    if (this.isHostedMode()) {
      // 客户端不得传入 root/dir/parentDir/path 试图操控服务端物理磁盘
      const rawRoot = body['root']
      const rawDir = body['dir']
      const rawParent = body['parentDir']
      const rawPath = body['path']

      for (const [key, val] of Object.entries({ root: rawRoot, dir: rawDir, parentDir: rawParent, path: rawPath })) {
        if (typeof val === 'string') {
          if (val.includes('..') || val.startsWith('/') || val.startsWith('\\') || /^[A-Za-z]:/.test(val)) {
            throw new RequestBoundaryError(400, 'INVALID_HOSTED_INPUT', `client-supplied filesystem path "${key}" is rejected in hosted mode`)
          }
        }
      }

      if (!principal?.userId) {
        throw new RequestBoundaryError(401, 'UNAUTHORIZED', 'authentication required to access book')
      }

      const bookId = typeof body['bookId'] === 'string' ? body['bookId'].trim() : null
      if (!bookId) {
        throw new RequestBoundaryError(404, 'BOOK_NOT_FOUND', 'bookId required in hosted mode')
      }

      // 验证 bookId 格式（防注入）
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(bookId)) {
        throw new RequestBoundaryError(404, 'BOOK_NOT_FOUND', `invalid bookId format: ${bookId}`)
      }

      const userBooksDir = resolve(this._dataRoot, 'users', principal.userId, 'books')
      const targetDir = resolve(userBooksDir, bookId)

      if (!existsSync(targetDir)) {
        throw new RequestBoundaryError(404, 'BOOK_NOT_FOUND', `book ${bookId} not found`)
      }

      // 符号链接安全性检查（防穿出当前用户沙箱目录）
      let isSym = false
      try {
        isSym = lstatSync(targetDir).isSymbolicLink()
      } catch {
        // ignore
      }
      if (isSym) {
        throw new RequestBoundaryError(403, 'SYMLINK_ESCAPE_BLOCKED', 'symlink paths are forbidden for books')
      }

      const realTarget = realpathSync(targetDir)
      const realUserBooks = existsSync(userBooksDir) ? realpathSync(userBooksDir) : userBooksDir
      const allowedPrefix = realUserBooks.endsWith(sep) ? realUserBooks : realUserBooks + sep
      if (!realTarget.startsWith(allowedPrefix) && realTarget !== realUserBooks) {
        throw new RequestBoundaryError(403, 'SYMLINK_ESCAPE_BLOCKED', 'book path escapes user directory via symlink')
      }

      const marker = resolve(realTarget, 'book.json')
      if (!existsSync(marker)) {
        throw new RequestBoundaryError(404, 'BOOK_NOT_FOUND', `book marker not found for book: ${bookId}`)
      }

      let title = bookId
      try {
        const b = JSON.parse(readFileSync(marker, 'utf8')) as { title?: string }
        if (b.title) title = b.title
      } catch {
        // ignore
      }

      const book: AuthorizedBook = {
        bookId,
        userId: principal.userId,
        root: realTarget,
        title,
      }

      // 验证二级工件归属
      assertResourceOwnership(book, body)
      return book
    }

    // 2. Local 模式兼容
    const bookId = typeof body['bookId'] === 'string' ? body['bookId'].trim() : null
    const rawRoot = typeof body['root'] === 'string' ? body['root'].trim() : null

    if (bookId && this._localRegistry.has(bookId)) {
      const book = this._localRegistry.get(bookId)!
      assertResourceOwnership(book, body)
      return book
    }

    const candidateRoot = rawRoot ?? bookId
    if (candidateRoot) {
      if (this._localRegistry.has(candidateRoot)) {
        const book = this._localRegistry.get(candidateRoot)!
        assertResourceOwnership(book, body)
        return book
      }
      try {
        const safeRoot = assertSafeBookRoot(candidateRoot)
        let title = basename(safeRoot)
        try {
          const b = JSON.parse(readFileSync(resolve(safeRoot, 'book.json'), 'utf8')) as { title?: string }
          if (b.title) title = b.title
        } catch {
          // ignore
        }
        const book: AuthorizedBook = {
          bookId: bookId ?? basename(safeRoot),
          userId: principal?.userId ?? 'local_user',
          root: safeRoot,
          title,
        }
        assertResourceOwnership(book, body)
        return book
      } catch (err) {
        if (err instanceof RequestBoundaryError) throw err
        throw new RequestBoundaryError(404, 'BOOK_NOT_FOUND', `local book root not found: ${candidateRoot}`)
      }
    }

    throw new RequestBoundaryError(400, 'BOOK_REQUIRED', 'bookId or root required')
  }

  clear(): void {
    this._localRegistry.clear()
    this.lock.release()
  }
}

/**
 * 校验二级工件（candidateId / receiptId / jobId）是否属于当前书籍。
 * 若工件不存在于该书目录下，拒绝访问并返回 404（实现矩阵：主体 A + B 的 candidateId/receiptId/jobId → 404）。
 */
export function assertResourceOwnership(book: AuthorizedBook, body: Record<string, unknown>): void {
  const candidateId = typeof body['candidateId'] === 'string' ? body['candidateId'].trim() : null
  if (candidateId) {
    const candPath = resolve(book.root, '.mozhou', 'candidates', `${candidateId}.json`)
    if (!existsSync(candPath)) {
      throw new RequestBoundaryError(404, 'CANDIDATE_NOT_FOUND', `candidate ${candidateId} not found in this book`)
    }
  }

  const receiptId = typeof body['receiptId'] === 'string' ? body['receiptId'].trim() : null
  if (receiptId) {
    const rcptPath = resolve(book.root, '.mozhou', 'receipts', `${receiptId}.json`)
    if (!existsSync(rcptPath)) {
      throw new RequestBoundaryError(404, 'RECEIPT_NOT_FOUND', `receipt ${receiptId} not found in this book`)
    }
  }

  const jobId = typeof body['jobId'] === 'string' ? body['jobId'].trim() : null
  if (jobId) {
    const jobPath = resolve(book.root, '.mozhou', 'storyboard', 'jobs', `${jobId}.json`)
    const altJobPath = resolve(book.root, '.mozhou', 'jobs', `${jobId}.json`)
    if (!existsSync(jobPath) && !existsSync(altJobPath)) {
      throw new RequestBoundaryError(404, 'JOB_NOT_FOUND', `job ${jobId} not found in this book`)
    }
  }
}

export const defaultBookAccessManager = new BookAccessManager()
