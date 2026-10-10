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
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  readdirSync,
} from 'node:fs'
import { resolve, sep, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { RequestBoundaryError, assertSafeBookRoot } from './security.js'
import {
  BookWriteLockError,
  acquireBookWriteLock,
  assertLocalWritableBookRoot,
  canonicalBookKey,
  type BookWriteLock,
} from './platform/writerLock.js'
import { createBook } from '@mozhou/data-plane'
import { resolveDefaultDataRoot } from './dataRoot.js'
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

/** 本进程当前持有的 dataRoot 锁文件（同进程第二实例据此拒绝，不依赖盘上文件）。 */
const heldDataRootLocks = new Set<string>()

/** 锁记录格式 v2：只信任本格式判「现有墨舟实例在跑」；旧版裸 PID = 历史遗留记录。 */
interface DataRootLockRecord {
  readonly schemaVersion: 2
  readonly pid: number
  readonly holder: 'mozhou-service'
  readonly startedAtIso: string
}

const DATA_ROOT_LOCK_SCHEMA_VERSION = 2

/**
 * 读锁记录。返回 null = 文件缺席 / 损坏 / **旧版裸 PID 格式**。
 * F-02 负样本（历史 dataRoot 锁）：旧格式只剩一个 PID 数字——PID 会被无关进程复用，
 * 「历史锁文件 + 活着的无关 PID」不能证明现有墨舟实例在跑，必须允许接管。
 */
function readDataRootLockRecord(lockPath: string): DataRootLockRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<DataRootLockRecord> | null
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.schemaVersion !== DATA_ROOT_LOCK_SCHEMA_VERSION ||
      typeof parsed.pid !== 'number' ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      parsed.holder !== 'mozhou-service' ||
      typeof parsed.startedAtIso !== 'string'
    ) {
      return null
    }
    return parsed as DataRootLockRecord
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = 进程存在但无权限发信号；其余（ESRCH）= 已退出
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * dataRoot 进程级启动门。
 *
 * W2-2 修正两处既有缺陷：
 * 1. 旧实现用 `openSync(lockPath, 'w')`——截断式且**非独占**，已改为 `'wx'`（已存在即失败）；
 * 2. 旧实现 release() 用 `unlinkSync` 删除锁文件——与规划 §6.3「锁文件保持稳定身份、
 *    不在解锁后删除并重建同名文件」相反，已去掉删除；文件被就地接管（`'r+'` + 截断改写）。
 *
 * 说明：真正的**每书**排他由 platform/writerLock.ts 的命名管道锁承担（W2-2 新增）；
 * 本类只是「同一 dataRoot 不并发起两个服务实例」的启动门，其判定含 PID 存活启发式，
 * 因此保留其既有同步签名与 DATA_ROOT_LOCKED 错误语义。
 */
export class DataRootProcessLock {
  private _lockFd: number | null = null
  private _lockPath: string | null = null

  acquire(dataRoot: string): void {
    const lockPath = resolve(dataRoot, '.mozhou_instance.lock')
    mkdirSync(dataRoot, { recursive: true })

    if (heldDataRootLocks.has(lockPath)) {
      throw new Error(`DATA_ROOT_LOCKED: another service instance in this process is already running on dataRoot: ${dataRoot}`)
    }

    // 独占创建：'wx' 在文件已存在时失败（旧 'w' 会截断且非独占）
    try {
      const fd = openSync(lockPath, 'wx')
      this._adopt(lockPath, fd)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new Error(`DATA_ROOT_LOCKED: failed to acquire exclusive lock on ${lockPath}: ${(err as Error).message}`)
      }
    }

