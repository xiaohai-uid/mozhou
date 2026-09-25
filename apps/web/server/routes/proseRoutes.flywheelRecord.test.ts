// @vitest-environment node
/**
 * 步 10 Flywheel Record 接线回归（chapter-pipeline-spec §1 表第 10 行 / S12）。
 *
 * 被测行为：/api/chapter.commit 在 commitChapter 落定后以同一 taskRef 落
 * FlywheelRecorded 收尾事件并写 usage 投影表 .mozhou/usage.jsonl；空计量也必须
 * 落账（窗口锚 = 每完成窗口恰一条）；记账失败降级 state_degraded 但**不阻断正文**；
 * usage 形状非法在动盘之前 400 拒绝（零写入）；afterRecord 窗口闭合钩子失败不阻断
 * 已落账事件，但错误必须回给作者（不静默）。
 *
 * 提取缝在本文件内被替换为夹具（真实提取语义归 deltaExtractor.test.ts）：本文件只考
 * 路由的收尾记账搬运与失败面。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { STYLE_PROFILE_PATH, proseChapterPath, readProseChapter } from '@mozhou/data-plane'
import { USAGE_PROJECTION_PATH, readUsageProjection } from '@mozhou/pipeline'

/** 提取缝夹具：每个用例先设定本次「模型提取产物」，再打请求。 */
const fixture = vi.hoisted(() => ({ result: null as DeltaExtractionResult | null }))

vi.mock('../analysis/deltaExtractor.js', () => ({
  // 同步夹具：路由侧 `await` 非 Promise 值同样成立（提取缝是显式注入点，形状由调用方约定）
  extractChapterDelta: () => {
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

/** 无候选提取产物（走「无 appends 直提」分支；收尾记账两个分支都必须走到）。 */
function emptyExtraction(): DeltaExtractionResult {
  return { appends: {}, counts: {}, dropped: [], extractor: 'none', reason: 'fixture: 无候选' }
}

/** 真实提取产物：单条 low 事实（路由即自动确认、无待决，走「确认集提交」分支）。 */
function lowFactExtraction(bookId: string): DeltaExtractionResult {
  const result = normalizeDelta(
    {
      facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }],
    },
    { bookId, chapterIndex: 1, liveMaxOrder: 0 },
  )
  expect(result.dropped).toEqual([])
  return result
}

async function makeDraftChapter(): Promise<{ base: string; root: string; bookId: string; taskRef: string }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-flywheel-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '飞轮记账接线测试书', dir: root })
  expect(created.status).toBe(200)
  const saved = await post(base, '/api/chapter.prose.save', {
    root, chapterIndex: 1, body: '　　中平元年，黄巾起事。', expectedRevision: null,
  })
  expect(saved.status).toBe(200)
  // taskRef 与路由同源（步 8 提案绑定 / 步 10 窗口锚共用）：revision 从盘上读，不硬编码
  const revision = readProseChapter(root, proseChapterPath(1)).revision
  return { base, root, bookId: String(created.data.bookId), taskRef: 'web_commit_ch1_rev' + revision }
}

/** 账本行按文件顺序（append 序即权威序）：平铺行取 type，任务事件行取 event.type。 */
function ledgerRowTypes(root: string): string[] {
  return readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => {
      const wrapped = row['event']
      if (typeof wrapped === 'object' && wrapped !== null) return String((wrapped as Record<string, unknown>)['type'])
      return String(row['type'])
    })
}

/** 任务事件行（PublishBus 包装行）中的 FlywheelRecorded 载荷序列。 */
function flywheelPayloads(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => row['event'])
    .filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null)
    .filter((event) => event['type'] === 'FlywheelRecorded')
    .map((event) => (event['payload'] ?? {}) as Record<string, unknown>)
}

function flywheelRecordView(data: Record<string, unknown>): Record<string, unknown> {
  const view = data['flywheelRecord']
  expect(view, JSON.stringify(data)).toBeTypeOf('object')
  return view as Record<string, unknown>
}

