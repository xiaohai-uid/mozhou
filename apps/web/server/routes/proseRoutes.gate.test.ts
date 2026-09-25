// @vitest-environment node
/**
 * 步 7 Continuity Gate 接线回归（chapter-pipeline-spec §1 表第 7 行 / S5）。
 *
 * 被测行为：/api/chapter.commit 必须把步 6 提取出的五族 delta 送进 runContinuityGate
 * （纯机械核检），冲突时以 Result 字段 hardConflicts[] 拒绝提交且正典零写入。
 *
 * 提取缝在本文件内被替换为夹具（真实提取缝的归一语义归 deltaExtractor.test.ts，
 * 真实空批路径归 proseRoutes.test.ts）——本文件只考路由对 Gate 判定的忠实执行。
 * 夹具行要么由真实 normalizeDelta 产出，要么手工构造后**用冻结 Schema 解析器自证
 * 结构合法**，否则「门禁报冲突」与「行形状本就坏」无法区分，测试就失去证伪力。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { newFactId, newKnowledgeStateId, newTimelineEventId, parseKnowledgeStateRow, parseTimelineEventRow } from '@mozhou/kernel'
import { proseChapterPath } from '@mozhou/data-plane'

/** 提取缝夹具：每个用例先设定本次「模型提取产物」，再打请求。 */
const fixture = vi.hoisted(() => ({ result: null as unknown }))

vi.mock('../analysis/deltaExtractor.js', () => ({
  extractChapterDelta: async () => {
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

/** 建书 + 落一章 draft 终稿，返回提交所需上下文（bookId 供夹具盖合法结构头）。 */
async function makeDraftChapter(): Promise<{ base: string; root: string; bookId: string }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-gate-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '门禁接线测试书', dir: root })
  expect(created.status).toBe(200)
  const saved = await post(base, '/api/chapter.prose.save', {
    root, chapterIndex: 1, body: '　　中平元年，黄巾起事。', expectedRevision: null,
  })
  expect(saved.status).toBe(200)
  return { base, root, bookId: String(created.data.bookId) }
}

function tracking(root: string, name: string): string {
  return join(root, '追踪', name)
}

/** 追踪流实际写入行（空文件=0 行；`''.split` 的假一行会让断言失真）。 */
function trackingLines(root: string, name: string): string[] {
  return readFileSync(tracking(root, name), 'utf8').trim().split('\n').filter((line) => line.length > 0)
}

/** 门禁拒绝/失败后必须成立的不变量：相位未翻转、四族零写入、无提交事件行。 */
function assertCanonUntouched(root: string): void {
  const prose = readFileSync(join(root, proseChapterPath(1)), 'utf8')
  expect(prose).toContain('phase: draft')
  expect(prose).not.toContain('commitId')
  expect(trackingLines(root, '事实.jsonl')).toHaveLength(0)
  expect(trackingLines(root, '认知.jsonl')).toHaveLength(0)
  expect(trackingLines(root, '时间线.jsonl')).toHaveLength(0)
  expect(readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')).not.toContain('"type":"ChapterCommitted"')
}

interface HardConflictShape {
  readonly factId: string
  readonly assertion: string
  readonly suggestion: string
}

function hardConflictsOf(data: Record<string, unknown>): HardConflictShape[] {
  return (data.hardConflicts ?? []) as HardConflictShape[]
}

/** 真实提取产物：一事实 + 其授权认知行 + 一合法时间线事件（序数 1）。 */
function cleanExtraction(bookId: string): DeltaExtractionResult {
  const result = normalizeDelta(
    {
      facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }],
      knowledge: [{ factIndex: 0, holder: 'protagonist', level: 'knows' }],
      timeline: [{ worldTimeLabel: '中平元年', summary: '黄巾起事', participants: ['char:liu-bei'], impactFactIndexes: [0] }],
    },
    { bookId, chapterIndex: 1, liveMaxOrder: 0 },
  )
  // 夹具自证：任何一行被归一丢弃都会让本文件的断言退化为「空批通过」
  expect(result.dropped).toEqual([])
  return result
}

