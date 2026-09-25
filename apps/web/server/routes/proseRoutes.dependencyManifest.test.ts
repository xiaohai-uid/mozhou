// @vitest-environment node
/**
 * D06 依赖钉版消费回归（change-impact-engine-spec §2 D06 / ADR-0003 §2.1）。
 *
 * 被测行为：/api/chapter.commit 把编译步暂存于 .mozhou/dependency-manifests/ 的钉版
 * 原样钉进 ChapterCommitted 事件行——两条提交分支（无候选直提 / 确认集提交）都必须带；
 * 无暂存 = 不带清单（诚实无依赖，不造空清单假数据）；暂存形状非法 = 显式 500 且正典零写入。
 *
 * 提取缝在本文件内被替换为夹具（真实提取语义归 deltaExtractor.test.ts）：本文件只考
 * 路由对钉版的搬运与失败面，行夹具由真实 normalizeDelta 产出并自证 dropped 为空。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { findReaders, proseChapterPath, readChapterDependencyPins } from '@mozhou/data-plane'
import { newFactId } from '@mozhou/kernel'
import {
  PENDING_DEPENDENCY_MANIFEST_DIR,
  pendingDependencyManifestPath,
  persistPendingDependencyManifest,
} from '@mozhou/pipeline'

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

async function makeDraftChapter(): Promise<{ base: string; root: string; bookId: string }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-dep-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '钉版接线测试书', dir: root })
  expect(created.status).toBe(200)
  const saved = await post(base, '/api/chapter.prose.save', {
    root, chapterIndex: 1, body: '　　中平元年，黄巾起事。', expectedRevision: null,
  })
  expect(saved.status).toBe(200)
  return { base, root, bookId: String(created.data.bookId) }
}

/** 无候选提取产物（走「无 appends 直提」分支）。 */
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

/** ChapterCommitted 事件行（钉版落账的盘面证据）。 */
function committedRows(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => row['type'] === 'ChapterCommitted')
}

describe('POST /api/chapter.commit · D06 依赖钉版搬运', () => {
  it('无候选直提分支：暂存钉版钉进事件行，并成为 findReaders 的读者来源', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()
    const factId = newFactId()
    persistPendingDependencyManifest(root, 1, { entries: [{ kind: 'temporalFact', id: factId, revision: 3 }] })

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(status, JSON.stringify(data)).toBe(200)

    const rows = committedRows(root)
    expect(rows).toHaveLength(1)
    expect(rows[0]!['dependencyManifest']).toEqual({ entries: [{ kind: 'temporalFact', id: factId, revision: 3 }] })
    // 事件行是 pins 真源：圈定链路（readChapterDependencyPins → findReaders）当场可查
    expect(findReaders(readChapterDependencyPins(root), { kind: 'temporalFact', id: factId, revision: 3 })).toEqual([1])
  })

  it('确认集提交分支：带 appends 的提交同样钉版（两条 commitChapter 调用点不得漏搬）', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = lowFactExtraction(bookId)
    const factId = newFactId()
    persistPendingDependencyManifest(root, 1, { entries: [{ kind: 'temporalFact', id: factId, revision: 0 }] })

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(status, JSON.stringify(data)).toBe(200)

    const rows = committedRows(root)
    expect(rows).toHaveLength(1)
    expect(rows[0]!['appendedCounts']).toEqual({ temporalFact: 1 }) // 确认集确已写正典（非空批）
    expect(rows[0]!['dependencyManifest']).toEqual({ entries: [{ kind: 'temporalFact', id: factId, revision: 0 }] })
  })

  it('无暂存：提交照常成功但不带清单（诚实「本章不钉任何上游版本」，不造空清单假数据）', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(status, JSON.stringify(data)).toBe(200)

    const rows = committedRows(root)
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('dependencyManifest')
    expect(readChapterDependencyPins(root).has(1)).toBe(false)
  })

  it('暂存形状非法：显式 500 且正典零写入（绝不静默丢钉版让影响分析失明）', async () => {
    const { base, root } = await makeDraftChapter()
    fixture.result = emptyExtraction()
    mkdirSync(join(root, PENDING_DEPENDENCY_MANIFEST_DIR), { recursive: true })
    writeFileSync(join(root, pendingDependencyManifestPath(1)), JSON.stringify({ entries: [{ kind: 'bogus', id: 'x', revision: 0 }] }))

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(status).toBe(500)
    expect(String(data.error)).toContain('dependency manifest violation')

    // 宁败不脏：相位未翻转、无提交事件行
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toContain('phase: draft')
    expect(committedRows(root)).toHaveLength(0)
  })
})
