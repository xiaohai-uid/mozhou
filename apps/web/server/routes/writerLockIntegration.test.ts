/**
 * W2-3 写入权接入测试：统一书稿锁（进程内 FIFO + 跨进程命名管道 + 可重入）的接入语义，
 * 以及 scripts/*.mjs 与 TS 原语「同一入口」的一致性。
 *
 * 隔离夹具：全部书根建在系统 tmpdir 下。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BookWriteBusyError,
  acquireBookWriteLease,
  isBookWriteBusyError,
  withBookWriteLock,
} from '../bookAccess.js'
import {
  BookWriteLockError,
  acquireBookWriteLock,
  assertLocalWritableBookRoot,
  canonicalBookKey,
  writerPipeName,
} from '../platform/writerLock.js'

const tempDirs: string[] = []

function makeBookRoot(prefix = 'mozhou-w23-'): string {
  const dir = join(mkdtempSync(join(tmpdir(), prefix)), 'book')
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

/**
 * 源码定位：两个契约验证命令都以 apps/web 为 cwd（pnpm --filter @mozhou/web exec vitest run server），
 * 故相对 cwd 解析——vitest 下 import.meta.url 不是可用的 file: 基址。
 */
function sourceFromAppsWeb(relFromAppsWeb: string): string {
  return readFileSync(resolve(process.cwd(), relFromAppsWeb), 'utf8')
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('统一书稿锁 · 同书串行 / 异书并发', () => {
  it('同书请求显式 FIFO 排队（先到先得），异书可并发', async () => {
    const root = makeBookRoot()
    const order: number[] = []
    const first = withBookWriteLock(root, async () => {
      order.push(1)
      await sleep(40)
      order.push(1.5)
    }, { timeoutMs: 5000 })
    const second = withBookWriteLock(root, async () => { order.push(2) }, { timeoutMs: 5000 })
    const third = withBookWriteLock(root, async () => { order.push(3) }, { timeoutMs: 5000 })
    await Promise.all([first, second, third])
    // 显式 FIFO：1 → 2 → 3，且 1 的两段都在 2 之前
    expect(order).toEqual([1, 1.5, 2, 3])
  })

  it('异书并发：A 持锁期间 B 能完成（不同书互不阻塞）', async () => {
    const rootA = makeBookRoot('mozhou-w23-a-')
    const rootB = makeBookRoot('mozhou-w23-b-')
    const events: string[] = []
    const a = withBookWriteLock(rootA, async () => {
      events.push('a-start')
      await sleep(80)
      events.push('a-end')
    }, { timeoutMs: 5000 })
    await sleep(10)
    const b = withBookWriteLock(rootB, async () => { events.push('b') }, { timeoutMs: 5000 })
    await Promise.all([a, b])
    expect(events).toEqual(['a-start', 'b', 'a-end'])
  })

  it('timeoutMs=0 时同书第二写入者被明确拒绝（BOOK_WRITE_BUSY，可转 409）', async () => {
    const root = makeBookRoot()
    const lease = await acquireBookWriteLease(root, { timeoutMs: 0 })
    try {
      let thrown: unknown
      try {
        await withBookWriteLock(root, () => 'never', { timeoutMs: 0 })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BookWriteBusyError)
      expect(isBookWriteBusyError(thrown)).toBe(true)
      expect((thrown as BookWriteBusyError).code).toBe('BOOK_WRITE_BUSY')
      expect((thrown as BookWriteBusyError).bookKey).toBe(canonicalBookKey(root))
    } finally {
      await lease.release()
    }
    // 释放后可立即重新获取
    const again = await acquireBookWriteLease(root, { timeoutMs: 0 })
    await again.release()
  })

  it('同调用链嵌套取锁可重入（路由 → 编排 → 数据面不会自锁死）', async () => {
    const root = makeBookRoot()
    const result = await withBookWriteLock(root, async () => {
      const inner = await withBookWriteLock(root, () => 'nested-ok', { timeoutMs: 0 })
      const lease = await acquireBookWriteLease(root, { timeoutMs: 0 })
      await lease.release()
      return inner
    }, { timeoutMs: 1000 })
    expect(result).toBe('nested-ok')
  })

  it('模型等待不占书稿锁：先 await 模型再取租约，等待期间另一写入者可拿到锁', async () => {
    const root = makeBookRoot()
    const events: string[] = []
    // 复刻 proseRoutes /api/chapter.commit 的取锁位置：extractDelta 内先跑模型，
    // 模型返回后才 acquireBookWriteLease（写回段才持锁）。
    const modelCall = (async () => {
      events.push('model-start')
      await sleep(60)
      events.push('model-end')
      return 'delta'
    })()
    await sleep(10)
    await withBookWriteLock(root, () => { events.push('other-writer') }, { timeoutMs: 2000 })
    const delta = await modelCall
    const lease = await acquireBookWriteLease(root, { timeoutMs: 2000 })
    try {
      events.push('write-phase')
    } finally {
      await lease.release()
    }
    expect(delta).toBe('delta')
    // other-writer 落在 model-start 与 model-end 之间 ⇒ 模型等待期间锁是空的
    expect(events).toEqual(['model-start', 'other-writer', 'model-end', 'write-phase'])
  })

  it('取消排队：AbortSignal 中止等待且不留队列占位', async () => {
    const root = makeBookRoot()
    const lease = await acquireBookWriteLease(root, { timeoutMs: 0 })
    const controller = new AbortController()
    const pending = withBookWriteLock(root, () => 'never', { timeoutMs: 5000, signal: controller.signal })
    setTimeout(() => controller.abort(), 40)
    let thrown: unknown
    try {
      await pending
    } catch (error) {
      thrown = error
    } finally {
      await lease.release()
    }
    expect((thrown as BookWriteBusyError).code).toBe('BOOK_WRITE_ABORTED')
    const after = await acquireBookWriteLease(root, { timeoutMs: 0 })
    await after.release()
  })
})

describe('scripts/*.mjs 与 TS 原语同一入口', () => {
  it('scripts/lib/book-writer-lock.mjs 与 writerLock.ts 算出同一管道名，且互相排他', async () => {
    const helper = (await import(
      pathToFileURL(resolve(process.cwd(), '../../scripts/lib/book-writer-lock.mjs')).href
    )) as {
      canonicalBookKey: (root: string) => string
      writerPipeName: (bookKey: string) => string
      holdBookWriteLock: (root: string) => Promise<() => Promise<void>>
    }
    const root = makeBookRoot('mozhou-w23-script-')
    // 同一命名规则：脚本侧与 TS 侧对同一书根必须得到同一管道名
    expect(helper.canonicalBookKey(root)).toBe(canonicalBookKey(root))
    expect(helper.writerPipeName(helper.canonicalBookKey(root))).toBe(writerPipeName(canonicalBookKey(root)))

    // 互相排他：脚本占锁时 TS 原语必须被拒（跨实现同一入口）
    const releaseScript = await helper.holdBookWriteLock(root)
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
      await releaseScript()
    }
    const after = await acquireBookWriteLock(root)
    await after.release()
  })

  it('脚本侧与 TS 侧拒绝口径对称：UNC 硬拒绝、探测不可判定 fail-closed、opt-in 放行', async () => {
    const helper = (await import(
      pathToFileURL(resolve(process.cwd(), '../../scripts/lib/book-writer-lock.mjs')).href
    )) as {
      assertLocalWritableBookRoot: (
        root: string,
        probe?: () => string | null,
        options?: { allowUnverifiedRoot?: boolean },
      ) => string
    }
    const root = makeBookRoot('mozhou-w23-script-guard-')

    // UNC：纯语法判定，不需探测，硬拒绝
    expect(() => helper.assertLocalWritableBookRoot('\\\\fileserver\\novels\\book1')).toThrow(/UNC|network share/)
    // 盘符 + 探测不可判定：脚本侧与 TS 侧同输入同结论（fail-closed）
    expect(() => helper.assertLocalWritableBookRoot(root, () => null)).toThrow(/could not be verified/)
    expect(() => assertLocalWritableBookRoot(root, () => null)).toThrow(/could not be verified/)
    // 未知语言输出同样不认
    expect(() => helper.assertLocalWritableBookRoot(root, () => 'Z: - Volume in drive Z is NOVELS')).toThrow(
      /could not be verified/,
    )
    // 显式 opt-in 放行（脚本侧参数）
    expect(helper.assertLocalWritableBookRoot(root, () => null, { allowUnverifiedRoot: true })).toBe(canonicalBookKey(root))
  })
})

describe('接入范围核对', () => {
  it('用户配置与 BYOK 凭据写入不接入书稿锁（规划 §6.1）', () => {
    for (const rel of ['server/account/store.ts', 'server/llm/providerSettings.ts']) {
      const source = sourceFromAppsWeb(rel)
      // 判定「不接入书稿锁」而不是「不 import bookAccess」：这两处经 defaultBookAccessManager
      // 取数据根是既有的合法依赖，要排除的是锁入口本身。
      expect(source).not.toContain('withBookWriteLock')
      expect(source).not.toContain('acquireBookWriteLease')
      expect(source).not.toMatch(/withBookLock\s*\(/)
    }
  })

  it('storyboard 的重复承诺链已删除，三套互斥收敛为统一锁', () => {
    const store = sourceFromAppsWeb('server/storyboard/store.ts')
    // 只判「承诺链实现已删除」：注释里保留历史名称是有意的
    expect(store).not.toMatch(/const bookSaveChains/)
    expect(store).toContain('withBookWriteLock')
  })
})
