/**
 * W2-2 写入权原语测试：身份归一 / 命名管道排他 / SIGKILL 后可立即重取 /
 * 网络共享书根拒绝 / DataRootProcessLock 修正 / 超时与取消不泄漏句柄。
 *
 * 全部夹具建在系统临时目录，不读写真实书稿。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DataRootProcessLock } from '../bookAccess.js'
import {
  ALLOW_UNVERIFIED_BOOK_ROOT_ENV,
  BookWriteLockError,
  acquireBookWriteLock,
  assertLocalWritableBookRoot,
  canonicalBookKey,
  classifyBookRootKind,
  withBookWriteLock,
  writerPipeName,
} from './writerLock.js'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** 建一个「书根」目录（本原语只看目录身份，不要求是完整书）。 */
function makeBookRoot(): string {
  const root = join(makeTempDir('mozhou-writer-'), 'book')
  mkdirSync(root, { recursive: true })
  return root
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------------------------------------------------------------------
 * 1. 身份归一
 * ------------------------------------------------------------------------- */

describe('canonicalBookKey · 书籍身份归一', () => {
  // Windows 专属语义：junction 符号链接类型、盘符大小写不敏感、反斜杠尾分隔符。
  // Linux 上三者都不成立（大小写敏感、'\' 是合法文件名字符、symlinkSync 不接受 'junction'），
  // 故本用例只在 win32 断言；跨平台可断言的部分见下一个用例。
  it.skipIf(process.platform !== 'win32')('junction / 大小写 / 尾分隔符 / 点段等 7 种变体归一到同一个 key', () => {
    const root = makeBookRoot()
    const link = join(makeTempDir('mozhou-writer-link-'), 'booklink')
    symlinkSync(root, link, 'junction')

    const variants: Record<string, string> = {
      real: root,
      junction: link,
      lower: root.toLowerCase(),
      upper: root.toUpperCase(),
      trailingSeparator: root + '\\',
      dotSegments: join(root, 'a', '..', 'b', '..'),
      mixedCase: root.slice(0, 3).toUpperCase() + root.slice(3).toLowerCase(),
    }
    const keys = Object.entries(variants).map(([label, value]) => ({ label, key: canonicalBookKey(value) }))
    const distinct = new Set(keys.map((entry) => entry.key))

    // 实测输出（评审可复现）
    console.log('[canonicalBookKey] variants =', JSON.stringify(keys, null, 1))
    console.log('[canonicalBookKey] distinctNormalizedKeys =', distinct.size, 'allSame =', distinct.size === 1)

    expect(distinct.size).toBe(1)
    expect([...distinct][0]).toBe(canonicalBookKey(root))
  })

  // 同上的 Windows 专属部分：反斜杠尾分隔符与「key 必须全小写」都只在大小写不敏感、
  // '\' 作分隔符的 Windows 上成立。跨平台部分见下一个用例。
  it.skipIf(process.platform !== 'win32')('不同目录得到不同 key；尾分隔符不产生第二个身份', () => {
    const a = makeBookRoot()
    const b = makeBookRoot()
    expect(canonicalBookKey(a)).not.toBe(canonicalBookKey(b))
    expect(canonicalBookKey(a + '\\')).toBe(canonicalBookKey(a))
    const key = canonicalBookKey(a)
    expect(key).toBe(key.toLowerCase())
    expect(key).not.toContain('\\')
    expect(key.endsWith('/book')).toBe(true)
  })

  it('身份归一的跨平台部分：不同目录不同 key；尾分隔符与点段不产生第二个身份', () => {
    const a = makeBookRoot()
    const b = makeBookRoot()
    expect(canonicalBookKey(a)).not.toBe(canonicalBookKey(b))
    expect(canonicalBookKey(a + '/')).toBe(canonicalBookKey(a))
    expect(canonicalBookKey(join(a, 'x', '..'))).toBe(canonicalBookKey(a))
    expect(canonicalBookKey(a)).not.toContain('\\')
  })

  it('不存在的书根抛可定位的 BOOK_ROOT_UNRESOLVABLE', () => {
    const missing = join(makeTempDir('mozhou-writer-missing-'), 'nope')
    let thrown: unknown
    try {
      canonicalBookKey(missing)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BookWriteLockError)
    expect((thrown as BookWriteLockError).code).toBe('BOOK_ROOT_UNRESOLVABLE')
    expect((thrown as Error).message).toContain('nope')
  })
})

/* ---------------------------------------------------------------------------
 * 2. 命名管道排他
 * ------------------------------------------------------------------------- */

describe('acquireBookWriteLock · 命名管道排他', () => {
  it('管道名 = \\.\\pipe\\mozhou-writer-<sha256(key)[:32]>，且不含 PID', () => {
    const root = makeBookRoot()
    const key = canonicalBookKey(root)
    const pipe = writerPipeName(key)
    const prefix = '\\\\.\\pipe\\mozhou-writer-'
    expect(pipe.startsWith(prefix)).toBe(true)
    expect(pipe.slice(prefix.length)).toHaveLength(32)
    expect(pipe.slice(prefix.length)).toMatch(/^[0-9a-f]{32}$/)
    expect(pipe).not.toContain(String(process.pid))
  })

  it('第二持有者被拒绝（EADDRINUSE 语义），错误含 bookKey 与可操作信息', async () => {
    const root = makeBookRoot()
    const first = await acquireBookWriteLock(root)
    try {
      let thrown: unknown
      try {
        await acquireBookWriteLock(root)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BookWriteLockError)
      const error = thrown as BookWriteLockError
      expect(error.code).toBe('WRITER_LOCK_HELD')
      expect(error.bookKey).toBe(canonicalBookKey(root))
      expect(error.message).toContain(error.bookKey)
      expect(error.message).toContain(writerPipeName(error.bookKey))
      expect(error.message).toContain('timeoutMs')
    } finally {
      await first.release()
    }
  })

  it('不同书可并发持有；释放后可立即重新获取', async () => {
    const a = makeBookRoot()
    const b = makeBookRoot()
    const lockA = await acquireBookWriteLock(a)
    const lockB = await acquireBookWriteLock(b)
    expect(lockA.held).toBe(true)
    expect(lockB.held).toBe(true)
    await lockA.release()
    await lockB.release()

    const again = await acquireBookWriteLock(a)
    expect(again.held).toBe(true)
    await again.release()
  })

  it('超时排队：占用期间带 timeoutMs 的请求最终以 WRITER_LOCK_TIMEOUT 失败', async () => {
    const root = makeBookRoot()
    const holder = await acquireBookWriteLock(root)
    const started = Date.now()
    try {
      let thrown: unknown
      try {
        await acquireBookWriteLock(root, { timeoutMs: 200, pollIntervalMs: 25 })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BookWriteLockError)
      expect((thrown as BookWriteLockError).code).toBe('WRITER_LOCK_TIMEOUT')
      expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    } finally {
      await holder.release()
    }
    // 超时路径不留监听句柄：释放后仍能立刻拿到
    const after = await acquireBookWriteLock(root)
    await after.release()
  })

  it('取消排队：AbortSignal 中止等待且不留句柄', async () => {
    const root = makeBookRoot()
    const holder = await acquireBookWriteLock(root)
    const controller = new AbortController()
    const pending = acquireBookWriteLock(root, { timeoutMs: 5000, pollIntervalMs: 25, signal: controller.signal })
    setTimeout(() => controller.abort(), 60)
    let thrown: unknown
    try {
      await pending
    } catch (error) {
      thrown = error
    } finally {
      await holder.release()
    }
    expect(thrown).toBeInstanceOf(BookWriteLockError)
    expect((thrown as BookWriteLockError).code).toBe('WRITER_LOCK_ABORTED')
    const after = await acquireBookWriteLock(root)
    await after.release()
  })
})

/* ---------------------------------------------------------------------------
 * 3. 跨进程：强杀后立即重取，且不依赖 PID、不删任何锁文件
 * ------------------------------------------------------------------------- */

function spawnPipeHolder(pipeName: string): Promise<ChildProcess> {
  const script = [
    "import net from 'node:net'",
    "import { writeSync } from 'node:fs'",
    'const pipe = process.env.MOZHOU_TEST_PIPE',
    'const server = net.createServer()',
    "server.once('error', (error) => { writeSync(2, 'ERR ' + error.code + '\\n'); process.exit(2) })",
    "server.listen(pipe, () => { writeSync(1, 'LOCKED\\n') })",
  ].join('\n')
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOZHOU_TEST_PIPE: pipeName },
  })
  return new Promise<ChildProcess>((resolveChild, rejectChild) => {
    const timer = setTimeout(() => rejectChild(new Error('child did not bind the pipe in time')), 15000)
    child.stdout?.once('data', (chunk: Buffer) => {
      clearTimeout(timer)
      const text = chunk.toString('utf8')
      if (text.includes('LOCKED')) {
        resolveChild(child)
      } else {
        rejectChild(new Error('unexpected child stdout: ' + text))
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      rejectChild(new Error('child exited before binding: code=' + String(code)))
    })
  })
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit()
      return
    }
    child.once('exit', () => resolveExit())
  })
}

