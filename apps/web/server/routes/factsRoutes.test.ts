// @vitest-environment node
/**
 * 候选事实账本 HTTP 面测试（#117 · 真实 HTTP 级，mock 提取确定性）。
 * 断言外部行为：extract → candidates → decide → history 全链路与两个必备负例；
 * hosted 主体隔离（跨主体 bookId / 候选 id 越权拒绝）单列验收组。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBook, insertFactCandidates, proseChapterPath, renderProseChapter } from '@mozhou/data-plane'
import { newUlid } from '@mozhou/kernel'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBillingStore } from '../billing/store.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'

vi.hoisted(() => {
  delete process.env['MOZHOU_DRAFT_PROVIDER']
  delete process.env['MOZHOU_OPS_TOKEN']
  for (const key of ['WECHAT_MCH_ID', 'WECHAT_APP_ID', 'WECHAT_APIV3_KEY', 'WECHAT_PLATFORM_CERT', 'ALIPAY_APP_ID', 'ALIPAY_PUBLIC_KEY']) {
    delete process.env[key]
  }
})

const PROSE_BODY = '萧炎走进坊市，与萧宁当街冲突。两人不欢而散，各自记恨。'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []
let bookRoot = ''

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  bookRoot = mkdtempSync(join(tmpdir(), 'mozhou-facts-route-'))
  tempDirs.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: '墨舟试炼' })
  writeFileSync(
    join(bookRoot, proseChapterPath(1)),
    renderProseChapter({ mozhouId: `prose_${newUlid()}`, revision: 1, chapterIndex: 1, phase: 'draft', body: PROSE_BODY }),
    'utf8',
  )
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  defaultBillingStore.close()
  defaultBookAccessManager.setHostedMode(false)
  delete process.env['MOZHOU_DRAFT_PROVIDER']
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

function post(base: string, path: string, payload: Record<string, unknown>, cookie?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie !== undefined ? { Cookie: cookie } : {}) },
    body: JSON.stringify(payload),
  }).then(async (res) => ({ status: res.status, data: (await res.json()) as Record<string, unknown> }))
}

describe('候选事实账本 HTTP 面 (#117)', () => {
  it('mock 提取 → 待决列表 → 幂等决断 → 历史全链路', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const extracted = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(extracted.status).toBe(200)
    expect(extracted.data['ok']).toBe(true)
    const candidates = extracted.data['candidates'] as Array<Record<string, unknown>>
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidates[0]?.['kind']).toBe('event')
    expect(String(candidates[0]?.['evidence']).length).toBeGreaterThan(0)
    const candidateId = String(candidates[0]?.['candidateId'])

    const pending = await post(base, '/api/facts.candidates', { root: bookRoot, chapterIndex: 1 })
    expect((pending.data['candidates'] as unknown[]).length).toBe(2)

    const decided = await post(base, '/api/facts.decide', {
      root: bookRoot,
      factCandidateId: candidateId,
      decision: 'confirmed',
      payload: { summary: '作者修订后的事件' },
    })
    expect(decided.status).toBe(200)
    expect(decided.data['replayed']).toBe(false)

    const replay = await post(base, '/api/facts.decide', { root: bookRoot, factCandidateId: candidateId, decision: 'confirmed' })
    expect(replay.data['replayed']).toBe(true)

    const history = await post(base, '/api/facts.history', { root: bookRoot, chapterIndex: 1 })
    const records = history.data['records'] as Array<Record<string, unknown>>
    expect(records.length).toBe(2)
    expect(records[0]?.['status']).toBe('confirmed')
    const original = records[0]?.['payload'] as Record<string, unknown>
    const decidedPayload = records[0]?.['decidedPayload'] as Record<string, unknown>
    expect(decidedPayload['summary']).toBe('作者修订后的事件')
    expect(original['summary']).not.toBe('作者修订后的事件')
  })

  it('mock 一次提取同时产出事件与人物心理状态两类候选，同列表可决断（#118 第二查）', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const extracted = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(extracted.status).toBe(200)
    const candidates = extracted.data['candidates'] as Array<Record<string, unknown>>
    expect(candidates.map((c) => c['kind'])).toEqual(expect.arrayContaining(['event', 'psychological_state']))

    // 候选载荷含人物标识与前后状态
    const psych = candidates.find((c) => c['kind'] === 'psychological_state') as Record<string, unknown>
    const psychPayload = psych['payload'] as Record<string, unknown>
    expect(String(psychPayload['character']).length).toBeGreaterThan(0)
    expect(String(psychPayload['before']).length).toBeGreaterThan(0)
    expect(String(psychPayload['after']).length).toBeGreaterThan(0)
    expect(String(psych['evidence']).length).toBeGreaterThan(0)

    // 同一待决列表出现两类候选
    const pending = await post(base, '/api/facts.candidates', { root: bookRoot, chapterIndex: 1 })
    const pendingList = pending.data['candidates'] as Array<Record<string, unknown>>
    expect(pendingList.map((c) => c['kind'])).toEqual(expect.arrayContaining(['event', 'psychological_state']))

    // 心理状态候选同决断面：编辑确认走结构化字段 → 幂等重放（含相反方向决断）
    const psychId = String(psych['candidateId'])
    const decided = await post(base, '/api/facts.decide', {
      root: bookRoot,
      factCandidateId: psychId,
      decision: 'confirmed',
      payload: { character: '萧炎', before: '平静', after: '起了戒备' },
    })
    expect(decided.status).toBe(200)
    expect(decided.data['replayed']).toBe(false)
    const decidedRecord = decided.data['record'] as Record<string, unknown>
    const decidedPayload = decidedRecord['decidedPayload'] as Record<string, unknown>
    expect(decidedPayload['after']).toBe('起了戒备')

    const replay = await post(base, '/api/facts.decide', { root: bookRoot, factCandidateId: psychId, decision: 'rejected' })
    expect(replay.data['replayed']).toBe(true)
    expect((replay.data['record'] as Record<string, unknown>)['status']).toBe('confirmed')

    // 历史同口径可查
    const history = await post(base, '/api/facts.history', { root: bookRoot, chapterIndex: 1 })
    const records = history.data['records'] as Array<Record<string, unknown>>
    expect(records.some((r) => r['kind'] === 'psychological_state' && r['status'] === 'confirmed')).toBe(true)
  })

  it('同章重复提取：旧 pending 作废（计数回传），对旧候选决断 409', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const first = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    const firstCandidates = first.data['candidates'] as Array<Record<string, unknown>>
    const oldId = String(firstCandidates[0]?.['candidateId'])

    const second = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(second.data['voided']).toBe(2) // 事件 + 心理状态两类候选一并作废

    const pending = await post(base, '/api/facts.candidates', { root: bookRoot, chapterIndex: 1 })
    expect((pending.data['candidates'] as unknown[]).length).toBe(2)

    const stale = await post(base, '/api/facts.decide', { root: bookRoot, factCandidateId: oldId, decision: 'confirmed' })
    expect(stale.status).toBe(409)
    expect(stale.data['code']).toBe('FACT_CANDIDATE_VOIDED')
  })

  it('未配置任何 provider：提取显式失败（PROVIDER_UNAVAILABLE），不产假候选', async () => {
    const base = await listen()

    const result = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(result.data['ok']).toBe(false)
    expect(result.data['code']).toBe('PROVIDER_UNAVAILABLE')

    const pending = await post(base, '/api/facts.candidates', { root: bookRoot, chapterIndex: 1 })
    expect((pending.data['candidates'] as unknown[]).length).toBe(0)
  })

  it('章节不存在：404 显式失败，不静默空提取', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const result = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 99 })
    expect(result.status).toBe(404)
    expect(result.data['ok']).toBe(false)
  })
})

describe('候选事实账本 hosted 主体隔离 (#117 验收)', () => {
  it('hosted：无认证 401；跨主体 bookId 与跨主体候选 id 越权拒绝；本主体全链路可用', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-facts-hosted-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBookAccessManager.setHostedMode(true)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user: userA } = await provider.signUp('a@test.com', 'passA123')
    const { user: userB } = await provider.signUp('b@test.com', 'passB123')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })
    const { cookie: cookieB } = defaultSessionManager.createSession({ userId: userB.id, email: userB.email })

    const bookA = defaultBookAccessManager.createHostedBook(userA.id, 'A的书')
    const bookB = defaultBookAccessManager.createHostedBook(userB.id, 'B的书')
    writeFileSync(
      join(bookA.root, proseChapterPath(1)),
      renderProseChapter({ mozhouId: `prose_${newUlid()}`, revision: 1, chapterIndex: 1, phase: 'draft', body: PROSE_BODY }),
      'utf8',
    )

    // 无认证：hosted 模式在路由层认证缝直接 401
    const anonymous = await post(base, '/api/facts.extract', { bookId: bookA.bookId, chapterIndex: 1 })
    expect(anonymous.status).toBe(401)
    expect(anonymous.data['code']).toBe('UNAUTHORIZED')

    // 跨主体 bookId：A 的凭据访问 B 的书 → 四路由全部 404 BOOK_NOT_FOUND
    for (const path of ['/api/facts.extract', '/api/facts.candidates', '/api/facts.decide', '/api/facts.history']) {
      const res = await post(
        base,
        path,
        { bookId: bookB.bookId, chapterIndex: 1, factCandidateId: 'fc_foreign', decision: 'confirmed' },
        cookieA,
      )
      expect(res.status, `${path} must reject cross-subject access`).toBe(404)
      expect(res.data['code']).toBe('BOOK_NOT_FOUND')
    }

    // 跨主体对象级：A 用自己的 bookId 却携带 B 账本内的候选 id → 404 FACT_CANDIDATE_NOT_FOUND
    const { inserted: bCandidates } = insertFactCandidates(bookB.root, 1, [
      {
        kind: 'event',
        payload: { summary: 'B 的私密事件' },
        evidence: 'B 的正文摘句',
        chapterIndex: 1,
        proseHash: 'e'.repeat(64),
        extractionRunId: 'fx_b_secret',
      },
    ])
    const crossObject = await post(
      base,
      '/api/facts.decide',
      { bookId: bookA.bookId, factCandidateId: bCandidates[0]!.candidateId, decision: 'confirmed' },
      cookieA,
    )
    expect(crossObject.status).toBe(404)
    expect(crossObject.data['code']).toBe('FACT_CANDIDATE_NOT_FOUND')

    // 本主体：A 对自己的书全链路可用（隔离不是全拒）
    const extracted = await post(base, '/api/facts.extract', { bookId: bookA.bookId, chapterIndex: 1 }, cookieA)
    expect(extracted.status).toBe(200)
    expect(extracted.data['ok']).toBe(true)
    const aCandidates = extracted.data['candidates'] as Array<Record<string, unknown>>
    const candidateId = String(aCandidates[0]?.['candidateId'])

    const pending = await post(base, '/api/facts.candidates', { bookId: bookA.bookId, chapterIndex: 1 }, cookieA)
    expect((pending.data['candidates'] as unknown[]).length).toBe(2)

    const decided = await post(
      base,
      '/api/facts.decide',
      { bookId: bookA.bookId, factCandidateId: candidateId, decision: 'confirmed' },
      cookieA,
    )
    expect(decided.status).toBe(200)
    expect(decided.data['replayed']).toBe(false)

    const history = await post(base, '/api/facts.history', { bookId: bookA.bookId, chapterIndex: 1 }, cookieA)
    expect(history.status).toBe(200)
    expect((history.data['records'] as unknown[]).length).toBe(2)

    // B 对自己的书只看到自己的账本，与 A 互不串
    const bPending = await post(base, '/api/facts.candidates', { bookId: bookB.bookId, chapterIndex: 1 }, cookieB)
    expect(bPending.status).toBe(200)
    const bPendingList = bPending.data['candidates'] as Array<Record<string, unknown>>
    expect(bPendingList.length).toBe(1)
    expect(bPendingList[0]?.['extractionRunId']).toBe('fx_b_secret')
    const bHistory = await post(base, '/api/facts.history', { bookId: bookB.bookId }, cookieB)
    expect(bHistory.status).toBe(200)
    expect((bHistory.data['records'] as unknown[]).length).toBe(1)
  })
})

describe('章后提取状态面 (#119)', () => {
  it('mock 提取后 status：Finished 进度行 + 待决计数 + provider 可用', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const extracted = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(extracted.status, JSON.stringify(extracted.data)).toBe(200)
    const runId = String(extracted.data['runId'])

    const status = await post(base, '/api/facts.status', { root: bookRoot, chapterIndex: 1 })
    expect(status.status, JSON.stringify(status.data)).toBe(200)
    expect(status.data['ok']).toBe(true)
    const extraction = status.data['extraction'] as Record<string, unknown>
    expect(extraction['type']).toBe('FactExtractionFinished')
    expect(extraction['runId']).toBe(runId)
    expect(extraction['inserted']).toBe(2)
    expect(status.data['pendingCount']).toBe(2)
    expect((status.data['provider'] as Record<string, unknown>)['available']).toBe(true)
  })

  it('未配置任何 provider：status 显示活探针失败；手动提取失败原因持久保留', async () => {
    const base = await listen()

    const extracted = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(extracted.data['ok']).toBe(false)
    expect(extracted.data['code']).toBe('PROVIDER_UNAVAILABLE')

    // 手动提取的失败落 Failed 行（trigger=manual_retry，规格 User Story 13 保留失败原因）
    const status = await post(base, '/api/facts.status', { root: bookRoot, chapterIndex: 1 })
    expect(status.status, JSON.stringify(status.data)).toBe(200)
    const extraction = status.data['extraction'] as Record<string, unknown>
    expect(extraction['type']).toBe('FactExtractionFailed')
    expect(String(extraction['reason'])).toContain('PROVIDER_UNAVAILABLE')
    expect(extraction['trigger']).toBe('manual_retry')
    expect(status.data['pendingCount']).toBe(0)
    const provider = status.data['provider'] as Record<string, unknown>
    expect(provider['available']).toBe(false)
    expect(provider['reason']).toBe('no_provider_configured')
  })

  it('chapterIndex 非法：400；chapter 不存在：status 仍 200（零进度零候选）', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const bad = await post(base, '/api/facts.status', { root: bookRoot, chapterIndex: 0 })
    expect(bad.status).toBe(400)

    const missing = await post(base, '/api/facts.status', { root: bookRoot, chapterIndex: 9 })
    expect(missing.status, JSON.stringify(missing.data)).toBe(200)
    expect(missing.data['extraction']).toBeNull()
    expect(missing.data['pendingCount']).toBe(0)
  })
})
