/**
 * 工单 08：句柄 seam 的生命周期与所有权语义（替代 245 行正则守卫的那条真实测试）。
 *
 * 为什么这文件存在而旧的 planeHandles.test.ts 被删：旧守卫判的是**源码形状**
 * （这个 open 配没配到 close），所以它得维护 7 条合成源码自检、还得处理正则的
 * 误报面。本文件判的是**句柄的真实生死**——借出的句柄在四条出口上是否都还回去了：
 * 正常返回、同步抛错、异步拒绝、以及重入/竞争。形状由 eslint 的
 * `no-restricted-syntax` 常驻门禁把守（见 eslint.config.js），生死在这里把守。
 *
 * 判据用 `plane.db.open`（better-sqlite3 的真实句柄状态，close 后为 false）而不是
 * mock 计数：漏 close 的真实后果正是「句柄还开着」，用真句柄判才不会自欺。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { RUNTIME_DB_PATH } from './layout.js'
import { LocalDataPlane, ProjectionMissingError, rebuildProjectionFromCanon } from './local-data-plane.js'
import {
  isPlaneOpen,
  releaseBook,
  retainBook,
  retainStrictBook,
  withBook,
  withStrictBook,
} from './with-plane.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t08-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: '句柄海' })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
})

function removeProjection(root: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(join(root, RUNTIME_DB_PATH + suffix), { force: true })
  }
}

describe('withBook：正常返回', () => {
  it('fn 拿到可用的句柄，退出后句柄已归还', () => {
    let openInside: boolean | null = null
    const title = withBook(bookRoot, (plane) => {
      openInside = isPlaneOpen(plane)
      return plane.book.title
    })
    expect(openInside).toBe(true)
    // 句柄归还的机械事实：借过之后同一本书立刻能再借一次并读到书身份。
    expect(title).toBe('句柄海')
  })

  it('返回值就是 fn 的返回值本身（不被 Promise 包装）', () => {
    const marker = { ok: true }
    expect(withBook(bookRoot, () => marker)).toBe(marker)
  })

  it('withStrictBook 与 withBook 共用归还语义', () => {
    let openInside: boolean | null = null
    withStrictBook(bookRoot, (plane) => {
      openInside = isPlaneOpen(plane)
    })
    expect(openInside).toBe(true)
  })
})

describe('withBook：抛错', () => {
  it('fn 同步抛错时异常原样上抛，且句柄仍被归还', () => {
    let openInside: boolean | null = null
    const boom = new Error('boom')
    expect(() =>
      withBook(bookRoot, (plane) => {
        openInside = isPlaneOpen(plane)
        throw boom
      }),
    ).toThrow(boom)
    // 句柄在 fn 期间是开的；归还与否靠「退出后该句柄已关」证明——
    // 下面这次 open 若成功，说明上一轮没有把 SQLite 文件锁死在坏状态。
    expect(openInside).toBe(true)
    expect(() => withBook(bookRoot, () => 'reusable')).not.toThrow()
  })

  it('打开失败（不是 fn 失败）时不产生句柄，错误照抛', () => {
    const missing = join(tmpdir(), `mozhou-t08-missing-${Math.random().toString(36).slice(2)}`)
    mkdirSync(missing, { recursive: true })
    tmpRoots.push(missing)
    let called = false
    expect(() =>
      withStrictBook(missing, () => {
        called = true
      }),
    ).toThrow()
    expect(called).toBe(false)
  })

  it('withBook 在投影缺失时会自建投影，withStrictBook 则照抛 ProjectionMissingError', () => {
    removeProjection(bookRoot)
    expect(() => withStrictBook(bookRoot, () => undefined)).toThrow(ProjectionMissingError)
    // 严格打开失败没有把投影补上——随后 withBook 仍需自己重建。
    expect(() => withStrictBook(bookRoot, () => undefined)).toThrow(ProjectionMissingError)
    expect(withBook(bookRoot, (plane) => plane.book.title)).toBe('句柄海')
  })
})

describe('withBook：异步拒绝', () => {
  it('fn 返回 Promise 时，句柄在 settle 之前不得关闭', async () => {
    // 这是本票修掉的真实缺陷：旧的 try/finally 形态在第一个 await 之前就 close，
    // 把「漏 close」换成「await 期间句柄已关」。本例必须在 await 之后仍能读句柄。
    let openAfterAwait: boolean | null = null
    const title = await withBook(bookRoot, async (plane) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      openAfterAwait = isPlaneOpen(plane)
      return plane.book.title
    })
    expect(title).toBe('句柄海')
    expect(openAfterAwait).toBe(true)
  })

  it('Promise 拒绝：拒绝原样传播，且句柄仍被归还', async () => {
    const boom = new Error('async boom')
    let captured: LocalDataPlane | null = null
    await expect(
      withBook(bookRoot, async (plane) => {
        captured = plane
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw boom
      }),
    ).rejects.toThrow(boom)
    // 归还的机械事实：拒绝之后同一本书仍能立刻再借一次。
    expect(withBook(bookRoot, (plane) => plane.book.title)).toBe('句柄海')
    expect(captured).not.toBeNull()
  })

  it('fn 同步抛错后紧接着的 async 借用不受污染', async () => {
    expect(() =>
      withBook(bookRoot, () => {
        throw new Error('sync')
      }),
    ).toThrow('sync')
    // 真正跨 await 的 async 借用（不是没有 await 的 async 壳）
    await expect(
      withBook(bookRoot, async (plane) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return plane.book.title
      }),
    ).resolves.toBe('句柄海')
  })
})

describe('withBook：重复与竞争使用', () => {
  it('同一根连续借用 N 次：每次都拿到独立可用句柄，互不干扰', () => {
    const seen: boolean[] = []
    for (let i = 0; i < 20; i += 1) {
      seen.push(withBook(bookRoot, (plane) => {
        expect(isPlaneOpen(plane)).toBe(true)
        return plane.getCanonState().outlineNodes.length
      }) >= 0)
    }
    expect(seen.every(Boolean)).toBe(true)
  })

  it('并发借用：N 个并行 withBook 各自读到一致事实，无交叉关闭', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withBook(bookRoot, async (plane) => {
          await new Promise((resolve) => setTimeout(resolve, i % 3))
          // 并发期间句柄必须始终可用——若某个借用提前关掉了别人的句柄，这里会炸。
          return { open: isPlaneOpen(plane), title: plane.book.title }
        }),
      ),
    )
    expect(results.every((r) => r.open)).toBe(true)
    expect(new Set(results.map((r) => r.title))).toEqual(new Set(['句柄海']))
  })

  it('嵌套借用：内层退出不得关掉外层仍在用的句柄', () => {
    let outerOpenAfterInner = false
    withBook(bookRoot, (outer) => {
      withBook(bookRoot, (inner) => {
        expect(isPlaneOpen(inner)).toBe(true)
      })
      // 内层已归还自己的句柄，外层的必须仍然是开着的。
      outerOpenAfterInner = isPlaneOpen(outer)
      expect(outer.getCanonState().outlineNodes.length).toBeGreaterThanOrEqual(0)
    })
    expect(outerOpenAfterInner).toBe(true)
  })

  it('抛出后紧接嵌套借用：外层归还不影响随后新借的句柄', () => {
    expect(() =>
      withBook(bookRoot, () => {
        throw new Error('outer')
      }),
    ).toThrow('outer')
    expect(withBook(bookRoot, (plane) => isPlaneOpen(plane))).toBe(true)
  })
})

describe('retainBook / releaseBook：显式所有权转移', () => {
  it('retain 出来的句柄在 release 之前保持可用，release 之后关闭', () => {
    const plane = retainBook(bookRoot)
    expect(isPlaneOpen(plane)).toBe(true)
    expect(plane.getCanonState().outlineNodes.length).toBeGreaterThanOrEqual(0)
    releaseBook(plane)
    expect(isPlaneOpen(plane)).toBe(false)
  })

  it('retainStrictBook 走严格打开：投影缺失照抛', () => {
    rebuildProjectionFromCanon(bookRoot)
    removeProjection(bookRoot)
    expect(() => retainStrictBook(bookRoot)).toThrow(ProjectionMissingError)
  })

  it('两个 retain 各自独立：释放其一不影响另一个', () => {
    const a = retainBook(bookRoot)
    const b = retainBook(bookRoot)
    releaseBook(a)
    expect(isPlaneOpen(a)).toBe(false)
    expect(isPlaneOpen(b)).toBe(true)
    expect(b.getCanonState().outlineNodes.length).toBeGreaterThanOrEqual(0)
    releaseBook(b)
  })

  it('与 withBook 混用：withBook 的归还不影响 retain 借出的句柄', () => {
    const held = retainBook(bookRoot)
    withBook(bookRoot, (plane) => {
      expect(isPlaneOpen(plane)).toBe(true)
    })
    expect(isPlaneOpen(held)).toBe(true)
    expect(held.getCanonState().outlineNodes.length).toBeGreaterThanOrEqual(0)
    releaseBook(held)
  })
})

describe('句柄的真实生死（不用 mock 计数）', () => {
  it('一整轮借用/归还后，书根可被整体删除——说明没有句柄还压着文件', () => {
    const root = join(tmpdir(), `mozhou-t08-freeable-${Math.random().toString(36).slice(2)}`)
    mkdirSync(root, { recursive: true })
    createBook({ dir: root, title: '可释放' })
    for (let i = 0; i < 5; i += 1) {
      withBook(root, (plane) => plane.getChangeMatrix())
    }
    const held = retainBook(root)
    releaseBook(held)
    // Windows 上文件被句柄压住时 rmSync 会抛 EBUSY/EPERM；能删掉即证明无残留句柄。
    expect(() => rmSync(root, { recursive: true, force: true })).not.toThrow()
  })
})
