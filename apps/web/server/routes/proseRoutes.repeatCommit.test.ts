// @vitest-environment node
/**
 * 工单 02 缺陷 A 验收（.scratch/mozhou-deepening-20260928/issues/02-adopt-open-heads-latent-defect.md）：
 * 同 revision 重复提交必须在 0 消耗处拒绝——合法相位检查前移到 extractChapterDelta
 * （真实 LLM 调用缝）之前。
 *
 * 缺陷（修复前）的执行顺序：首次提交成功 ⇒ 提案 markConsumed（openProposalForTask 对
 * consumed 返回 null，proposals.ts:83-89）⇒ 第二次提交重跑提取（一次真实模型调用）⇒
 * 再落一份同键提案（prp_*.json + 第二个 CanonProposalCreated 头）⇒ 最后才在
 * commitChapter 撞相位 409。作者双击提交，Key 白烧一次。
 *
 * 确定性与夹具边界：提取缝替换为计数夹具（真实归一语义归 deltaExtractor.test.ts，
 * 夹具行由真实 normalizeDelta 产出）——夹具只证明控制流（第二次提交 0 次提取调用、
 * 无第二次提案写入），不冒充真实模型质量或费用验证。纯黑盒真实 HTTP + 临时书目录
 * （隔离数据，不碰真实书稿）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RUNTIME_PROPOSALS_DIR, proseChapterPath } from '@mozhou/data-plane'

/** 提取缝夹具：calls 用于断言第二次提交零提取调用（0 消耗拒绝）。 */
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

/** 真实提取产物：单条 low 事实（入场即确认 ⇒ 首次提交一击走完全程、无待决挂起）。 */
function lowExtraction(bookId: string): DeltaExtractionResult {
  const result = normalizeDelta(
    { facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }] },
    { bookId, chapterIndex: 1, liveMaxOrder: 0 },
  )
  expect(result.dropped).toEqual([])
  return result
}

describe('POST /api/chapter.commit · 同 revision 重复提交（工单 02 缺陷 A）', () => {
  it('首次提交成功后重复提交：409、0 次提取调用、无第二次提案写入', async () => {
    const base = await listen()
    const root = mkdtempSync(join(tmpdir(), 'mozhou-web-repeat-commit-'))
    roots.push(root)
    const created = await post(base, '/api/book', { title: '重复提交验收书', dir: root })
    expect(created.status).toBe(200)
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　中平元年，黄巾起事。', expectedRevision: null,
    })
    expect(saved.status).toBe(200)
    // 工单05 Contract Delta：提交必须携带作者所读 revision（此处即保存响应回带的值）。
    const expectedRevision = Number(saved.data.revision)

    fixture.result = lowExtraction(String(created.data.bookId))

    // 首次提交：low 全确认 ⇒ 一击走完（200 committed），提案 consumed
    const first = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision })
    expect(first.status, JSON.stringify(first.data)).toBe(200)
    expect(first.data.phase).toBe('committed')
    expect(fixture.calls).toBe(1)
    expect(proposalFiles(root)).toHaveLength(1)
    const proseAfterFirst = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const eventsAfterFirst = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    expect(eventsAfterFirst).toContain('"type":"CanonProposalCreated"')

    // 重复提交（同 revision，双击提交的真实形态）：必须在 0 消耗处 409
    const second = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision })

    expect(second.status, JSON.stringify(second.data)).toBe(409)
    expect(second.data.ok).toBe(false)
    expect(second.data.code).toBe('CHAPTER_ALREADY_COMMITTED')
    // 0 消耗：提取（真实路径 = LLM 调用）一次都不多跑
    expect(fixture.calls, '第二次提交不得重跑提取').toBe(1)
    // 无第二次提案写入：prp_*.json 与 CanonProposalCreated 头都不再落第二份
    expect(proposalFiles(root), '不得再落第二份提案记录').toHaveLength(1)
    expect(readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8'), '账本零追加（无第二个同键提案头）')
      .toBe(eventsAfterFirst)
    // 盘面零变更：正文相位/revision/commitId 与首次提交后一致
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(proseAfterFirst)
  })
})