    // 锁文件已存在：身份保持稳定——就地改写占用记录，绝不 unlink 重建同名文件。
    // F-02/W2 负样本：只信任 v2 JSON 记录判「现有实例在跑」；旧版裸 PID / 损坏记录
    // 视为历史遗留（活着的无关 PID 不应把历史 dataRoot 锁误判为现有墨舟实例）。
    const holder = readDataRootLockRecord(lockPath)
    if (holder !== null && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
      throw new Error(`DATA_ROOT_LOCKED: another service instance (PID ${holder.pid}) is running on dataRoot: ${dataRoot}`)
    }
    // 本进程已释放的稳定锁文件 / 已死进程遗留 / 无有效 PID：接管
    try {
      const fd = openSync(lockPath, 'r+')
      ftruncateSync(fd, 0)
      this._adopt(lockPath, fd)
    } catch (err) {
      throw new Error(`DATA_ROOT_LOCKED: failed to take over lock ${lockPath}: ${(err as Error).message}`)
    }
  }

  private _adopt(lockPath: string, fd: number): void {
    try {
      // 锁记录 v2（JSON）：`holder: 'mozhou-service'` 是「记录来自现行墨舟实例」的
      // 标记——旧版裸 PID 记录在 readDataRootLockRecord 判 null 后直接接管。
      writeFileSync(
        fd,
        JSON.stringify({
          schemaVersion: DATA_ROOT_LOCK_SCHEMA_VERSION,
          pid: process.pid,
          holder: 'mozhou-service',
          startedAtIso: new Date().toISOString(),
        }) + '\n',
        'utf8',
      )
    } catch (err) {
      try { closeSync(fd) } catch { /* ignore */ }
      throw new Error(`DATA_ROOT_LOCKED: failed to record holder pid in ${lockPath}: ${(err as Error).message}`)
    }
    this._lockFd = fd
    this._lockPath = lockPath
    heldDataRootLocks.add(lockPath)
  }

  release(): void {
    if (this._lockFd !== null) {
      try { closeSync(this._lockFd) } catch { /* ignore */ }
      this._lockFd = null
    }
    if (this._lockPath !== null) {
      // 锁文件保持稳定身份：不删除、不重建（规划 §6.3）
      heldDataRootLocks.delete(this._lockPath)
      this._lockPath = null
    }
  }
}

/* ============================================================================
 * 每书并发操作队列 (Per-Book Execution Queue · W2-3 改为显式 FIFO)
 * ========================================================================== */

/** 409：同书已有写入者（进程内队列或跨进程命名管道被占）——客户端可重试。 */
export const BOOK_WRITE_BUSY = 'BOOK_WRITE_BUSY'

export class BookWriteBusyError extends Error {
  override readonly name = 'BookWriteBusyError'

  constructor(
    readonly code: 'BOOK_WRITE_BUSY' | 'BOOK_WRITE_TIMEOUT' | 'BOOK_WRITE_ABORTED',
    readonly bookKey: string,
    message: string,
  ) {
    super(message)
  }
}

/** 排队等待者：显式 FIFO 数组元素，带超时/取消句柄。 */
interface BookQueueWaiter {
  readonly resolve: (release: () => void) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal | undefined
  timer: NodeJS.Timeout | null
  onAbort: (() => void) | null
}

/**
 * 每书进程内互斥（显式 FIFO）。
 *
 * 旧实现是 `while (Map.has) await` 自旋：既不保证 FIFO，也无法取消/超时。
 * 现改为显式队列数组：先到先得、队首释放后唤醒下一个；超时/取消把自己从
 * 队列中摘除，不会留下幽灵占位；任何路径最终都会 release（释放幂等）。
 */
export class BookOperationQueue {
  private readonly _queues = new Map<string, BookQueueWaiter[]>()
  private readonly _held = new Set<string>()