describe('跨进程排他 · 强杀后可立即重取', () => {
  // 夹具 spawnPipeHolder 以 writerPipeName(key) 直接绑定 Windows 命名管道名；
  // 非 Windows 上该名字绑不上（Linux 用抽象套接字），故本用例只在 win32 断言。
  // Linux 侧的跨进程排他由 writerLockIntegration 的「脚本侧与 TS 侧同一入口、互相排他」
  // 用例覆盖（该用例在两种平台都通过）。
  it.skipIf(process.platform !== 'win32')('外部持有者占用同名管道时被拒；SIGKILL 后立即可取且不删除任何文件', async () => {
    const root = makeBookRoot()
    const key = canonicalBookKey(root)
    const pipeName = writerPipeName(key)
    const parent = resolve(root, '..')
    const beforeEntries = readdirSync(parent).sort()

    const child = await spawnPipeHolder(pipeName)
    try {
      let thrown: unknown
      try {
        await acquireBookWriteLock(root)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BookWriteLockError)
      expect((thrown as BookWriteLockError).code).toBe('WRITER_LOCK_HELD')
    } finally {
      child.kill('SIGKILL')
      await waitForExit(child)
    }

    // 强杀后 OS 立即回收管道名：无需「检测失效 → 删锁 → 抢锁」
    const lock = await acquireBookWriteLock(root)
    expect(lock.held).toBe(true)
    await lock.release()

    // 全程没有任何锁文件：书根本身与其父目录内容不变
    expect(existsSync(join(root, '.mozhou_instance.lock'))).toBe(false)
    expect(readdirSync(root)).toEqual([])
    expect(readdirSync(parent).sort()).toEqual(beforeEntries)
  }, 30000)
})

