// @vitest-environment node
/**
 * P1 回归：建书后第一次点生成就能成功（`.dsh-audit/launch/02-browser-ui.md` §7 缺陷 1）。
 *
 * 现象：走完建书向导后 `大纲/章节/` 与 `正文/第一卷/` 都是空的（无章脚手架），
 * 此时点「发送」触发首章生成，`/api/draft.stream` 立刻失败
 * `ENOENT ... 大纲\章节\第0001章.md`，新用户第一次生成必然失败。
 *
 * 本测试走**真实端到端路径**（不 mock 任何一层业务）：
 *   真实 HTTP  POST /api/book            （建书，零章脚手架）
 *     → 真实 HTTP POST /api/draft.stream（首章生成，走真 provider 或真 mock provider）
 *     → 真实磁盘  章脚手架落盘（大纲节点 + 正文载体）
 *     → 真实 HTTP  POST /api/draft.candidate（候选可读回）
 *     → 真实 HTTP  POST /api/draft.accept （候选采纳进正文）
 * 断言的是**用户可观察的终态**（生成成功、章脚手架存在、正文被写入），
 * 而不是错误码字符串。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { chapterOutlinePath, proseChapterPath, readProseChapter } from '@mozhou/data-plane'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []
const ORIGINAL_DATA_ROOT = process.env['MOZHOU_DATA_ROOT']
const ORIGINAL_DRAFT_PROVIDER = process.env['MOZHOU_DRAFT_PROVIDER']

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  // mock provider 是既有演示/测试开关（pipelineRoutes.isMockDraftProviderMode），
  // 用来让本测试的「生成」段不打真实模型；章脚手架创建/上下文编译/落盘全是真的。
  process.env.MOZHOU_DRAFT_PROVIDER = 'mock'
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  if (ORIGINAL_DATA_ROOT === undefined) {
    delete process.env['MOZHOU_DATA_ROOT']
  } else {
    process.env['MOZHOU_DATA_ROOT'] = ORIGINAL_DATA_ROOT
  }
  if (ORIGINAL_DRAFT_PROVIDER === undefined) {
    delete process.env['MOZHOU_DRAFT_PROVIDER']
  } else {
    process.env['MOZHOU_DRAFT_PROVIDER'] = ORIGINAL_DRAFT_PROVIDER
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

async function postJson(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

async function runStream(base: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const res = await fetch(base + '/api/draft.stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.text())
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function makeDataRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-first-chapter-'))
  tempDirs.push(dir)
  return dir
}

describe('P1 建书后第一次点生成（真实端到端）', () => {
  it('/api/book 建的书零章脚手架；随后 draft.stream 首章自动补齐脚手架并成功生成', async () => {
    const dataRoot = makeDataRoot()
    defaultBookAccessManager.setDataRoot(dataRoot)
    const base = await listen()

    // 1) 真实建书（= 走完建书向导的落盘结果）：章目录为空
    const created = await postJson(base, '/api/book', { title: '首章测试书' })
    expect(created.status).toBe(200)
    expect(created.data['ok']).toBe(true)
    const root = created.data['root'] as string
    expect(existsSync(join(root, 'book.json'))).toBe(true)
    // 前置事实：建书不产生任何章脚手架（这正是缺陷 1 的起点）
    expect(readdirSync(join(root, '大纲', '章节'))).toEqual([])
    expect(readdirSync(join(root, '正文', '第一卷'))).toEqual([])

    // 2) 新用户第一次点「发送」：不做任何前置建章，直接生成首章
    const frames = await runStream(base, { root, chapterIndex: 1, prompt: '写第一章' })
    const events = frames.map((f) => f['event'])
    const errorFrame = frames.find((f) => f['event'] === 'error')

    // 生成必须成功：**不得**是 ENOENT / 任何 error 帧
    expect(errorFrame).toBeUndefined()
    expect(events.at(0)).toBe('start')
    expect(events.at(-1)).toBe('done')
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })
    expect(frames.filter((f) => f['event'] === 'delta').length).toBeGreaterThan(0)

    // 3) 真实磁盘：章脚手架已由生成路径按需补齐（大纲节点 + 正文载体）
    expect(existsSync(join(root, chapterOutlinePath(1)))).toBe(true)
    expect(existsSync(join(root, proseChapterPath(1)))).toBe(true)

    // 4) 真实读回：正文可解析、脚手架进哈希基线
    const scan = readProseChapter(root, proseChapterPath(1))
    expect(scan.chapterIndex).toBe(1)
    expect(scan.phase).toBe('draft')

    // 5) 候选真实可读回并可采纳进正文（首章生产全链闭合）
    const candidateId = frames[0]?.['candidateId'] as string
    expect(typeof candidateId).toBe('string')
    const candidate = await postJson(base, '/api/draft.candidate', { root, candidateId })
    expect(candidate.status).toBe(200)
    expect(candidate.data).toMatchObject({ ok: true, candidate: { id: candidateId, status: 'ready' } })

    const base0 = { revision: scan.revision, sha256: proseHash(root) }
    const accepted = await postJson(base, '/api/draft.accept', {
      root,
      candidateId,
      base: base0,
      idempotencyKey: 'first-chapter-1',
    })
    expect(accepted.status).toBe(200)
    expect(accepted.data['ok']).toBe(true)

    // 6) 终态：正文里真的有生成内容（不是空壳）
    const finalRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(finalRaw.length).toBeGreaterThan(scan.body.length + 1)
    expect(readdirSync(join(root, '正文', '第一卷'))).toContain('第0001章.md')
  })

  it('已有章脚手架时行为不变：章 2 首次生成同样按需补齐，且章 1 不被触碰', async () => {
    const dataRoot = makeDataRoot()
    defaultBookAccessManager.setDataRoot(dataRoot)
    const base = await listen()

    const created = await postJson(base, '/api/book', { title: '第二章测试书' })
    const root = created.data['root'] as string

    // 先建第 1 章（走既有建章路径）
    const ch1 = await postJson(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '第一章作者原文。\n',
      expectedRevision: null,
      title: '第一章',
    })
    expect(ch1.status).toBe(200)
    const ch1Before = readFileSync(join(root, proseChapterPath(1)), 'utf8')

    // 第 2 章没有任何脚手架 → 生成时按需补齐
    const frames = await runStream(base, { root, chapterIndex: 2, prompt: '写第二章' })
    expect(frames.find((f) => f['event'] === 'error')).toBeUndefined()
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })
    expect(existsSync(join(root, chapterOutlinePath(2)))).toBe(true)
    expect(existsSync(join(root, proseChapterPath(2)))).toBe(true)

    // 幂等：第 1 章字节不变（生成路径绝不回写别的章）
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(ch1Before)

    // 幂等：第二次生成同一章不重复建章、不报错
    const again = await runStream(base, { root, chapterIndex: 2, prompt: '重写第二章' })
    expect(again.find((f) => f['event'] === 'error')).toBeUndefined()
    expect(again.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })
  })
})

function proseHash(root: string, chapterIndex = 1): string {
  // 与 pipelineRoutes.hashProseRaw 同源（正文 raw 文件 sha256）
  return createHash('sha256').update(readFileSync(join(root, proseChapterPath(chapterIndex)))).digest('hex')
}