  /** 取锁；返回幂等 release。timeoutMs<=0 时被占用立即以 BOOK_WRITE_BUSY 拒绝。 */
  acquire(bookKey: string, options: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<() => void> {
    const timeoutMs = options.timeoutMs ?? 0
    const waiting = this._queues.get(bookKey)
    if (!this._held.has(bookKey) && (waiting === undefined || waiting.length === 0)) {
      this._held.add(bookKey)
      return Promise.resolve(this._makeRelease(bookKey))
    }
    if (timeoutMs <= 0) {
      return Promise.reject(
        new BookWriteBusyError('BOOK_WRITE_BUSY', bookKey, `another writer in this process already holds book ${bookKey} — retry later or pass timeoutMs to queue`),
      )
    }
    return new Promise<() => void>((resolve, reject) => {
      let queue = this._queues.get(bookKey)
      if (queue === undefined) {
        queue = []
        this._queues.set(bookKey, queue)
      }
      const waiter: BookQueueWaiter = {
        resolve: (release) => resolve(release),
        reject,
        signal: options.signal,
        timer: null,
        onAbort: null,
      }
      const settle = (fn: () => void): void => {
        this._detach(bookKey, waiter)
        fn()
      }
      waiter.timer = setTimeout(() => {
        settle(() =>
          reject(new BookWriteBusyError('BOOK_WRITE_TIMEOUT', bookKey, `timed out after ${timeoutMs}ms queuing for book ${bookKey}`)),
        )
      }, timeoutMs)
      const signal = options.signal
      if (signal !== undefined) {
        waiter.onAbort = () => {
          settle(() => reject(new BookWriteBusyError('BOOK_WRITE_ABORTED', bookKey, `queuing for book ${bookKey} was aborted`)))
        }
        if (signal.aborted) {
          waiter.onAbort()
          return
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      queue.push(waiter)
    })
  }

  /** 兼容入口：取锁 → 执行 → 必然释放。 */
  async withBookLock<T>(bookKey: string, fn: () => Promise<T> | T, options: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<T> {
    const release = await this.acquire(bookKey, options)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private _detach(bookKey: string, waiter: BookQueueWaiter): void {
    if (waiter.timer !== null) {
      clearTimeout(waiter.timer)
      waiter.timer = null
    }
    const queue = this._queues.get(bookKey)
    if (queue === undefined) return
    const index = queue.indexOf(waiter)
    if (index >= 0) queue.splice(index, 1)
    if (queue.length === 0) this._queues.delete(bookKey)
  }

  private _makeRelease(bookKey: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this._held.delete(bookKey)
      const queue = this._queues.get(bookKey)
      // FIFO：队首先到先得；超时/取消的等待者已在 _detach 中摘除，队列里只有活等待者
      const next = queue?.shift()
      if (queue !== undefined && queue.length === 0) {
        this._queues.delete(bookKey)
      }
      if (next === undefined) return
      if (next.timer !== null) {
        clearTimeout(next.timer)
        next.timer = null
      }
      if (next.onAbort !== null) {
        next.signal?.removeEventListener('abort', next.onAbort)
        next.onAbort = null
      }
      this._held.add(bookKey)
      next.resolve(this._makeRelease(bookKey))
    }
  }
}

/* ============================================================================
 * 统一书稿写锁 (W2-3)：进程内 FIFO 队列 + 跨进程命名管道锁 + 同调用链可重入
 * ========================================================================== */

/**
 * 同一次异步调用链内已持有的书键。嵌套取锁（路由 → 编排 → 数据面）直接放行，
 * 否则命名管道锁不可重入会把同一次提交自己锁死。
 */
const heldBookWriteKeys = new AsyncLocalStorage<Set<string>>()

export interface BookWriteLeaseOptions {
  /** 0/缺省 = 已有写入者立即失败；>0 = 排队最多等待这么久。 */
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
}

export interface BookWriteLease {
  readonly bookKey: string
  /** 幂等释放：先放命名管道（跨进程），再放进程内队列槽。 */
  release(): Promise<void>
}

/** 同书已有写入者类错误（路由据此转 409/423，而不是 500）。 */
export function isBookWriteBusyError(error: unknown): boolean {
  if (error instanceof BookWriteBusyError) return true
  if (error instanceof BookWriteLockError) {
    return error.code === 'WRITER_LOCK_HELD' || error.code === 'WRITER_LOCK_TIMEOUT' || error.code === 'WRITER_LOCK_ABORTED'
  }
  return false
}

/**
 * 取一次书稿写租约：进程内 FIFO 排队 → 跨进程命名管道排他。
 * 同调用链已持有时返回空租约（可重入，由外层释放）。
 */
export async function acquireBookWriteLease(root: string, options: BookWriteLeaseOptions = {}): Promise<BookWriteLease> {
  const bookKey = canonicalBookKey(root)
  const held = heldBookWriteKeys.getStore()
  if (held !== undefined && held.has(bookKey)) {
    return { bookKey, release: async () => { /* 外层持有者负责释放 */ } }
  }
  const releaseQueueSlot = await defaultBookAccessManager.queue.acquire(bookKey, options)
  let lock: BookWriteLock
  try {
    lock = await acquireBookWriteLock(root, { timeoutMs: options.timeoutMs, signal: options.signal })
  } catch (error) {
    releaseQueueSlot()
    throw error
  }
  let released = false
  return {
    bookKey,
    release: async () => {
      if (released) return
      released = true
      await lock.release()
      releaseQueueSlot()
    },
  }
}

/** 统一书稿写入口：取租约 → 执行 → 必然释放（异常/超时/取消路径同样释放）。 */
export async function withBookWriteLock<T>(
  root: string,
  fn: () => Promise<T> | T,
  options: BookWriteLeaseOptions = {},
): Promise<T> {
  const bookKey = canonicalBookKey(root)
  const held = heldBookWriteKeys.getStore()
  if (held !== undefined && held.has(bookKey)) {
    return await fn()
  }
  const lease = await acquireBookWriteLease(root, options)
  const next = new Set<string>(held ?? [])
  next.add(bookKey)
  try {
    return await heldBookWriteKeys.run(next, fn)
  } finally {
    await lease.release()
  }
}

/* ============================================================================
 * 多租户作品访问管理器 (BookAccessManager)
 * ========================================================================== */

export class BookAccessManager {
  private _isHosted = false
  private _dataRoot: string = resolveDefaultDataRoot()
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
    // W2-2：可写书根必须是本机固定盘——命名管道锁对 UNC / 映射网络盘不适用（返回可定位错误）
    assertLocalWritableBookRoot(safeRoot)
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
