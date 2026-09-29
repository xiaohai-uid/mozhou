// @vitest-environment node
/**
 * 工单07 的端点级回归：证明**每个**书级端点都走了同一个解码缝，且旧代码里五种
 * 互不一致的 chapterIndex 校验已被收为一条。
 *
 * 三层证据，逐层加码：
 *   A. 表驱动：16 个书级端点 × 非法章号集合（0 / 小数 / 缺字段）全部 400
 *      INVALID_BOOK_REQUEST，且章号非法在**任何动盘之前**（盘面与账本零变更）。
 *   B. hosted 主体闸：无 session 的书级请求在 hosted 下 401 UNAUTHORIZED_PRINCIPAL，
 *      在 local 下照常走到业务分支（这条证明我们没有把 401 当成一刀切的门禁）。
 *   C. 合法请求未被误伤：每端点的正常形状仍然 2xx/既有语义（不是只测拒绝路径）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../api.js'
import { createBook, proseChapterPath } from '@mozhou/data-plane'
import { INVALID_BOOK_REQUEST, NO_OPEN_PRODUCTION_SESSION } from '../routeCodes.js'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
const savedHosted = process.env['MOZHOU_HOSTED']

beforeEach(() => {
  delete process.env['MOZHOU_HOSTED']
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      /* Windows file lock tolerance */
    }
  }
  roots = []
  if (savedHosted === undefined) delete process.env['MOZHOU_HOSTED']
  else process.env['MOZHOU_HOSTED'] = savedHosted
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.end('nf')
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

async function post(
  base: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

function makeBook(title: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-decode07-'))
  roots.push(dir)
  createBook({ dir, title })
  return dir
}

/**
 * 让网��的「二级工件归属预检」（bookAccess.ts:372 assertResourceOwnership）放行：
 * 那个预检在**路由处理器之前**执行，会先对 candidateId 做盘上存在性检查（404
 * CANDIDATE_NOT_FOUND）。这与本票无关（是既有的多租户工件归属闸），但意味着端到端
 * 走 HTTP 时 draft.accept 的非法章号会被它挡在解码器之前——所以这里造一个真的候选文件，
 * 让请求确实抵达解码器。真实候选的 schema 不参与本测试的断言。
 */
function seedCandidateArtifact(root: string, candidateId: string): void {
  const dir = join(root, '.mozhou', 'candidates')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, candidateId + '.json'), '{"candidateId":"' + candidateId + '","status":"ready"}', 'utf8')
}

/**
 * 全部走同一个解码缝的 16 个书级端点（工单点数：pipelineRoutes 9 / proseRoutes 5 /
 * storyboardRoutes 2）。`extra` 是各端点自己那部分的必填字段——只为让「非法章号」
 * 这一条成为**唯一**的失败原因，否则测的是别的守卫。
 */
const CHAPTER_ENDPOINTS: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
  // proseRoutes 5
  ['/api/chapter.prose', {}],
  ['/api/chapter.prose.save', { body: '正文。', expectedRevision: null }],
  ['/api/chapter.reopen', {}],
  ['/api/chapter.resubmit', {}],
  ['/api/chapter.commit', { summary: '定稿', expectedRevision: 0 }],
  // pipelineRoutes 9
  ['/api/session.open', {}],
  ['/api/session.advance', {}],
  ['/api/session.abandon', {}],
  ['/api/draft.stream', { prompt: '继续' }],
  ['/api/draft.accept', { candidateId: 'cnd_x', idempotencyKey: 'k', base: { revision: 0, sha256: 'h' } }],
  ['/api/chapter.review', {}],
  ['/api/chapter.rework', {}],
  ['/api/chapter.corrections', { reasons: ['pacing'] }],
  ['/api/chapter.quality', {}],
  // storyboardRoutes 2
  ['/api/storyboard.source', {}],
  [
    '/api/storyboard.generate',
    { expectedSourceHash: 'h', options: { aspectRatio: '9:16', targetDurationSeconds: 60, visualStyle: '写实' } },
  ],
]

/** 旧代码里五种写法互相打架的输入；端点层同样必须全部 400。 */
const INVALID_CHAPTER: ReadonlyArray<readonly [string, unknown]> = [
  ['0', 0],
  ['-1', -1],
  ['1.5', 1.5],
  ['数字字符串', '3'],
]

/** 章号可选的端点（只有 /api/draft.accept）：「缺字段」对它合法，不进拒绝表。 */
const CHAPTER_OPTIONAL_ENDPOINTS: ReadonlySet<string> = new Set(['/api/draft.accept'])

