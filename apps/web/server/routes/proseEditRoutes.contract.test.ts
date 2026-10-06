// @vitest-environment node
/**
 * /api/prose.edit.stream 契约测试（CHG-20261006-02 同变新增）。
 *
 * 覆盖：请求形状校验（400 族）、mock 流 NDJSON 帧协议（start→delta→done）、
 * mock 语义（回吐选区原文——不伪造改写）、绝不写盘（调用前后书根目录零变化）、
 * 空流守卫（provider 静默空输出 → error 帧，不给「完成的空候选」）。
 * 走 createMoZhouApiRouter 完整链路（策略白名单 + book 鉴权 + 解码缝），与
 * pipelineRoutes.advanceGuard.test.ts 同构。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []
const SAVED_ENV: Record<string, string | undefined> = {}
const PROVIDER_ENV_KEYS = [
  'MOZHOU_DRAFT_PROVIDER',
  'MOZHOU_DATA_ROOT',
  'MOZHOU_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'MOZHOU_API_BASE',
  'MOZHOU_MODEL',
  'NODE_ENV',
] as const

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  SAVED_ENV['NODE_ENV'] = process.env['NODE_ENV']
  for (const key of PROVIDER_ENV_KEYS) {
    SAVED_ENV[key] = process.env[key]
    delete process.env[key]
  }
  process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  for (const key of PROVIDER_ENV_KEYS) {
    const saved = SAVED_ENV[key]
    if (saved === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
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

function makeDataRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-prose-edit-'))
  tempDirs.push(dir)
  return dir
}

interface Booked {
  base: string
  root: string
}

async function createBook(dataRoot: string): Promise<Booked> {
  defaultBookAccessManager.setDataRoot(dataRoot)
  const base = await listen()
  const created = await fetch(base + '/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '行内编辑契约测试书' }),
  })
  expect(created.status).toBe(200)
  const createdData = (await created.json()) as Record<string, unknown>
  return { base, root: createdData['root'] as string }
}

interface StreamFrame {
  readonly ok?: boolean
  readonly event?: string
  readonly candidateId?: string
  readonly action?: string
  readonly provider?: string
  readonly text?: string
  readonly chars?: number
  readonly error?: string
}

/** NDJSON 流收集：逐帧 parse（保留到达顺序——帧序本身是契约）。 */
async function postStream(base: string, body: Record<string, unknown>): Promise<{ status: number; contentType: string; frames: StreamFrame[] }> {
  const res = await fetch(base + '/api/prose.edit.stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const contentType = res.headers.get('content-type') ?? ''
  const raw = await res.text()
  const frames: StreamFrame[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    frames.push(JSON.parse(line) as StreamFrame)
  }
  return { status: res.status, contentType, frames }
}

const VALID_BODY = (root: string): Record<string, unknown> => ({
  root,
  chapterIndex: 1,
  action: 'sensory_expansion',
  selectedText: '他望着窗外的雨。',
  selectionRange: { from: 0, to: 8 },
  surroundingContext: '前文……\n……后文',
})

describe('/api/prose.edit.stream · 请求形状校验（400 族）', () => {
  it.each([
    ['非法 action', { action: 'hack_prompt' }],
    ['selectedText 缺失', { selectedText: undefined }],
    ['selectedText 空白', { selectedText: '   ' }],
    ['selectionRange 非对象', { selectionRange: '0-8' }],
    ['selectionRange.from<0', { selectionRange: { from: -1, to: 8 } }],
    ['selectionRange.to<from', { selectionRange: { from: 8, to: 2 } }],
    ['custom 缺 customInstruction', { action: 'custom' }],
  ])('%s → 400 INVALID_BOOK_REQUEST', async (_label, override) => {
    const { base, root } = await createBook(makeDataRoot())
    const { status, frames } = await postStream(base, { ...VALID_BODY(root), ...override })
    expect(status).toBe(400)
    expect(frames[0]).toMatchObject({ ok: false, code: 'INVALID_BOOK_REQUEST' })
  })

  it('unknown root → 解码缝拒绝（404/400 结构化错误，不进流）', async () => {
    const { base } = await createBook(makeDataRoot())
    const { status } = await postStream(base, { ...VALID_BODY('Z:/nonexistent-root-xyz'), chapterIndex: 1 })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThan(500)
  })
})

describe('/api/prose.edit.stream · mock 流契约', () => {
  it('帧序列 start→delta…→done；delta 拼接 === 选区原文（mock 不伪造改写）', async () => {
    const { base, root } = await createBook(makeDataRoot())
    const selectedText = '夜幕低垂，狂风卷着黄沙掠过孤城，少年按剑伫立。'
    const { status, contentType, frames } = await postStream(base, { ...VALID_BODY(root), selectedText })
    expect(status).toBe(200)
    expect(contentType).toContain('application/x-ndjson')

    expect(frames[0]).toMatchObject({ ok: true, event: 'start', action: 'sensory_expansion', provider: 'mock' })
    const candidateId = frames[0]!.candidateId
    expect(typeof candidateId).toBe('string')
    expect(candidateId!.length).toBeGreaterThan(0)

    const deltas = frames.filter((f) => f['event'] === 'delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.every((f) => f['candidateId'] === candidateId)).toBe(true)
    expect(deltas.map((f) => f['text'] ?? '').join('')).toBe(selectedText.trim())

    const done = frames[frames.length - 1]!
    expect(done).toMatchObject({ ok: true, event: 'done', candidateId })
    expect(done['chars']).toBe(selectedText.trim().length)
  })

  it('四个预设与自定义动作进同一契约（同端点同帧协议）', async () => {
    for (const action of ['sensory_expansion', 'deslop_sharpen', 'dialogue_polish', 'plot_twist', 'custom'] as const) {
      const { base, root } = await createBook(makeDataRoot())
      const body = action === 'custom'
        ? { ...VALID_BODY(root), action, customInstruction: '压缩为一句，保留意象' }
        : { ...VALID_BODY(root), action }
      const { frames } = await postStream(base, body)
      expect(frames[0]).toMatchObject({ ok: true, event: 'start', action })
      expect(frames[frames.length - 1]).toMatchObject({ ok: true, event: 'done' })
    }
  })

  it('绝不写盘：整轮流式调用后书根目录零新增（候选体系不被触碰）', async () => {
    const dataRoot = makeDataRoot()
    const { base, root } = await createBook(dataRoot)
    const before = readdirSync(dataRoot).sort()
    await postStream(base, VALID_BODY(root))
    const after = readdirSync(dataRoot).sort()
    expect(after).toEqual(before)
  })
})

describe('/api/prose.edit.stream · 空流守卫', () => {
  it('mock-empty（上游静默空输出形态）→ error 帧，不给「完成的空候选」', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock-empty'
    const { base, root } = await createBook(makeDataRoot())
    const { frames } = await postStream(base, VALID_BODY(root))
    expect(frames[0]).toMatchObject({ ok: true, event: 'start' })
    const last = frames[frames.length - 1]!
    expect(last).toMatchObject({ ok: false, event: 'error' })
    expect(String(last['error'])).toContain('empty stream')
    expect(frames.some((f) => f['event'] === 'done')).toBe(false)
  })
})
