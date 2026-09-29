// @vitest-environment node
/**
 * 工单 05 Contract Delta 验收（.scratch/mozhou-deepening-20260928/issues/05-commit-idempotency-contract-delta.md）：
 * POST /api/chapter.commit 携带 expectedRevision（作者实际读取的章版本，形状照搬
 * /api/chapter.prose.save 冻结契约）——匹配才继续；过期 ⇒ 409 PROSE_REVISION_CONFLICT
 * 且在提取缝（真实 LLM 调用）之前拒绝：模型调用增量 0，正文/正典/账本零写入。
 *
 * 覆盖（工单验收清单）：首次请求 / 重复请求 / 过期 revision / 缺失与非法字段 /
 * 双窗口 / 成功响应丢失后重试。不同输入不视为幂等成功：重复提交落在相位 409
 * （CHAPTER_ALREADY_COMMITTED，工单 02 缺陷 A 语义不变），不回 200。
 *
 * 确定性与夹具边界：提取缝替换为计数夹具（真实归一语义归 deltaExtractor.test.ts，
 * 夹具行由真实 normalizeDelta 产出）——夹具只证明控制流（过期提交 0 次提取调用、
 * 零写入），不冒充真实模型质量或费用验证。纯黑盒真实 HTTP + 临时书目录（隔离数据，
 * 不碰真实书稿）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RUNTIME_PROPOSALS_DIR, proseChapterPath } from '@mozhou/data-plane'

/** 提取缝夹具：calls 用于断言过期/缺失提交零提取调用（0 消耗拒绝）。 */
const fixture = vi.hoisted(() => ({ result: null as DeltaExtractionResult | null, calls: 0 }))

vi.mock('../analysis/deltaExtractor.js', () => ({
  extractChapterDelta: () => {
    fixture.calls += 1
    if (fixture.result === null) throw new Error('test fixture not set: extractor result missing')
    return fixture.result
  },
}))

import { apiMiddleware } from '../api.js'
import type { DeltaExtractionResult } from '../analysis/deltaExtractor.js'

let normalizeDelta: typeof import('../analysis/deltaExtractor.js').normalizeDelta

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('../analysis/deltaExtractor.js')>('../analysis/deltaExtractor.js')
  normalizeDelta = actual.normalizeDelta
})

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  fixture.result = null
  fixture.calls = 0
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = []
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf') })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

async function post(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data }
}

function proposalFiles(root: string): string[] {
  const dir = join(root, RUNTIME_PROPOSALS_DIR)
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : []
}

function eventsDisk(root: string): string {
  return readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
}

/** 真实提取产物：单条 low 事实（入场即确认 ⇒ 提交一击走完全程、无待决挂起）。 */
function lowExtraction(bookId: string): DeltaExtractionResult {
  const result = normalizeDelta(
    { facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }] },
    { bookId, chapterIndex: 1, liveMaxOrder: 0 },
  )
  expect(result.dropped).toEqual([])
  return result
}

/** 场景夹具：建书 + 保存一章草稿，返回 base/root/bookId 与保存后 revision。 */
async function seedDraftChapter(): Promise<{ base: string; root: string; bookId: string; revision: number }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-commit-revision-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '提交幂等验收书', dir: root })
  expect(created.status, JSON.stringify(created.data)).toBe(200)
  const saved = await post(base, '/api/chapter.prose.save', {
    root, chapterIndex: 1, body: '　　中平元年，黄巾起事。', expectedRevision: null,
  })
  expect(saved.status, JSON.stringify(saved.data)).toBe(200)
  const revision = saved.data.revision
  expect(typeof revision).toBe('number')
  return { base, root, bookId: String(created.data.bookId), revision: revision as number }
}