/* ---------------------------------------------------------------------------
 * 4. 网络共享书根拒绝
 * ------------------------------------------------------------------------- */

// 本组多数用例断言的是 Windows 盘符与 fsutil 探测语义：classifyBookRootKind 在非 win32 上
// 直接判为 local（无盘符概念），这些分支在 Linux 上不可达，故逐条标 skipIf 只在 win32 断言；
// 非 Windows 行为由「本机临时目录实测为 local」与紧随其后的 Linux 断言覆盖。
describe('网络共享书根拒绝', () => {
  it.skipIf(process.platform !== 'win32')('UNC 书根（\\\\server\\share 与 //server/share）被拒绝为可写书根', async () => {
    for (const unc of ['\\\\fileserver\\novels\\book1', '//fileserver/novels/book1']) {
      expect(classifyBookRootKind(unc)).toBe('unc')
      let thrown: unknown
      try {
        await acquireBookWriteLock(unc)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BookWriteLockError)
      const error = thrown as BookWriteLockError
      expect(error.code).toBe('BOOK_ROOT_NOT_LOCAL')
      expect(error.message).toContain(unc)
      expect(error.message).toContain('UNC')
    }
  })

  it.skipIf(process.platform !== 'win32')('映射网络盘（注入探测：英文/中文远端标记）被拒绝；本机固定盘通过', async () => {
    const remoteEn = (): string => 'Z: - Remote/Network Drive'
    const remoteZh = (): string => 'Z: - 远程/网络驱动器'
    expect(classifyBookRootKind('Z:\\novels\\book', remoteEn)).toBe('network-drive')
    expect(classifyBookRootKind('Z:\\novels\\book', remoteZh)).toBe('network-drive')
    expect(classifyBookRootKind('Z:\\novels\\book', () => 'Z: - 固定驱动器')).toBe('local')

    let thrown: unknown
    try {
      await acquireBookWriteLock('Z:\\novels\\book', { driveTypeProbe: remoteZh })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BookWriteLockError)
    expect((thrown as BookWriteLockError).code).toBe('BOOK_ROOT_NOT_LOCAL')
    expect((thrown as Error).message).toContain('mapped network drive')
  })

  it('本机临时目录实测为 local（真实 fsutil 探测路径）', async () => {
    const root = makeBookRoot()
    expect(classifyBookRootKind(root)).toBe('local')
    const held = await acquireBookWriteLock(root)
    await held.release()
  })

  it.skipIf(process.platform === 'win32')('非 Windows：无盘符概念，普通路径判为 local 且可正常取锁', async () => {
    const root = makeBookRoot()
    expect(classifyBookRootKind(root)).toBe('local')
    const held = await acquireBookWriteLock(root)
    expect(held.held).toBe(true)
    await held.release()
  })

  it.skipIf(process.platform !== 'win32')('探测不可判定（null）→ unverified，默认拒绝且不绑定管道（fail-closed）', async () => {
    const root = makeBookRoot()
    expect(classifyBookRootKind(root, () => null)).toBe('unverified')

    let thrown: unknown
    try {
      await acquireBookWriteLock(root, { driveTypeProbe: () => null })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BookWriteLockError)
    const error = thrown as BookWriteLockError
    expect(error.code).toBe('BOOK_ROOT_UNVERIFIED')
    expect(error.message).toContain(root)
    expect(error.message).toContain(ALLOW_UNVERIFIED_BOOK_ROOT_ENV)

    // 拒绝发生在绑定管道之前：同书仍能被正常探测的持有者拿到
    const held = await acquireBookWriteLock(root)
    await held.release()
  })

  it.skipIf(process.platform !== 'win32')('未知语言输出（无本地/远端标记）→ unverified，默认拒绝', () => {
    const root = makeBookRoot()
    const unknownLocale = (): string => 'Z: - Volume in drive Z is NOVELS'
    expect(classifyBookRootKind(root, unknownLocale)).toBe('unverified')
    expect(() => assertLocalWritableBookRoot(root, { driveTypeProbe: unknownLocale })).toThrow(/could not be verified/)
  })

  it.skipIf(process.platform !== 'win32')('显式 opt-in 覆盖：参数与 MOZHOU_ALLOW_UNVERIFIED_BOOK_ROOT=1 均放行（默认仍 fail-closed）', async () => {
    const root = makeBookRoot()
    const nullProbe = (): string | null => null

    // 参数覆盖
    expect(assertLocalWritableBookRoot(root, { driveTypeProbe: nullProbe, allowUnverifiedRoot: true })).toBe(canonicalBookKey(root))
    const held = await acquireBookWriteLock(root, { driveTypeProbe: nullProbe, allowUnverifiedRoot: true })
    expect(held.held).toBe(true)
    await held.release()

    // 环境变量覆盖（显式、有文档）；测完必须还原
    const previous = process.env[ALLOW_UNVERIFIED_BOOK_ROOT_ENV]
    process.env[ALLOW_UNVERIFIED_BOOK_ROOT_ENV] = '1'
    try {
      expect(assertLocalWritableBookRoot(root, { driveTypeProbe: nullProbe })).toBe(canonicalBookKey(root))
    } finally {
      if (previous === undefined) delete process.env[ALLOW_UNVERIFIED_BOOK_ROOT_ENV]
      else process.env[ALLOW_UNVERIFIED_BOOK_ROOT_ENV] = previous
    }
    // 还原后重新 fail-closed
    expect(() => assertLocalWritableBookRoot(root, { driveTypeProbe: nullProbe })).toThrow(/could not be verified/)

    // 硬拒绝不可被 opt-in 覆盖：UNC 永远拒绝
    expect(() => assertLocalWritableBookRoot('\\\\fileserver\\novels\\book1', { driveTypeProbe: nullProbe, allowUnverifiedRoot: true })).toThrow(
      /UNC|network share/,
    )
  })
})