describe('POST /api/chapter.commit · 步 10 Flywheel Record 接线', () => {
  it('带 usage 事实：投影表落同步行（机械字段盖章）且收尾事件 outcome=succeeded', async () => {
    const { base, root, taskRef } = await makeDraftChapter()
    fixture.result = emptyExtraction()

    const { status, data } = await post(base, '/api/chapter.commit', {
      root, chapterIndex: 1, summary: '定稿',
      usage: [
        { kind: 'usage', provider: 'deepseek', model: 'v3', inputTokens: 1200, outputTokens: 300 },
        { kind: 'cost', costMicros: 42 },
      ],
    })
    expect(status, JSON.stringify(data)).toBe(200)

    // 投影表落盘：.mozhou/usage.jsonl（此前零调用方 ⇒ 从不生成）
    expect(existsSync(join(root, USAGE_PROJECTION_PATH))).toBe(true)
    const rows = readUsageProjection(root)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      taskRef, chapterIndex: 1, commitId: data['commitId'], kind: 'usage', derived: false,
      provider: 'deepseek', model: 'v3', inputTokens: 1200, outputTokens: 300,
    })
    expect(rows[1]).toMatchObject({ taskRef, commitId: data['commitId'], kind: 'cost', derived: false, costMicros: 42 })
    expect(rows.every((row) => row.entryId.startsWith('usg_'))).toBe(true)

    // 收尾事件落账：commitId/recordedCount 进 payload
    const payloads = flywheelPayloads(root)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ outcome: 'succeeded', commitId: data['commitId'], recordedCount: 2 })
    expect(payloads[0]).not.toHaveProperty('errorDetail')

    expect(flywheelRecordView(data)).toEqual({
      status: 'succeeded', recordedCount: 2, errorDetail: null, afterRecordError: null,
    })
  })

  it('确认集提交分支（带 appends）同样落窗口锚：两个 commitChapter 调用点不得漏记账', async () => {
    const { base, root, bookId, taskRef } = await makeDraftChapter()
    fixture.result = lowFactExtraction(bookId)

    const { status, data } = await post(base, '/api/chapter.commit', {
      root, chapterIndex: 1, summary: '定稿',
      usage: [{ kind: 'usage', provider: 'deepseek', model: 'v3', inputTokens: 10 }],
    })
    expect(status, JSON.stringify(data)).toBe(200)
    // 确认集确已写正典（非空批）——本分支不是「无候选直提」
    expect(data['canonProposal']).not.toBeNull()

    expect(readUsageProjection(root)).toHaveLength(1)
    const payloads = flywheelPayloads(root)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ outcome: 'succeeded', commitId: data['commitId'], recordedCount: 1 })
    expect(readUsageProjection(root)[0]).toMatchObject({ taskRef, chapterIndex: 1, commitId: data['commitId'] })
  })

  it('空计量也落窗口锚：recordedCount=0、投影表零行（无计量不造数）', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(status, JSON.stringify(data)).toBe(200)

    // 空 usage 数组合法（S12：无计量也要落收尾事件）——投影表不因此建空文件
    expect(existsSync(join(root, USAGE_PROJECTION_PATH))).toBe(false)
    expect(readUsageProjection(root)).toEqual([])

    const payloads = flywheelPayloads(root)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ outcome: 'succeeded', recordedCount: 0 })
    expect(flywheelRecordView(data)).toMatchObject({ status: 'succeeded', recordedCount: 0, errorDetail: null })
  })

  it('不变量：每完成窗口恰一条 FlywheelRecorded，且顺排在本窗口 ChapterCommitted 之后', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()

    const first = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(first.status).toBe(200)

    const types = ledgerRowTypes(root)
    expect(types.filter((type) => type === 'FlywheelRecorded')).toHaveLength(1)
    expect(types.indexOf('ChapterCommitted')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('ChapterCommitted')).toBeLessThan(types.indexOf('FlywheelRecorded'))

    // 重复提交（已 committed）被拒 ⇒ 不得再落一条窗口锚
    const second = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(second.status).toBe(409)
    expect(second.data['code']).toBe('CHAPTER_ALREADY_COMMITTED')
    expect(ledgerRowTypes(root).filter((type) => type === 'FlywheelRecorded')).toHaveLength(1)
  })

  it('记账失败不阻断正文（S12）：投影写故障 ⇒ 200 定稿 + state_degraded 如实上报', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()
    // 故障注入：把投影表路径占成目录 ⇒ appendUsageRows 的 appendFileSync 必抛（EISDIR）
    mkdirSync(join(root, USAGE_PROJECTION_PATH), { recursive: true })

    const { status, data } = await post(base, '/api/chapter.commit', {
      root, chapterIndex: 1, summary: '定稿',
      usage: [{ kind: 'usage', inputTokens: 1 }],
    })
    expect(status, JSON.stringify(data)).toBe(200)

    // 正文与正典照常落定（记账是派生面，失败不回退提交）
    expect(data['phase']).toBe('committed')
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed')
    expect(ledgerRowTypes(root)).toContain('ChapterCommitted')

    // 收尾事件照常落账且携带降级面（不阻断、不静默）
    const payloads = flywheelPayloads(root)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ outcome: 'state_degraded', commitId: data['commitId'], recordedCount: 0 })
    expect(String(payloads[0]!['errorDetail'])).toContain('EISDIR')

    const view = flywheelRecordView(data)
    expect(view['status']).toBe('state_degraded')
    expect(view['recordedCount']).toBe(0)
    expect(String(view['errorDetail'])).toContain('EISDIR')
  })

  it.each([
    ['非数组', 'nope'],
    ['缺 kind', [{ provider: 'deepseek' }]],
    ['未知 kind', [{ kind: 'token' }]],
    ['未知键', [{ kind: 'usage', secret: 'x' }]],
    ['负数计数', [{ kind: 'usage', inputTokens: -1 }]],
    ['非整数计数', [{ kind: 'usage', outputTokens: 1.5 }]],
    ['非字符串 provider', [{ kind: 'cost', provider: 5 }]],
    ['空字符串 model', [{ kind: 'usage', model: '' }]],
  ])('usage 形状非法（%s）：400 且零写入', async (_label, badUsage) => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()

    const { status, data } = await post(base, '/api/chapter.commit', {
      root, chapterIndex: 1, summary: '定稿', usage: badUsage,
    })
    expect(status, JSON.stringify(data)).toBe(400)
    expect(String(data['error'])).toContain('usage must be an array')

    // 宁败不脏：相位未翻转、无提交行、无窗口锚、投影表未建
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
    expect(ledgerRowTypes(root)).not.toContain('ChapterCommitted')
    expect(flywheelPayloads(root)).toHaveLength(0)
    expect(existsSync(join(root, USAGE_PROJECTION_PATH))).toBe(false)
  })

  it('afterRecord 钩子失败不阻断已落账事件，但错误必须可见（不静默吞掉学习器故障）', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()
    // 故障注入：删掉文风.md ⇒ StyleLearner 读画像抛 CanonStructureError（宁败不脏）
    rmSync(join(root, STYLE_PROFILE_PATH))

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(status, JSON.stringify(data)).toBe(200)

    // 钩子是派生面：投影面照常 succeeded，事件照常落账（S12 同款降级）
    const payloads = flywheelPayloads(root)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ outcome: 'succeeded', recordedCount: 0 })

    const view = flywheelRecordView(data)
    expect(view['status']).toBe('succeeded')
    expect(String(view['afterRecordError'])).toContain('文风.md')
  })
})
