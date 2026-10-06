/**
 * W2-3 · scripts/*.mjs 的统一书稿写入口。
 *
 * 与 apps/web/server/platform/writerLock.ts **同一命名规则与同一书根守卫**：
 * 同一本书（同一规范化身份）在任何进程里都落到同一个命名管道名，因此 CLI/验收脚本
 * 与服务进程互斥；书根类型判定口径也逐条对齐（UNC 纯语法硬拒绝；盘符路径探测不可判定
 * 默认 fail-closed）。
 *
 * 规则：realpathSync.native → 分隔符统一 → 去尾分隔符 → toLowerCase →
 *       \\.\pipe\mozhou-writer-<sha256(key).slice(0,32)>。
 *
 * 为什么脚本里是 JS 而不是直接 import 那个 TS 模块：scripts/*.mjs 由 `node` 直接执行，
 * 仓库没有 TS 运行时依赖；两份实现的一致性由
 * apps/web/server/routes/writerLockIntegration.test.ts 的「同一入口」用例锁定
 * （同 root 必须同管道名 + 互相排他 + 对称的拒绝口径）。
 *
 * 用法（在 createBook 之后，书根已存在时）：
 *   await holdBookWriteLock(bookRoot)   // 已有写入者 / 书根不可写 → 明确拒绝，脚本退出码非 0
 * 进程退出时 OS 自动回收管道名，无需显式释放（锁身份 = 管道名，不落任何文件）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import net from 'node:net'
import { resolve } from 'node:path'

export const WRITER_PIPE_PREFIX = '\\\\.\\pipe\\mozhou-writer-'

/** 显式 opt-in：允许探测不可判定的盘符书根（与 TS 侧同名同义，默认 fail-closed）。 */
export const ALLOW_UNVERIFIED_BOOK_ROOT_ENV = 'MOZHOU_ALLOW_UNVERIFIED_BOOK_ROOT'

const REMOTE_DRIVE_MARKER = /remote|network|远程|网络/i
const LOCAL_DRIVE_MARKER = /fixed|local|本地|固定/i
const driveTypeCache = new Map()

export function canonicalBookKey(root) {
  const native = realpathSync.native(resolve(root))
  let key = native.replace(/[\\/]+/g, '/')
  key = key.replace(/\/+$/, '')
  if (key === '') key = '/'
  return key.toLowerCase()
}

export function writerPipeName(bookKey) {
  return WRITER_PIPE_PREFIX + writerLockNameSuffix(bookKey)
}

/** 锁名中平台无关的部分：`<sha256(bookKey).slice(0,32)>`。 */
function writerLockNameSuffix(bookKey) {
  return createHash('sha256').update(bookKey).digest('hex').slice(0, 32)
}

/**
 * 实际监听端点（与 TS 侧 writerLock.ts 的 writerListenEndpoint 同源同义）：
 * win32 → 命名管道；linux → 抽象命名空间套接字（真排他、内核管生命周期、不落文件）；
 * 其他平台没有等价原语 → fail-closed 抛错，绝不降级成假锁。
 */
export function writerListenEndpoint(bookKey) {
  if (process.platform === 'win32') return writerPipeName(bookKey)
  if (process.platform === 'linux') return '\0mozhou-writer-' + writerLockNameSuffix(bookKey)
  throw new BookWriterLockError(
    'WRITER_LOCK_UNSUPPORTED_PLATFORM',
    bookKey,
    'book writer lock has no cross-process exclusive primitive on platform=' + process.platform + '; refusing to degrade to a non-exclusive lock',
  )
}

export class BookWriterLockError extends Error {
  constructor(code, bookKey, message) {
    super(message)
    this.name = 'BookWriterLockError'
    this.code = code
    this.bookKey = bookKey
  }
}

/** 默认探测：与 TS 侧同命令同口径；**只缓存成功判定**（不可判定不入缓存）。 */
export function probeDriveType(driveLetter) {
  if (process.platform !== 'win32') return null
  const cached = driveTypeCache.get(driveLetter)
  if (cached !== undefined) return cached
  let output = null
  try {
    const fsutil = process.env.SystemRoot ? process.env.SystemRoot + '\\System32\\fsutil.exe' : 'fsutil'
    // 不指定 encoding：拿原始字节，再按多种代码页解码（fsutil 输出是控制台 OEM 代码页）
    const raw = execFileSync(fsutil, ['fsinfo', 'drivetype', driveLetter], { timeout: 5000, windowsHide: true })
    output = decodeConsoleText(raw)
  } catch {
    output = null
  }
  if (typeof output === 'string' && output.trim() !== '') driveTypeCache.set(driveLetter, output)
  return output
}