describe('POST /api/chapter.commit · 步 7 Continuity Gate 接线', () => {
  it('门禁通过：delta 写正典，响应带 continuityGate.verdict=pass', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = cleanExtraction(bookId)

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })

    expect(status).toBe(200)
    expect(data.phase).toBe('committed')
    expect(data.continuityGate).toEqual({ verdict: 'pass' })
    // 数据流走到底：候选 delta 确实落进正典流（计数 + 行数双证，杜绝空批假通过）
    expect((data.deltaExtraction as { counts: Record<string, number> }).counts).toEqual({
      temporalFact: 1, knowledgeState: 1, relationshipState: 0, narrativePromise: 0, timelineEvent: 1,
    })
    expect(trackingLines(root, '事实.jsonl')).toHaveLength(1)
    expect(trackingLines(root, '认知.jsonl')).toHaveLength(1)
    expect(trackingLines(root, '时间线.jsonl')).toHaveLength(1)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toContain('phase: committed')
  })

  it('失败路径 · POV 秘密零泄漏：secret 事实无授权认知行 → 409 + hardConflicts[]，正典零写入', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    // 真实提取产物的真实形态：模型抽出了秘密，但没给任何披露行
    const extraction = normalizeDelta(
      { facts: [{ subject: 'char:liu-bei', predicate: 'secret.identity', value: '汉室宗亲', importance: 'critical', riskClass: 'high' }] },
      { bookId, chapterIndex: 1, liveMaxOrder: 0 },
    )
    expect(extraction.dropped).toEqual([])
    fixture.result = extraction
    const secretFactId = (extraction.appends['temporalFact'] as { id: string }[])[0]!.id

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })

    expect(status).toBe(409)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('CONTINUITY_HARD_CONFLICT')
    const conflicts = hardConflictsOf(data)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.factId).toBe(secretFactId)
    expect(conflicts[0]!.assertion).toContain('secret.identity')
    expect(conflicts[0]!.suggestion.length).toBeGreaterThan(0)
    // 作者要能看出「是这次提取的哪一批」才能回炉重提取
    expect((data.deltaExtraction as { counts: Record<string, number> }).counts['temporalFact']).toBe(1)
    assertCanonUntouched(root)
  })

  it('失败路径 · dependency 引用完整性：认知行引用悬空 factId → 409，正典零写入', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    // 行先自证结构合法（冻结 Schema 通过）——否则冲突可能只是形状坏行，测试就失去证伪力
    const now = new Date().toISOString()
    const danglingRow = {
      id: newKnowledgeStateId(),
      bookId,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      factId: newFactId(), // 格式合法但存量与批内都不存在 → 跨批悬空引用
      holder: 'protagonist',
      level: 'knows',
      knownSinceChapter: 1,
      provenance: { origin: 'ai', protectedUserContent: false },
    }
    parseKnowledgeStateRow(danglingRow)
    fixture.result = {
      appends: { knowledgeState: [danglingRow] },
      counts: { temporalFact: 0, knowledgeState: 1, relationshipState: 0, narrativePromise: 0, timelineEvent: 0 },
      dropped: [],
      extractor: 'llm',
    } satisfies DeltaExtractionResult

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })

    expect(status).toBe(409)
    expect(data.code).toBe('CONTINUITY_HARD_CONFLICT')
    const conflicts = hardConflictsOf(data)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.factId).toBe(danglingRow.id)
    expect(conflicts[0]!.assertion).toContain('resolves to no live or batch fact')
    assertCanonUntouched(root)
  })

  it('失败路径 · M2 时间线单调：批内序数逆序 → 409，正典零写入', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    const now = new Date().toISOString()
    const timelineRow = (worldTimeOrder: number): Record<string, unknown> => ({
      id: newTimelineEventId(),
      bookId,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      worldTimeLabel: '中平元年',
      worldTimeOrder,
      chapterIndex: 1,
      participants: ['char:liu-bei'],
      summary: '黄巾起事',
      impactFactIds: [],
      provenance: { origin: 'ai', protectedUserContent: false },
    })
    const outOfOrder = [timelineRow(5), timelineRow(3)]
    for (const row of outOfOrder) parseTimelineEventRow(row) // 结构合法，坏的是序数
    fixture.result = {
      appends: { timelineEvent: outOfOrder },
      counts: { temporalFact: 0, knowledgeState: 0, relationshipState: 0, narrativePromise: 0, timelineEvent: 2 },
      dropped: [],
      extractor: 'llm',
    } satisfies DeltaExtractionResult

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })

    expect(status).toBe(409)
    expect(data.code).toBe('CONTINUITY_HARD_CONFLICT')
    const conflicts = hardConflictsOf(data)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.assertion).toContain('worldTimeOrder')
    assertCanonUntouched(root)
  })

  it('不变量：门禁读不到存量（追踪流坏行）→ 显式 500，绝不静默跳过门禁放行', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = cleanExtraction(bookId)
    // 存量正典被外部弄坏：门禁无法建立「存量活跃 ∪ 本批」事实集
    writeFileSync(tracking(root, '事实.jsonl'), '{ not json\n')

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })

    expect(status).toBe(500)
    expect(data.ok).toBe(false)
    expect(String(data.error)).toContain('not valid JSON')
    // 宁败不脏：坏行原文保留（不自动清理），相位未翻转，零提交事件
    expect(readFileSync(tracking(root, '事实.jsonl'), 'utf8')).toBe('{ not json\n')
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toContain('phase: draft')
    expect(readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')).not.toContain('"type":"ChapterCommitted"')
  })
})