/* ---------------------------------------------------------------------------
 * 5. DataRootProcessLock 修正
 * ------------------------------------------------------------------------- */

describe('DataRootProcessLock · 独占创建与稳定锁身份', () => {
  it('同进程第二实例被拒；release 后锁文件仍在（不删锁）且可被重新接管', () => {
    const dataRoot = makeTempDir('mozhou-dataroot-')
    const lockPath = join(dataRoot, '.mozhou_instance.lock')
    const lock1 = new DataRootProcessLock()
    const lock2 = new DataRootProcessLock()

    lock1.acquire(dataRoot)
    expect(existsSync(lockPath)).toBe(true)
    // F-10：锁记录 v2（JSON，holder 标记现行实例格式）——旧版裸 PID 视为历史遗留
    const recordAfterFirst = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number, holder: string }
    expect(recordAfterFirst.pid).toBe(process.pid)
    expect(recordAfterFirst.holder).toBe('mozhou-service')

    expect(() => lock2.acquire(dataRoot)).toThrow(/DATA_ROOT_LOCKED/)

    lock1.release()
    // 锁身份稳定：release 不 unlink、不重建同名文件
    expect(existsSync(lockPath)).toBe(true)
    expect((JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number }).pid).toBe(process.pid)

    expect(() => lock2.acquire(dataRoot)).not.toThrow()
    lock2.release()
    expect(existsSync(lockPath)).toBe(true)
  })

  it("'wx' 独占创建：现行格式（v2）的活 PID 记录不被截断，直接拒绝", () => {
    const dataRoot = makeTempDir('mozhou-dataroot-')
    const lockPath = join(dataRoot, '.mozhou_instance.lock')
    const parentPid = process.ppid
    let parentAlive = true
    try {
      process.kill(parentPid, 0)
    } catch {
      parentAlive = false
    }
    expect(parentAlive).toBe(true)

    // 模拟「现行墨舟实例」的锁记录必须是 v2 JSON——活着的无关 PID 的**旧版裸 PID
    // 历史记录**不在此列（F-02 负样本：历史 dataRoot 锁必须可被接管）
    const holderRecord = JSON.stringify({ schemaVersion: 2, pid: parentPid, holder: 'mozhou-service', startedAtIso: new Date().toISOString() }) + '\n'
    writeFileSync(lockPath, holderRecord, 'utf8')
    const lock = new DataRootProcessLock()
    expect(() => lock.acquire(dataRoot)).toThrow(/DATA_ROOT_LOCKED/)
    // 未被截断/改写：仍是原持有者记录（旧 'w' 实现会截断并覆盖）
    expect(readFileSync(lockPath, 'utf8')).toBe(holderRecord)
  })

  it('已死进程的遗留记录被就地接管（不删文件）', () => {
    const dataRoot = makeTempDir('mozhou-dataroot-')
    const lockPath = join(dataRoot, '.mozhou_instance.lock')
    // 一个几乎不可能存活的 PID（Windows PID 上限远小于此）
    writeFileSync(lockPath, '999999999\n', 'utf8')

    const lock = new DataRootProcessLock()
    expect(() => lock.acquire(dataRoot)).not.toThrow()
    expect((JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number }).pid).toBe(process.pid)
    lock.release()
    expect(existsSync(lockPath)).toBe(true)
  })
})

