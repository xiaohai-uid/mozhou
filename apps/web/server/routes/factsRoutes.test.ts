// @vitest-environment node
/**
 * 章后事实账本 HTTP 面测试（#117 · 真实 HTTP 级，mock 提取确定性）。
 * 断言外部行为：extract → candidates → decide → history 全链路与两个必备负例。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBook, proseChapterPath, renderProseChapter } from '@mozhou/data-plane'
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

function post(base: string, path: string, payload: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async (res) => ({ status: res.status, data: (await res.json()) as Record<string, unknown> }))
}

describe('章后事实账本 HTTP 面 (#117)', () => {
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
    console.log('DEBUG pending:', JSON.stringify(pending).slice(0, 300))
    expect((pending.data['candidates'] as unknown[]).length).toBe(1)

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
    expect(records.length).toBe(1)
    expect(records[0]?.['status']).toBe('confirmed')
    const original = records[0]?.['payload'] as Record<string, unknown>
    const decidedPayload = records[0]?.['decidedPayload'] as Record<string, unknown>
    expect(decidedPayload['summary']).toBe('作者修订后的事件')
    expect(original['summary']).not.toBe('作者修订后的事件')
  })

  it('同章重复提取：旧 pending 作废（计数回传），对旧候选决断 409', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    const base = await listen()

    const first = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    const firstCandidates = first.data['candidates'] as Array<Record<string, unknown>>
    const oldId = String(firstCandidates[0]?.['candidateId'])

    const second = await post(base, '/api/facts.extract', { root: bookRoot, chapterIndex: 1 })
    expect(second.data['voided']).toBe(1)

    const pending = await post(base, '/api/facts.candidates', { root: bookRoot, chapterIndex: 1 })
    expect((pending.data['candidates'] as unknown[]).length).toBe(1)

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
