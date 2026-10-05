/**
 * apps/web · 写入权原语（W2-2）：以规范化书籍身份为键的命名管道排他锁。
 *
 * 设计依据（t22 实测，见 evidence/w2-writer-lock/entrypoints-and-spike.md）：
 * - Windows 上普通 `fs.open` 句柄**不排他**（第二个进程照样打开成功），不能当锁；
 * - `net.createServer().listen('\\\\.\\pipe\\<name>')` 是**真排他**：第二个绑定者得 EADDRINUSE；
 * - 持有者被 SIGKILL 后 OS 立即释放管道名，**无需**「检测失效 → 删锁 → 抢锁」，也不存在锁文件；
 * - 因此锁身份 = 管道名（由书籍身份哈希派生），天然稳定，不需要也不允许删除任何锁文件。
 *
 * 身份归一：realpathSync.native（解 junction/symlink）→ 分隔符统一 → 去尾分隔符 → 小写。
 * 只做 resolve 不做 realpath 会漏掉 junction（同一本书算出两个 key）。
 *
 * 多 Windows 会话：`\\\\.\\pipe\\` 是**会话本地**命名空间，因此跨会话（不同登录会话同时跑服务）
 * 不在支持范围内——规划 §6.3 允许把支持范围写进发布说明。Global 命名空间需要
 * SeCreateGlobalPrivilege，本机实测（普通完整性、whoami /priv 未列出该特权）能创建
 * `\\\\.\\pipe\\Global\\<name>`，但该结果依赖账号特权配置，故**不采用**，仅如实记录。
 *
 * 不新增依赖：只用 node:crypto / node:fs / node:net / node:path / node:child_process（系统自带 fsutil）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { resolve } from 'node:path'

export type BookWriteLockErrorCode =
  | 'BOOK_ROOT_NOT_LOCAL'
  /** 盘符书根的驱动器类型探测不可判定（fsutil 缺失/超时/未知语言输出）——默认 fail-closed。 */
  | 'BOOK_ROOT_UNVERIFIED'
  | 'BOOK_ROOT_UNRESOLVABLE'
  | 'WRITER_LOCK_HELD'
  | 'WRITER_LOCK_TIMEOUT'
  | 'WRITER_LOCK_ABORTED'
  | 'WRITER_LOCK_FAILED'

export class BookWriteLockError extends Error {
  override readonly name = 'BookWriteLockError'

  constructor(
    readonly code: BookWriteLockErrorCode,
    readonly bookKey: string,
    message: string,
  ) {
    super(message)
  }
}

/** 管道名固定前缀；`<hash>` 由规范化书籍身份派生，锁身份因此稳定且不含 PID。 */
export const WRITER_PIPE_PREFIX = '\\\\.\\pipe\\mozhou-writer-'

/** 身份归一：realpathSync.native → 分隔符统一 → 去尾分隔符 → 小写。 */
export function canonicalBookKey(root: string): string {
  const absolute = resolve(root)
  let native: string
  try {
    native = realpathSync.native(absolute)
  } catch (error) {
    throw new BookWriteLockError(
      'BOOK_ROOT_UNRESOLVABLE',
      normalizeBookKey(absolute),
      `book root cannot be canonicalized: ${absolute} (${(error as Error).message})`,
    )
  }
  return normalizeBookKey(native)
}

function normalizeBookKey(nativePath: string): string {
  let key = nativePath.replace(/[\\/]+/g, '/')
  key = key.replace(/\/+$/, '')
  if (key === '') key = '/'
  return key.toLowerCase()
}

export function writerPipeName(bookKey: string): string {
  return `${WRITER_PIPE_PREFIX}${createHash('sha256').update(bookKey).digest('hex').slice(0, 32)}`
}

/* ---------------------------------------------------------------------------
 * 可写书根判定：命名管道是本机原语，网络共享书根一律拒绝
 * ------------------------------------------------------------------------- */

export type BookRootKind = 'local' | 'unc' | 'network-drive' | 'unverified'

/** 驱动器类型探测注入点：返回 fsutil 原始输出（或 null 表示无法判定）。 */
export type DriveTypeProbe = (driveLetter: string) => string | null