describe('POST /api/chapter.commit · expectedRevision 提交幂等契约（工单05）', () => {
  it('首次请求：expectedRevision 与盘上一致 ⇒ 200 committed（契约照常走完）', async () => {
    const { base, root, bookId, revision } = await seedDraftChapter()
    fixture.result = lowExtraction(bookId)

    const first = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision })
    expect(first.status, JSON.stringify(first.data)).toBe(200)
    expect(first.data.ok).toBe(true)
    expect(first.data.phase).toBe('committed')
    expect(fixture.calls).toBe(1)
  })

  it('重复请求（成功响应丢失后重试同参数）：409 CHAPTER_ALREADY_COMMITTED，不是幂等 200', async () => {
    const { base, root, bookId, revision } = await seedDraftChapter()
    fixture.result = lowExtraction(bookId)

    const first = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision })
    expect(first.status).toBe(200)
    const proseAfterFirst = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const eventsAfterFirst = eventsDisk(root)

    // 成功响应丢失：客户端只知「可能成功」，携同一 expectedRevision 重试——
    // 相位守卫在 revision 比对之前拒绝，重复提交不伪装成第二次成功。
    const retry = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision })
    expect(retry.status, JSON.stringify(retry.data)).toBe(409)
    expect(retry.data.code).toBe('CHAPTER_ALREADY_COMMITTED')
    expect(fixture.calls, '重试不得重跑提取').toBe(1)
    expect(proposalFiles(root), '不得再落第二份提案').toHaveLength(1)
    expect(eventsDisk(root), '账本零追加').toBe(eventsAfterFirst)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(proseAfterFirst)
  })

  it('过期 revision（draft 态失配）：409 PROSE_REVISION_CONFLICT、0 次提取、正文/正典/账本零写入', async () => {
    const { base, root, bookId, revision } = await seedDraftChapter()
    fixture.result = lowExtraction(bookId)
    const proseBefore = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const eventsBefore = eventsDisk(root)

    const stale = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision - 1 })
    expect(stale.status, JSON.stringify(stale.data)).toBe(409)
    expect(stale.data.ok).toBe(false)
    expect(stale.data.code).toBe('PROSE_REVISION_CONFLICT')
    expect(stale.data.expectedRevision).toBe(revision - 1)
    expect(stale.data.currentRevision).toBe(revision)
    // 0 消耗：过期提交在提取缝（真实路径 = LLM 调用）之前拒绝
    expect(fixture.calls, '过期提交不得触发提取').toBe(0)
    // 零写入：正文相位/revision 原样、无提案、账本零追加
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(proseBefore)
    expect(proposalFiles(root)).toHaveLength(0)
    expect(eventsDisk(root)).toBe(eventsBefore)
  })

  it('双窗口：A 携旧 revision 提交被拒（0 提取），重读对账后携新 revision 合法提交成功', async () => {
    const { base, root, bookId, revision } = await seedDraftChapter()
    fixture.result = lowExtraction(bookId)

    // 窗口 B 保存（revision + 1）——窗口 A 仍持旧 revision
    const savedB = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　中平元年，黄巾起事。关羽提刀入帐。', expectedRevision: revision,
    })
    expect(savedB.status).toBe(200)
    const currentRevision = savedB.data.revision as number
    expect(currentRevision).toBe(revision + 1)

    // 窗口 A 提交旧 revision：409，0 提取
    const stale = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision })
    expect(stale.status, JSON.stringify(stale.data)).toBe(409)
    expect(stale.data.code).toBe('PROSE_REVISION_CONFLICT')
    expect(stale.data.currentRevision).toBe(currentRevision)
    expect(fixture.calls, 'A 的过期提交不得触发提取').toBe(0)

    // A 重读对账（读回服务端现值）后携新 revision 重发：这是新输入的合法提交，
    // 不是同一请求的幂等回放——照常走完提取与提交。
    const reread = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(reread.status).toBe(200)
    expect(reread.data.revision).toBe(currentRevision)
    const recommitted = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: currentRevision })
    expect(recommitted.status, JSON.stringify(recommitted.data)).toBe(200)
    expect(recommitted.data.phase).toBe('committed')
    expect(fixture.calls).toBe(1)
  })

  it('缺失/非法 expectedRevision：400 在动盘之前拒绝，盘面零变更', async () => {
    const { base, root, bookId, revision } = await seedDraftChapter()
    fixture.result = lowExtraction(bookId)
    const proseBefore = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const eventsBefore = eventsDisk(root)

    for (const [label, expectedRevision] of [
      ['缺失', undefined],
      ['null（commit 无新建语义）', null],
      ['字符串', String(revision)],
      ['小数', revision + 0.5],
      ['负数', -1],
    ] as const) {
      const bad = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision })
      expect(bad.status, label + ' ' + JSON.stringify(bad.data)).toBe(400)
      expect(bad.data.ok).toBe(false)
      expect(String(bad.data.error)).toContain('expectedRevision')
    }
    // 形状非法在动盘之前拒绝：0 提取、无提案、账本与正文原样
    expect(fixture.calls, '非法请求不得触发提取').toBe(0)
    expect(proposalFiles(root)).toHaveLength(0)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(proseBefore)
    expect(eventsDisk(root)).toBe(eventsBefore)
  })
})
