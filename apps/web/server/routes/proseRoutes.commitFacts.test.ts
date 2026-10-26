// @vitest-environment node
/**
 * 提交链自动触发候选事实提取（#119 ①）· 提交链 HTTP 级集成验收。
 *
 * 断言外部行为：
 * - /api/chapter.commit 成功后自动触发一次提取（FactExtractionStarted/Finished
 *   平铺行落 .mozhou/events.jsonl = 任务中心 /api/tasks 同源数据面）；
 * - 提取绝不阻塞提交响应：流式缝注入 300ms 延迟，提交响应返回时提取仍在进行
 *   （status=Started），随后异步收口为 Finished；
 * - 候选自动落账本并可决断（与 #117/#118 决断面贯通）；
 * - 未配置 provider：提交后任务跳过（账本零行、零候选），/api/facts.status
 *   活探针如实报 no_provider_configured（绝不假成功）。
 *
 * 夹具边界：正典 delta 提取缝替换为计数夹具（同 proseRoutes.commitRevision.test.ts
 * 先例）；候选事实提取走真实共享缝（facts/autoExtract），仅 streamOpenAiChat 注入
 * 延迟流——夹具只证明控制流与账面行为，不冒充模型质量。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/** 提取流延迟注入：提交响应返回时提取仍在流式进行（不阻塞断言的确定性缝）。 */
const streamFixture = vi.hoisted(() => ({ delayMs: 0, calls: 0 }))

vi.mock('../llm/openaiStream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/openaiStream.js')>()
  return {
    ...actual,
    streamOpenAiChat: async function* () {
      streamFixture.calls += 1
      if (streamFixture.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, streamFixture.delayMs))
      }
      yield {
        delta:
          '{"events":[{"summary":"萧炎在坊市与萧宁当街冲突","evidence":"萧炎走进坊市，与萧宁当街冲突。"}],' +
          '"psychological_states":[{"character":"萧炎","before":"平静","after":"戒备","evidence":"两人不欢而散，各自记恨。"}]}',
      }
    },
  }
})

/** 正典 delta 提取缝夹具（同 commitRevision 先例）：只证明控制流，不冒充模型质量。 */
const deltaFixture = vi.hoisted(() => ({ result: null as import('../analysis/deltaExtractor.js').DeltaExtractionResult | null }))

vi.mock('../analysis/deltaExtractor.js', () => ({
  extractChapterDelta: () => {
    if (deltaFixture.result === null) throw new Error('test fixture not set: delta extractor result missing')
    return deltaFixture.result
  },
}))

import { apiMiddleware } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'