/** 显式 opt-in：允许探测不可判定的盘符书根。默认关闭 = fail-closed。 */
export const ALLOW_UNVERIFIED_BOOK_ROOT_ENV = 'MOZHOU_ALLOW_UNVERIFIED_BOOK_ROOT'

const REMOTE_DRIVE_MARKER = /remote|network|远程|网络/i
/**
 * 只认**正向本地标记**。fsutil 输出是本地化文本（本机实测「C: - 固定驱动器」），
 * 未知语言/未知措辞一律落到 unverified，由调用方 fail-closed 拒绝——
 * 绝不把「没认出远端」当作「就是本地」。
 */
const LOCAL_DRIVE_MARKER = /fixed|local|本地|固定/i
const driveTypeCache = new Map<string, string>()

/**
 * 默认探测：Windows 上用系统自带 `fsutil fsinfo drivetype <X:>`。
 * 输出是**本地化文本**（本机实测为「C: - 固定驱动器」）。判定在 classifyBookRootKind：
 * 远端标记 → network-drive；本地标记 → local；其余 → unverified（fail-closed）。
 *
 * 缓存口径：**只缓存成功判定**（非空输出）。不可判定（null / 空串）不缓存——
 * 否则一次瞬时抖动（fsutil 不可用、超时）会把 fail-closed 永久变成 fail-open。
 */
function defaultDriveTypeProbe(driveLetter: string): string | null {
  if (process.platform !== 'win32') {
    return null
  }
  const cached = driveTypeCache.get(driveLetter)
  if (cached !== undefined) {
    return cached
  }
  let output: string | null = null
  try {
    const fsutil = process.env['SystemRoot'] ? `${process.env['SystemRoot']}\\System32\\fsutil.exe` : 'fsutil'
    // 不指定 encoding：拿原始字节，再按多种代码页解码（见 decodeConsoleText）
    const raw = execFileSync(fsutil, ['fsinfo', 'drivetype', driveLetter], { timeout: 5000, windowsHide: true })
    output = decodeConsoleText(raw)
  } catch {
    output = null
  }
  // 只缓存成功判定：不可判定不入缓存（见上）
  if (typeof output === 'string' && output.trim() !== '') {
    driveTypeCache.set(driveLetter, output)
  }
  return output
}

/**
 * fsutil 的输出走**控制台 OEM 代码页**（本机实测 GBK：b9cc b6a8 c7fd b6af c6f7 = 「固定驱动器」），
 * Node 按 UTF-8 解码只会得到乱码。故同时按 utf8 / gbk / gb18030 解码并合并：
 * 标记匹配在任一解码结果上命中即算命中；全都认不出 → 交给调用方 fail-closed。
 * （TextDecoder('gbk') 依赖 full-icu；缺失时只留 utf8 变体，不影响 fail-closed 语义。）
 */
function decodeConsoleText(raw: Buffer): string {
  const variants = [raw.toString('utf8')]
  for (const encoding of ['gbk', 'gb18030'] as const) {
    try {
      variants.push(new TextDecoder(encoding).decode(raw))
    } catch {
      // ICU 不含该编码：跳过
    }
  }
  return variants.join('\n')
}