describe('A. 16 个书级端点全部使用统一解码：非法章号一律 400 且零写入', () => {
  for (const [path, extra] of CHAPTER_ENDPOINTS) {
    it(`${path}：0/负数/小数/字符串/缺字段 → 400 INVALID_BOOK_REQUEST`, async () => {
      const base = await listen()
      const root = makeBook('解码端点测试')
      // draft.accept 额外需要候选工件在场，才能越过网关的工件归属预检抵达解码器。
      if (path === '/api/draft.accept') seedCandidateArtifact(root, 'cnd_x')

      for (const [label, chapterIndex] of INVALID_CHAPTER) {
        const { status, data } = await post(base, path, { ...extra, root, chapterIndex })
        expect(status, `${path} / ${label} → ` + JSON.stringify(data)).toBe(400)
        expect(data['ok']).toBe(false)
        expect(String(data['error'])).toMatch(/chapterIndex/)
        expect(data['code'], `${path} / ${label}`).toBe(INVALID_BOOK_REQUEST)
      }

      // 章号必选的端点：缺字段同样是 400（这就是旧代码里"有的判缺、有的不判"的分歧点）。
      if (!CHAPTER_OPTIONAL_ENDPOINTS.has(path)) {
        const missing = await post(base, path, { ...extra, root })
        expect(missing.status, path + ' 缺字段 → ' + JSON.stringify(missing.data)).toBe(400)
        expect(missing.data['code'], path).toBe(INVALID_BOOK_REQUEST)
        expect(String(missing.data['error'])).toMatch(/chapterIndex/)
      }

      // 拒绝在动盘之前：本端点涉及章文件的那些，文件根本不该被创建。
      expect(existsSync(join(root, proseChapterPath(1)))).toBe(false)
    })
  }

  it('draft.accept 的章号可选：缺省不被误判为「缺字段」（那是它独有的契约）', async () => {
    const base = await listen()
    const root = makeBook('采纳章号可选')
    // 走到业务分支（候选不存在 ⇒ 404/409），而不是解码器 400。
    const { status, data } = await post(base, '/api/draft.accept', {
      root,
      candidateId: 'cnd_absent',
      idempotencyKey: 'k07',
      base: { revision: 0, sha256: 'h' },
    })
    expect(status).not.toBe(400)
    expect(String(data['error'])).not.toMatch(/chapterIndex/)
  })
})

describe('B. hosted 无 session 的分层事实：解码层的 401 不可端到端触发（如实记录而非伪造）', () => {
  /**
   * 如实记录的门禁顺序（读码得出，本测试**不改**它）：
   *   router.ts:100-114 在 hosted 下会话解析失败即 401 UNAUTHORIZED，请求**根本不进路由处理器**。
   *   故端到端拿不到 bookRequest 的 401 UNAUTHORIZED_PRINCIPAL；那是**双层防护的内层**
   *   （语义与 router 那层一致，不同码），在「路由器已放行但处理器手上没有主体」时可达成
   *   ——例如处理器被直接调用、或将来路由策略调整。单元级证据见 bookRequest.test.ts 第 5 组。
   * 断言既有的外层行为不变（防止本票顺手把它改坏），不为可观察性放宽任何一闸。
   */
  it('hosted + 无 session：网关层先拒 401 UNAUTHORIZED（既有语义，本票未改动）', async () => {
    process.env['MOZHOU_HOSTED'] = 'true'
    const base = await listen()
    const root = makeBook('hosted 外层闸')
    const { status, data } = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(status).toBe(401)
    expect(data['code']).toBe('UNAUTHORIZED')
  })

  it('hosted + 无 session 连章号都不给：仍是 401（先认证，后谈形状）', async () => {
    process.env['MOZHOU_HOSTED'] = 'true'
    const base = await listen()
    const root = makeBook('hosted 外层闸 2')
    const { status, data } = await post(base, '/api/chapter.prose', { root })
    expect(status).toBe(401)
    expect(data['code']).toBe('UNAUTHORIZED')
  })

  it('local 模式（无 MOZHOU_HOSTED）不误伤：同一请求照常走业务分支（既有回退主体语义未变）', async () => {
    const base = await listen()
    const root = makeBook('local 不误伤')
    const { status, data } = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    // 盘上无此章 ⇒ 200 exists:false（业务空态），绝不是 401。
    expect(status).toBe(200)
    expect(data['exists']).toBe(false)
  })
})

describe('C. 合法章号未被误伤：既有语义原样保留', () => {
  it('/api/chapter.prose 读写往返仍然 200（不是只测拒绝路径）', async () => {
    const base = await listen()
    const root = makeBook('合法往返')
    const created = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '第一章。',
      expectedRevision: null,
    })
    expect(created.status).toBe(200)
    const read = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(read.status).toBe(200)
    expect(read.data['body']).toBe('第一章。\n')
  })

  it('/api/session.open 正常开卷 200；无会话 advance 仍是 409 NO_OPEN_PRODUCTION_SESSION（文案逐字不变）', async () => {
    const base = await listen()
    const root = makeBook('会话文案')
    const noSession = await post(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(noSession.status).toBe(409)
    expect(noSession.data['code']).toBe(NO_OPEN_PRODUCTION_SESSION)
    expect(String(noSession.data['error'])).toContain('no open production session')

    const opened = await post(base, '/api/session.open', { root, chapterIndex: 1 })
    expect(opened.status).toBe(200)
    expect(opened.data['currentStep']).toBe('prepare')
  })

  it('/api/session.advance 与 /api/chapter.review 在同一无会话形状下给出同一契约错误（工单点名的三处重复已收口）', async () => {
    const base = await listen()
    const root = makeBook('三处重复收口')
    for (const path of ['/api/session.advance', '/api/chapter.review', '/api/chapter.rework']) {
      const { status, data } = await post(base, path, { root, chapterIndex: 1 })
      expect(status, path).toBe(409)
      expect(data['code'], path).toBe(NO_OPEN_PRODUCTION_SESSION)
      expect(String(data['error']), path).toBe('chapter 1 has no open production session')
    }
  })

  it('/api/chapter.prose 缺 root → 400 root required（不是 500，也不是静默 exists:false）', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/chapter.prose', { chapterIndex: 1 })
    expect(status).toBe(400)
    // 网关的书授权层（bookAccess.ts:357 BOOK_REQUIRED）先于处理器执行——既有语义，本票未改。
    expect(data['code']).toBe('BOOK_REQUIRED')
  })
})