let normalizeDelta: typeof import('../analysis/deltaExtractor.js').normalizeDelta

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('../analysis/deltaExtractor.js')>('../analysis/deltaExtractor.js')
  normalizeDelta = actual.normalizeDelta
})

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
let dataRoot = ''
afterEach(() => {
  streamFixture.delayMs = 0
  streamFixture.calls = 0
  deltaFixture.result = null
  delete process.env['MOZHOU_API_KEY']
  for (const s of servers) s.close()
  servers = []
  for (const r of [...roots, dataRoot]) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = []
  dataRoot = ''
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

async function post(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown>; elapsedMs: number }> {
  const startedAt = Date.now()
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data, elapsedMs: Date.now() - startedAt }
}

function extractionRows(root: string): Array<Record<string, unknown>> {
  const path = join(root, '.mozhou', 'events.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => typeof row['type'] === 'string' && String(row['type']).startsWith('FactExtraction'))
}

/** 轮询直到提取进度行到终态（Finished）；超时抛错（测试自身失败，不冒充通过）。 */
async function waitFinished(base: string, root: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await post(base, '/api/facts.status', { root, chapterIndex: 1 })
    const extraction = status.data['extraction'] as Record<string, unknown> | null
    if (extraction !== null && extraction['type'] === 'FactExtractionFinished') return extraction
    if (Date.now() > deadline) throw new Error('extraction did not finish within ' + timeoutMs + 'ms: ' + JSON.stringify(status.data))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** 场景夹具：建书 + 保存一章草稿（同 commitRevision 先例）；provider 设置读面隔离到空数据根。 */
async function seedDraftChapter(): Promise<{ base: string; root: string; bookId: string; revision: number }> {
  dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-web-commit-facts-data-'))
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.setDataRoot(dataRoot)
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-commit-facts-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '章后回顾验收书', dir: root })
  expect(created.status, JSON.stringify(created.data)).toBe(200)
  const saved = await post(base, '/api/chapter.prose.save', {
    root,
    chapterIndex: 1,
    body: '萧炎走进坊市，与萧宁当街冲突。两人不欢而散，各自记恨。',
    expectedRevision: null,
  })
  expect(saved.status, JSON.stringify(saved.data)).toBe(200)
  const revision = saved.data.revision
  expect(typeof revision).toBe('number')
  return { base, root, bookId: String(created.data.bookId), revision: revision as number }
}

describe('提交链自动触发候选事实提取 (#119 ①)', () => {
  it('提交成功 → 自动提取异步完成：进度行进账本、候选可决断；提交响应不等提取', async () => {
    process.env['MOZHOU_API_KEY'] = 'sk-test-not-real'
    streamFixture.delayMs = 300
    const { base, root, bookId, revision } = await seedDraftChapter()
    deltaFixture.result = normalizeDelta(
      { facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }] },
      { bookId, chapterIndex: 1, liveMaxOrder: 0 },
    )

    const commit = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision })
    expect(commit.status, JSON.stringify(commit.data)).toBe(200)
    expect(commit.data['ok']).toBe(true)
    expect(commit.elapsedMs, '提交响应必须先于 300ms 流式提取返回').toBeLessThan(250)

    // 提取仍在进行（fire-and-forget 的直接证据）：Started 行已在、终态未到
    const running = await post(base, '/api/facts.status', { root, chapterIndex: 1 })
    const runningExtraction = running.data['extraction'] as Record<string, unknown> | null
    expect(runningExtraction?.['type']).toBe('FactExtractionStarted')
    expect(runningExtraction?.['trigger']).toBe('auto_commit')

    const finished = await waitFinished(base, root)
    expect(finished['inserted']).toBe(2)
    expect(finished['trigger']).toBe('auto_commit')
    const rows = extractionRows(root)
    expect(rows.map((row) => row['type'])).toEqual(['FactExtractionStarted', 'FactExtractionFinished'])
    expect(rows[0]!['runId']).toBe(rows[1]!['runId'])

    // 候选落账本（待决可见）并可决断贯通（与 #117/#118 决断面同一缝）
    const pending = await post(base, '/api/facts.candidates', { root, chapterIndex: 1 })
    const pendingList = pending.data['candidates'] as Array<Record<string, unknown>>
    expect(pendingList.length).toBe(2)
    const candidateId = String(pendingList[0]!['candidateId'])
    const decided = await post(base, '/api/facts.decide', {
      root,
      factCandidateId: candidateId,
      decision: 'confirmed',
      payload: { summary: '作者修订后的事件' },
    })
    expect(decided.status, JSON.stringify(decided.data)).toBe(200)
    expect(decided.data['replayed']).toBe(false)
    const after = await post(base, '/api/facts.candidates', { root, chapterIndex: 1 })
    expect((after.data['candidates'] as unknown[]).length).toBe(1)
  })

  it('未配置 provider：提交后任务跳过——账本零行、零候选，status 活探针如实报缺', async () => {
    const { base, root, revision } = await seedDraftChapter()
    deltaFixture.result = normalizeDelta(
      { facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }] },
      { bookId: 'book-x', chapterIndex: 1, liveMaxOrder: 0 },
    )

    const commit = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision })
    expect(commit.status, JSON.stringify(commit.data)).toBe(200)

    // 给潜在异步任务一点时间窗：确认真的一条进度行都没有（跳过 ≠ 假启动）
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(extractionRows(root), '未配置 provider 不得写任何提取进度行').toEqual([])

    const status = await post(base, '/api/facts.status', { root, chapterIndex: 1 })
    expect(status.data['extraction']).toBeNull()
    expect(status.data['pendingCount']).toBe(0)
    const provider = status.data['provider'] as Record<string, unknown>
    expect(provider['available']).toBe(false)
    expect(provider['reason']).toBe('no_provider_configured')
  })
})
