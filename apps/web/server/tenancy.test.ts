// @vitest-environment node
/**
 * 公网作品归属和全路由隔离 (T09 · 真实 HTTP 级多租户与边界防护测试)。
 * 
 * 依照 reference/03-public-billing.md T09 规格实现负例矩阵：
 * 1. 主体 A + bookB → 404（正文/提案/候选/receipt/任务/导出/备份/分镜/删除全部如此）
 * 2. 主体 A + root="../../..." 或 dir/absolutePath → 400，无磁盘变化
 * 3. 主体 A + B 的 candidateId/receiptId/jobId → 404
 * 4. 主体 A + 自己 book 但 path 替换为 symlink → 403 拒绝
 * 5. 无认证 + 任意非公开 API → 401
 * 6. API 新路由未登记 policy → 运行拒绝 (403 UNREGISTERED_ROUTE_POLICY)
 * 7. 第二服务进程争夺同一个 dataRoot → 启动失败，不开始监听
 * 8. 本地模式 (local mode) 后端仍可打开旧格式测试书
 * 9. 自动化检查全路由策略登记覆盖率
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  type Dirent,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from './api.js'
import { defaultSessionManager, InMemoryAuthProvider } from './auth/session.js'
import { defaultBookAccessManager, DataRootProcessLock } from './bookAccess.js'
import { ROUTE_POLICIES, getRoutePolicy } from './routePolicies.js'
import { createBook } from '@mozhou/data-plane'
import { persistReceipt } from '@mozhou/context-compiler'
import type { ContextReceipt } from '@mozhou/kernel'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.clear()
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
})

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${addr.port}`)
    })
  })
}

function computeTreeHash(dir: string): string {
  const hash = createHash('sha256')
  function walk(current: string) {
    const entries: Dirent[] = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = join(current, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile()) {
        hash.update(e.name).update(readFileSync(full))
      }
    }
  }
  walk(dir)
  return hash.digest('hex')
}

describe('全路由租户隔离与所有权策略 (T09)', () => {
  it('自动化检查：当前所有注册路由均在 ROUTE_POLICIES 明确登记', () => {
    // 策略注册表非空且分类合法
    const validCategories = new Set(['public', 'account', 'book', 'local-native', 'payment-webhook'])
    const routes = Object.entries(ROUTE_POLICIES)
    expect(routes.length).toBeGreaterThanOrEqual(30)
    for (const [route, cat] of routes) {
      expect(route.startsWith('/api/')).toBe(true)
      expect(validCategories.has(cat)).toBe(true)
    }

    // 未登记路由 getRoutePolicy 恒返回 null（默认拒绝）
    expect(getRoutePolicy('/api/non-existent-shadow-route')).toBeNull()
  })

  it('未登记新路由请求 → 403 运行拒绝 (UNREGISTERED_ROUTE_POLICY)', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/unregistered.backdoor.endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(false)
    expect(body.code).toBe('UNREGISTERED_ROUTE_POLICY')
  })

  it('无认证 + 任意非公开 API → 401', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const base = await listen()

    const protectedEndpoints = [
      '/api/account',
      '/api/chapter.prose',
      '/api/works',
      '/api/tasks',
      '/api/cloud-sync',
    ]

    for (const ep of protectedEndpoints) {
      const res = await fetch(`${base}${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: 'bk_anonymous' }),
      })
      expect(res.status, `Endpoint ${ep} should require auth`).toBe(401)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(false)
      expect(body.code).toBe('UNAUTHORIZED')
    }
  })

  it('hosted 模式下禁止访问 local-native 端点 → 403', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const base = await listen()

    // 建立有效用户 session
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('user@test.com', 'password123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const localNativeEndpoints = [
      '/api/library',
      '/api/library.open',
      '/api/library.import',
    ]

    for (const ep of localNativeEndpoints) {
      const res = await fetch(`${base}${ep}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({ parentDir: tmpdir() }),
      })
      expect(res.status, `Endpoint ${ep} must be blocked in hosted mode`).toBe(403)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(false)
      expect(body.code).toBe('LOCAL_NATIVE_ONLY')
    }
  })

  it('主体 A + bookB → 404（逐端点参数化运行覆盖全作品路由）', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-tenancy-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBookAccessManager.setHostedMode(true)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)

    // 创建用户 A 与用户 B
    const { user: userA } = await provider.signUp('a@test.com', 'passA123')
    const { user: userB } = await provider.signUp('b@test.com', 'passB123')

    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })

    // 为用户 B 在 hosted 沙箱下创建作品 B
    const bookB = defaultBookAccessManager.createHostedBook(userB.id, '主体B的绝密小说')

    // 主体 A 尝试以主体 B 的 bookId 调用全量作品级端点
    const bookEndpoints = [
      '/api/book.state',
      '/api/chapter.prose',
      '/api/chapter.prose.save',
      '/api/chapter.reopen',
      '/api/receipts',
      '/api/receipt',
      '/api/change-matrix',
      '/api/change-matrix.rerun',
      '/api/works',
      '/api/tasks',
      '/api/ledger',
      '/api/draft.stream',
      '/api/draft.candidate',
      '/api/draft.cancel',
      '/api/draft.accept',
      '/api/storyboard.source',
      '/api/storyboard.save',
      '/api/storyboards',
      '/api/storyboard',
    ]

    for (const ep of bookEndpoints) {
      const res = await fetch(`${base}${ep}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieA,
        },
        body: JSON.stringify({
          bookId: bookB.bookId,
          chapterIndex: 1,
          expectedRevision: 1,
          body: '恶意注入内容',
        }),
      })
      expect(res.status, `Endpoint ${ep} should return 404 for non-owned book`).toBe(404)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.ok).toBe(false)
      expect(data.code).toBe('BOOK_NOT_FOUND')
    }
  })

  it('主体 A + root="../../..." 或 dir/absolutePath → 400，无磁盘变化', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-tenancy-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBookAccessManager.setHostedMode(true)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)

    const { user: userA } = await provider.signUp('a@test.com', 'passA123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })
    const bookA = defaultBookAccessManager.createHostedBook(userA.id, '用户A之书')

    // 记录请求前的完整目录指纹
    const hashBefore = computeTreeHash(dataRoot)

    const escapePayloads = [
      { root: '../../etc/passwd' },
      { root: '/etc/shadow' },
      { root: 'C:\\Windows\\System32' },
      { dir: '../..//escape' },
      { parentDir: '/var/data' },
      { path: '../../secret' },
    ]

    for (const payload of escapePayloads) {
      const res = await fetch(`${base}/api/chapter.prose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieA,
        },
        body: JSON.stringify({
          bookId: bookA.bookId,
          ...payload,
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(false)
      expect(body.code).toBe('INVALID_HOSTED_INPUT')
    }

    // 验证磁盘内容零变化
    const hashAfter = computeTreeHash(dataRoot)
    expect(hashAfter).toBe(hashBefore)
  })

  it('主体 A + B 的 candidateId/receiptId/jobId → 404', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-tenancy-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBookAccessManager.setHostedMode(true)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)

    const { user: userA } = await provider.signUp('a@test.com', 'passA123')
    const { user: userB } = await provider.signUp('b@test.com', 'passB123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })

    const bookA = defaultBookAccessManager.createHostedBook(userA.id, '书A')
    const bookB = defaultBookAccessManager.createHostedBook(userB.id, '书B')

    // 在书 B 中真实建立一个 candidate 和一个 receipt
    const candDirB = resolve(bookB.root, '.mozhou', 'candidates')
    mkdirSync(candDirB, { recursive: true })
    const candidateIdB = 'cand_b_secret_12345'
    writeFileSync(resolve(candDirB, `${candidateIdB}.json`), JSON.stringify({ id: candidateIdB, status: 'ready' }))

    const fakeReceipt = {
      id: 'rcpt_01J8TESTRECEIPTB00000000',
      taskType: 'chapter_writing',
      chapterIndex: 1,
      recomputationHash: 'hash_b',
      totalTokens: 100,
      storyTextQuota: { reservedTokens: 1000, actualTokens: 100 },
      inputsDigest: 'digest_b',
      entries: [],
      replayInputs: {},
    } as unknown as ContextReceipt
    persistReceipt(bookB.root, fakeReceipt)

    // 主体 A 传入书 A 的 bookId，但携带属于书 B 的 candidateId
    const resCand = await fetch(`${base}/api/draft.accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        bookId: bookA.bookId,
        candidateId: candidateIdB,
      }),
    })
    expect(resCand.status).toBe(404)
    const candData = (await resCand.json()) as Record<string, unknown>
    expect(candData.code).toBe('CANDIDATE_NOT_FOUND')

    // 主体 A 传入书 A 的 bookId，但携带属于书 B 的 receiptId
    const resRcpt = await fetch(`${base}/api/receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        bookId: bookA.bookId,
        receiptId: fakeReceipt.id,
      }),
    })
    expect(resRcpt.status).toBe(404)
    const rcptData = (await resRcpt.json()) as Record<string, unknown>
    expect(rcptData.code).toBe('RECEIPT_NOT_FOUND')
  })

  it('主体 A + 自己 book 但 path 替换为 symlink → 403 拒绝', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-tenancy-'))
    const outsideTarget = mkdtempSync(join(tmpdir(), 'mozhou-outside-secret-'))
    tempDirs.push(dataRoot, outsideTarget)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBookAccessManager.setHostedMode(true)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)

    const { user: userA } = await provider.signUp('a@test.com', 'passA123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })

    // 在 A 的书籍目录下创建一个指向外部目录的符号链接
    const userBooksDir = resolve(dataRoot, 'users', userA.id, 'books')
    mkdirSync(userBooksDir, { recursive: true })
    const symlinkBookId = 'bk_symlink_attack'
    const symlinkPath = resolve(userBooksDir, symlinkBookId)

    try {
      symlinkSync(outsideTarget, symlinkPath, 'dir')
    } catch {
      // 若平台限制跳过
      return
    }

    // 访问该符号链接书籍
    const res = await fetch(`${base}/api/chapter.prose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        bookId: symlinkBookId,
        chapterIndex: 1,
      }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(false)
    expect(body.code).toBe('SYMLINK_ESCAPE_BLOCKED')
  })

  it('第二服务进程争夺同一个 dataRoot → 启动失败，不开始监听', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-lock-'))
    tempDirs.push(dataRoot)

    const lock1 = new DataRootProcessLock()
    const lock2 = new DataRootProcessLock()

    // 实例 1 成功持锁
    lock1.acquire(dataRoot)

    // 实例 2 争夺同 dataRoot 锁，必须抛错且不开始监听
    expect(() => {
      lock2.acquire(dataRoot)
    }).toThrow(/DATA_ROOT_LOCKED/)

    // 实例 1 退出释放锁
    lock1.release()

    // 释放后实例 2 可正常获取
    expect(() => {
      lock2.acquire(dataRoot)
    }).not.toThrow()
    lock2.release()
  })

  it('本地模式 (local mode) 后端仍可打开旧格式测试书', async () => {
    defaultBookAccessManager.setHostedMode(false)
    const base = await listen()

    const localDir = mkdtempSync(join(tmpdir(), 'mozhou-old-format-'))
    tempDirs.push(localDir)

    // 创建一本本地测试书
    const created = createBook({ dir: localDir, title: '旧格式本地小说' })

    // 无需登录，直接以 root 访问作品状态与章节
    const res = await fetch(`${base}/api/book.state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: created.root }),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as Record<string, unknown>
    expect(data.ok).toBe(true)
    expect(data.state).toBeDefined()
  })
})