/** 与 TS 侧 decodeConsoleText 同口径：fsutil 输出是控制台 OEM 代码页，按多代码页解码后合并。 */
function decodeConsoleText(raw) {
  const variants = [raw.toString('utf8')]
  for (const encoding of ['gbk', 'gb18030']) {
    try {
      variants.push(new TextDecoder(encoding).decode(raw))
    } catch {
      // ICU 不含该编码：跳过
    }
  }
  return variants.join('\n')
}

function stripExtendedPrefix(path) {
  if (path.startsWith('\\\\?\\UNC\\')) return '\\\\' + path.slice(8)
  if (path.startsWith('\\\\?\\') || path.startsWith('\\\\.\\')) return path.slice(4)
  return path
}

/** 与 TS 侧 classifyBookRootKind 同口径：'local' | 'unc' | 'network-drive' | 'unverified'。 */
export function classifyBookRootKind(root, probe = probeDriveType) {
  const absolute = resolve(root)
  const plain = stripExtendedPrefix(absolute)
  if (plain.startsWith('\\\\') || plain.startsWith('//')) return 'unc'
  if (process.platform !== 'win32') return 'local'
  const drive = /^([A-Za-z]):[\\/]/.exec(absolute)
  if (drive === null) return 'local'
  const output = probe(drive[1].toUpperCase() + ':')
  if (typeof output === 'string') {
    if (REMOTE_DRIVE_MARKER.test(output)) return 'network-drive'
    if (LOCAL_DRIVE_MARKER.test(output)) return 'local'
  }
  return 'unverified'
}

/** 与 TS 侧 assertLocalWritableBookRoot 同口径；返回 bookKey。 */
export function assertLocalWritableBookRoot(root, probe = probeDriveType, options = {}) {
  const kind = classifyBookRootKind(root, probe)
  if (kind === 'local') return canonicalBookKey(root)
  const bookKey = (() => {
    try {
      return canonicalBookKey(root)
    } catch {
      return resolve(root).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
    }
  })()
  if (kind === 'unverified') {
    if (options.allowUnverifiedRoot === true || process.env[ALLOW_UNVERIFIED_BOOK_ROOT_ENV] === '1') return bookKey
    throw new BookWriterLockError(
      'BOOK_ROOT_UNVERIFIED',
      bookKey,
      'book root drive type could not be verified as a local fixed drive: ' + root +
        ' — refusing to bind the writer lock (set ' + ALLOW_UNVERIFIED_BOOK_ROOT_ENV + '=1 to override)',
    )
  }
  const detail = kind === 'unc' ? 'a UNC/network share' : 'a mapped network drive'
  throw new BookWriterLockError(
    'BOOK_ROOT_NOT_LOCAL',
    bookKey,
    'book root must be a local fixed drive — ' + detail + ' cannot be protected by the named-pipe writer lock: ' + root,
  )
}

/**
 * 以同一命名管道入口占锁。先过书根守卫（UNC/映射盘/不可判定一律拒绝），再绑定管道；
 * 已有写入者（服务或另一脚本）则明确拒绝。
 */
export async function holdBookWriteLock(root, options = {}) {
  let bookKey
  try {
    bookKey = assertLocalWritableBookRoot(root, options.probe ?? probeDriveType, options)
  } catch (error) {
    if (error instanceof BookWriterLockError) throw error
    throw new BookWriterLockError('BOOK_ROOT_UNRESOLVABLE', String(root), 'book root cannot be canonicalized: ' + root + ' (' + error.message + ')')
  }
  const pipeName = writerPipeName(bookKey)
  const endpoint = writerListenEndpoint(bookKey)
  const server = net.createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        rejectListen(new BookWriterLockError('BOOK_WRITE_BUSY', bookKey, 'another writer already holds this book (bookKey=' + bookKey + ' pipe=' + pipeName + ') — stop the server or the other script first'))
        return
      }
      rejectListen(new BookWriterLockError('WRITER_LOCK_FAILED', bookKey, 'failed to bind writer endpoint: bookKey=' + bookKey + ' pipe=' + pipeName + ' endpoint=' + endpoint + ' code=' + error.code))
    })
    server.listen(endpoint, () => resolveListen())
  })
  let released = false
  return async () => {
    if (released) return
    released = true
    await new Promise((resolveClose) => server.close(() => resolveClose()))
  }
}

/** 取锁 → 执行 → 释放（脚本里也可只用 holdBookWriteLock 占满整个进程生命周期）。 */
export async function withBookWriteLock(root, fn, options = {}) {
  const release = await holdBookWriteLock(root, options)
  try {
    return await fn()
  } finally {
    await release()
  }
}