/** 去掉 Windows 扩展长度前缀，露出真实的 \\\\server\\share 或盘符形态。 */
function stripExtendedPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${path.slice(8)}`
  }
  if (path.startsWith('\\\\?\\') || path.startsWith('\\\\.\\')) {
    return path.slice(4)
  }
  return path
}

export function classifyBookRootKind(root: string, probe: DriveTypeProbe = defaultDriveTypeProbe): BookRootKind {
  const absolute = resolve(root)
  const plain = stripExtendedPrefix(absolute)
  // UNC 是纯语法判定：不需要任何探测，也不受本地化影响
  if (plain.startsWith('\\\\') || plain.startsWith('//')) {
    return 'unc'
  }
  if (process.platform !== 'win32') {
    return 'local'
  }
  const drive = /^([A-Za-z]):[\\/]/.exec(absolute)
  if (drive === null) {
    return 'local'
  }
  const output = probe(`${drive[1]!.toUpperCase()}:`)
  if (typeof output === 'string') {
    if (REMOTE_DRIVE_MARKER.test(output)) return 'network-drive'
    if (LOCAL_DRIVE_MARKER.test(output)) return 'local'
  }
  // 探测不可判定 / 未知语言输出：不猜，交给调用方 fail-closed
  return 'unverified'
}

export interface LocalWritableBookRootOptions {
  /** 测试注入点：驱动器类型探测。 */
  readonly driveTypeProbe?: DriveTypeProbe | undefined
  /**
   * 显式 opt-in：允许**探测不可判定**的盘符书根。默认 false = fail-closed。
   * 也可用环境变量 `MOZHOU_ALLOW_UNVERIFIED_BOOK_ROOT=1`（两者都只在探测不可判定时生效；
   * UNC / 映射网络盘的硬拒绝**不可**被覆盖）。
   */
  readonly allowUnverifiedRoot?: boolean | undefined
}

/**
 * 断言书根是**本机可写**的，返回规范化书籍身份（bookKey）。
 *
 * 三档判定（规划 §6.3「未验证网络共享先拒绝为可写书根」「锁状态不明保守拒绝写入」）：
 * - `unc` / `network-drive` → 硬拒绝 `BOOK_ROOT_NOT_LOCAL`（UNC 为纯语法判定，不依赖探测）；
 * - `unverified`（探测返回 null / 未知语言输出）→ **默认拒绝** `BOOK_ROOT_UNVERIFIED`，
 *   只有显式 opt-in（参数或环境变量）才放行——绝不把「没认出远端」当作「就是本地」；
 * - `local`（正向本地标记命中）→ 放行。
 */
export function assertLocalWritableBookRoot(root: string, probe?: DriveTypeProbe, options: LocalWritableBookRootOptions = {}): string {
  const kind = classifyBookRootKind(root, options.driveTypeProbe ?? probe ?? defaultDriveTypeProbe)
  if (kind === 'unverified') {
    // 探测不可判定（fsutil 不可用 / 未知语言输出 / 空输出）：**默认拒绝**，绝不当作 local。
    if (options.allowUnverifiedRoot === true || process.env[ALLOW_UNVERIFIED_BOOK_ROOT_ENV] === '1') {
      return canonicalBookKey(root)
    }
    throw new BookWriteLockError(
      'BOOK_ROOT_UNVERIFIED',
      normalizeBookKey(resolve(root)),
      `book root drive type could not be verified as a local fixed drive: ${root} — refusing to bind the writer lock (set ${ALLOW_UNVERIFIED_BOOK_ROOT_ENV}=1 or pass allowUnverifiedRoot to override)`,
    )
  }
  if (kind !== 'local') {
    const detail = kind === 'unc' ? 'a UNC/network share' : 'a mapped network drive'
    throw new BookWriteLockError(
      'BOOK_ROOT_NOT_LOCAL',
      normalizeBookKey(resolve(root)),
      `book root must be a local fixed drive — ${detail} cannot be protected by the named-pipe writer lock: ${root}`,
    )
  }
  return canonicalBookKey(root)
}

/* ---------------------------------------------------------------------------
 * 排他锁
 * ------------------------------------------------------------------------- */

export interface BookWriteLockOptions {
  /** 0/缺省 = 被占用立即失败；>0 = 最多等待这么久。 */
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
  /** 排队轮询间隔（默认 50ms）。 */
  readonly pollIntervalMs?: number | undefined
  /** 测试注入点：驱动器类型探测。 */
  readonly driveTypeProbe?: DriveTypeProbe | undefined
  /** 显式 opt-in：允许探测不可判定的盘符书根（默认 fail-closed）。 */
  readonly allowUnverifiedRoot?: boolean | undefined
}

export class BookWriteLock {
  private _server: Server | null

  constructor(
    readonly bookKey: string,
    readonly pipeName: string,
    server: Server,
  ) {
    this._server = server
  }

  get held(): boolean {
    return this._server !== null
  }

  /**
   * 释放：只关闭监听句柄。**不删除任何东西**——管道对象由 OS 管理，
   * 锁身份（管道名）不随获取/释放变化（规划 §6.3）。
   */
  release(): Promise<void> {
    const server = this._server
    this._server = null
    if (server === null) {
      return Promise.resolve()
    }
    return new Promise<void>((resolveRelease) => {
      try {
        server.close(() => resolveRelease())
      } catch {
        resolveRelease()
      }
    })
  }
}

type ListenOutcome = { readonly ok: true; readonly server: Server } | { readonly ok: false; readonly code: string }

function listenOnce(pipeName: string): Promise<ListenOutcome> {
  return new Promise<ListenOutcome>((resolveAttempt) => {
    const server = createServer()
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('error', onError)
      // 失败路径不留句柄：listen 未成功时 close 是 no-op，仍显式调用并吞掉错误
      try {
        server.close()
      } catch {
        // ignore
      }
      resolveAttempt({ ok: false, code: error.code ?? 'UNKNOWN' })
    }
    server.once('error', onError)
    server.listen(pipeName, () => {
      server.removeListener('error', onError)
      resolveAttempt({ ok: true, server })
    })
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolveDelay, rejectDelay) => {
    if (signal?.aborted === true) {
      rejectDelay(new BookWriteLockError('WRITER_LOCK_ABORTED', '', 'book writer lock wait aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolveDelay()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      rejectDelay(new BookWriteLockError('WRITER_LOCK_ABORTED', '', 'book writer lock wait aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 获取某本书的排他写锁。第二持有者被拒绝（命名管道 EADDRINUSE 语义），
 * 错误含 bookKey 与可操作信息；**不依赖 PID 存活判断**（OS 自动回收管道）。
 */
export async function acquireBookWriteLock(
  root: string,
  options: BookWriteLockOptions = {},
): Promise<BookWriteLock> {
  const bookKey = assertLocalWritableBookRoot(root, options.driveTypeProbe, {
    allowUnverifiedRoot: options.allowUnverifiedRoot,
  })
  const pipeName = writerPipeName(bookKey)
  const timeoutMs = options.timeoutMs ?? 0
  const pollIntervalMs = options.pollIntervalMs ?? 50
  const deadline = Date.now() + Math.max(0, timeoutMs)

  for (;;) {
    if (options.signal?.aborted === true) {
      throw new BookWriteLockError(
        'WRITER_LOCK_ABORTED',
        bookKey,
        `book writer lock wait aborted: bookKey=${bookKey} pipe=${pipeName}`,
      )
    }
    const outcome = await listenOnce(pipeName)
    if (outcome.ok) {
      return new BookWriteLock(bookKey, pipeName, outcome.server)
    }
    if (outcome.code !== 'EADDRINUSE') {
      throw new BookWriteLockError(
        'WRITER_LOCK_FAILED',
        bookKey,
        `failed to bind writer pipe: bookKey=${bookKey} pipe=${pipeName} code=${outcome.code}`,
      )
    }
    if (timeoutMs <= 0) {
      throw new BookWriteLockError(
        'WRITER_LOCK_HELD',
        bookKey,
        `another writer already holds this book: bookKey=${bookKey} pipe=${pipeName} — wait for it to finish or pass a timeoutMs to queue`,
      )
    }
    if (Date.now() >= deadline) {
      throw new BookWriteLockError(
        'WRITER_LOCK_TIMEOUT',
        bookKey,
        `timed out after ${timeoutMs}ms waiting for the book writer lock: bookKey=${bookKey} pipe=${pipeName}`,
      )
    }
    await delay(pollIntervalMs, options.signal)
  }
}

/** 取锁 → 执行 → 必然释放（含异常与超时路径，不泄漏管道句柄）。 */
export async function withBookWriteLock<T>(
  root: string,
  fn: () => Promise<T> | T,
  options: BookWriteLockOptions = {},
): Promise<T> {
  const lock = await acquireBookWriteLock(root, options)
  try {
    return await fn()
  } finally {
    await lock.release()
  }
}