/* ---------------------------------------------------------------------------
 * 6. withBookWriteLock：超时 / 取消 / 异常都不泄漏句柄
 * ------------------------------------------------------------------------- */

describe('withBookWriteLock · 超时、取消与异常路径', () => {
  it('持锁期间超时失败，且 fn 不执行', async () => {
    const root = makeBookRoot()
    const holder = await acquireBookWriteLock(root)
    let ran = false
    let thrown: unknown
    try {
      await withBookWriteLock(root, () => { ran = true }, { timeoutMs: 150, pollIntervalMs: 25 })
    } catch (error) {
      thrown = error
    } finally {
      await holder.release()
    }
    expect(ran).toBe(false)
    expect(thrown).toBeInstanceOf(BookWriteLockError)
    expect((thrown as BookWriteLockError).code).toBe('WRITER_LOCK_TIMEOUT')
    const after = await acquireBookWriteLock(root)
    await after.release()
  })

  it('取消排队后不留句柄；正常执行后必然释放', async () => {
    const root = makeBookRoot()
    const holder = await acquireBookWriteLock(root)
    const controller = new AbortController()
    const pending = withBookWriteLock(root, () => 'never', { timeoutMs: 5000, pollIntervalMs: 25, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    let thrown: unknown
    try {
      await pending
    } catch (error) {
      thrown = error
    } finally {
      await holder.release()
    }
    expect((thrown as BookWriteLockError).code).toBe('WRITER_LOCK_ABORTED')

    const result = await withBookWriteLock(root, () => 'done')
    expect(result).toBe('done')
    // 执行后锁已释放：可再次获取
    const after = await acquireBookWriteLock(root)
    await after.release()
  })

  it('fn 抛异常时错误上抛且锁被释放（不泄漏管道句柄）', async () => {
    const root = makeBookRoot()
    await expect(withBookWriteLock(root, () => { throw new Error('boom') })).rejects.toThrow('boom')
    const after = await acquireBookWriteLock(root)
    await after.release()
  })

  it('失败/超时/取消之后事件循环无残留监听：连续 5 轮仍能正常取放', async () => {
    const root = makeBookRoot()
    for (let i = 0; i < 5; i += 1) {
      const holder = await acquireBookWriteLock(root)
      let thrown: unknown
      try {
        await acquireBookWriteLock(root, { timeoutMs: 60, pollIntervalMs: 10 })
      } catch (error) {
        thrown = error
      }
      expect((thrown as BookWriteLockError).code).toBe('WRITER_LOCK_TIMEOUT')
      await holder.release()
    }
    const final = await acquireBookWriteLock(root)
    await final.release()
  })
})
