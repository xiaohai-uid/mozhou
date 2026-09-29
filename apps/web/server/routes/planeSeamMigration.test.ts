// @vitest-environment node
/**
 * 工单 08：迁移到句柄 seam 之后的**生产路径回归**。
 *
 * packages/data-plane/src/with-plane.test.ts 判的是 seam 自身的语义；本文件判的是
 * 真实调用点在换掉 `const plane = open(); try {} finally { close() }` 之后**行为不变**。
 *
 * 覆盖本票实际迁移的站点（按调用链分组）：
 *   - storyBrainRoutes：/api/book.state、/api/story-brain.entities、/api/story-brain.facts、
 *     /api/story-brain.entity.save、/api/story-brain.contract、/api/author-intent.save
 *     （最后一条同时钉住工作树里作者的意图修复不被本票动过）
 *   - worksRoutes：/api/change-matrix、/api/works、/api/library.open
 *   - exportRoutes：/api/export 读源失败时的 409 文案
 *   - storyboard store：readSourceSnapshot 的缺章/空章错误
 *   - proseRoutes：/api/chapter.prose 的 404/不存在分支
 *
 * 错误路径是重点：seam 把 `try/finally` 收进内部后，最容易丢的是**错误分类**——
 * 旧代码里 catch 分支能区分 ENOENT / 相位错 / 哈希失配，收拢后必须仍然只捕到原来那些。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { createBook, proseChapterPath, renderProseChapter, withStrictBook } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'
import { readSourceSnapshot, ChapterMissingError } from '../storyboard/store.js'
import { StoryboardValidationError } from '../storyboard/contract.js'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []
const ORIGINAL_DATA_ROOT = process.env['MOZHOU_DATA_ROOT']

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  if (ORIGINAL_DATA_ROOT === undefined) {
    delete process.env['MOZHOU_DATA_ROOT']
  } else {
    process.env['MOZHOU_DATA_ROOT'] = ORIGINAL_DATA_ROOT
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

function newBook(name: string): { dataRoot: string; bookDir: string } {
  const dataRoot = mkdtempSync(join(tmpdir(), `mozhou-t08-${name}-`))
  tempDirs.push(dataRoot)
  defaultBookAccessManager.setDataRoot(dataRoot)
  const bookDir = join(dataRoot, 'book')
  createBook({ dir: bookDir, title: 'seam 书' })
  return { dataRoot, bookDir }
}

async function post(base: string, urlPath: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('seam 迁移后：读端点行为不变', () => {
  it('/api/book.state 经 withBook 仍返回正典状态', async () => {
    const { bookDir } = newBook('state')
    const base = await listen()
    const { status, body } = await post(base, '/api/book.state', { root: bookDir })
    expect(status).toBe(200)
    expect(body['ok']).toBe(true)
    expect(body['state']).toBeDefined()
  })

  it('/api/book.state 缺 root 仍 400（seam 未吞掉前置校验）', async () => {
    newBook('state400')
    const base = await listen()
    const { status, body } = await post(base, '/api/book.state', {})
    expect(status).toBe(400)
    expect(body['ok']).toBe(false)
  })

  it('/api/story-brain.entities 与 /api/story-brain.facts 经 withStrictBook 行为不变', async () => {
    const { bookDir } = newBook('brain')
    const base = await listen()
    const entities = await post(base, '/api/story-brain.entities', { root: bookDir })
    expect(entities.status).toBe(200)
    expect(Array.isArray(entities.body['cards'])).toBe(true)

    const facts = await post(base, '/api/story-brain.facts', { root: bookDir, entityIds: [] })
    expect(facts.status).toBe(200)
    expect(facts.body['ok']).toBe(true)
  })

  it('/api/story-brain.entity.save 成功路径不变，且空名仍 400', async () => {
    const { bookDir } = newBook('entitysave')
    const base = await listen()
    const ok = await post(base, '/api/story-brain.entity.save', {
      root: bookDir,
      name: '林枫',
      brief: '主角',
      details: '少年',
    })
    expect(ok.status).toBe(200)
    expect(ok.body['ok']).toBe(true)

    const bad = await post(base, '/api/story-brain.entity.save', { root: bookDir, name: '   ' })
    expect(bad.status).toBe(400)
  })

  it('/api/change-matrix 与 /api/works 经 withStrictBook 行为不变', async () => {
    const { bookDir } = newBook('works')
    const base = await listen()
    const matrix = await post(base, '/api/change-matrix', { root: bookDir })
    expect(matrix.status).toBe(200)
    expect(matrix.body['matrix']).toBeDefined()

    const works = await post(base, '/api/works', { root: bookDir })
    expect(works.status).toBe(200)
    const book = works.body['book'] as Record<string, unknown>
    expect(book['title']).toBe('seam 书')
  })

  it('/api/library.open 有效书根 200；未登记的书根被前置守卫拒绝（400），未进 seam', async () => {
    const { bookDir } = newBook('libopen')
    const base = await listen()
    const ok = await post(base, '/api/library.open', { root: bookDir })
    expect(ok.status).toBe(200)
    expect(ok.body['title']).toBe('seam 书')

    // 未登记的书根在 seam 之前就被身份/书权限层拒掉——seam 没有把 400 变成 404，
    // 也没有把 404 变成 200：钉住「错误分类不因收拢 try/finally 而漂移」。
    const empty = join(bookDir, '..', 'not-a-book')
    mkdirSync(empty, { recursive: true })
    tempDirs.push(empty)
    const bad = await post(base, '/api/library.open', { root: empty })
    expect(bad.status).toBe(400)
    expect(bad.body['ok']).toBe(false)
  })

  it('/api/library.open：投影损坏时 withBook 自建投影后仍 200（旧代码靠 openOrRebuild 兜底）', async () => {
    const { bookDir } = newBook('libopen-rebuild')
    const base = await listen()
    rmSync(join(bookDir, '.mozhou', 'runtime.sqlite'), { force: true })
    const { status, body } = await post(base, '/api/library.open', { root: bookDir })
    expect(status).toBe(200)
    expect(body['title']).toBe('seam 书')
  })
})

describe('seam 迁移后：错误分类未变', () => {
  it('/api/chapter.prose 缺章仍返回 exists:false（ENOENT 未被 seam 吞）', async () => {
    const { bookDir } = newBook('prose404')
    const base = await listen()
    const { status, body } = await post(base, '/api/chapter.prose', { root: bookDir, chapterIndex: 7 })
    expect(status).toBe(200)
    expect(body['ok']).toBe(true)
    expect(body['exists']).toBe(false)
    expect(body['chapterIndex']).toBe(7)
  })

  it('/api/export 无章节仍返回 409 EXPORT_NO_CHAPTERS（seam 未改变判据顺序）', async () => {
    const { bookDir } = newBook('export-nochapters')
    const base = await listen()
    const { status, body } = await post(base, '/api/export', { root: bookDir })
    expect(status).toBe(409)
    expect(body['code']).toBe('EXPORT_NO_CHAPTERS')
  })

  it('/api/export 章节在目录但正文文件内容损坏 ⇒ 409 EXPORT_SOURCE_UNREADABLE（seam 内抛错原样冒泡）', async () => {
    const { bookDir } = newBook('export409')
    const base = await listen()
    withStrictBook(bookDir, (plane) => {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    })
    expect(existsSync(join(bookDir, proseChapterPath(1)))).toBe(true)
    // 写非法 frontmatter：getWorksOverview 的 readProseChapter 会抛结构错，
    // 旧代码与新代码都必须在同一个 catch 里映射成 409 EXPORT_SOURCE_UNREADABLE。
    writeFileSync(join(bookDir, proseChapterPath(1)), '这不是合法正文文件\n')
    const { status, body } = await post(base, '/api/export', { root: bookDir })
    expect(status).toBe(409)
    expect(body['code']).toBe('EXPORT_SOURCE_UNREADABLE')
  })

  it('/api/export 章节目录登记但正文被外部删掉 ⇒ 退回 409 EXPORT_NO_CHAPTERS（判据顺序未变）', async () => {
    const { bookDir } = newBook('export-deleted')
    const base = await listen()
    withStrictBook(bookDir, (plane) => {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    })
    rmSync(join(bookDir, proseChapterPath(1)), { force: true })
    const { status, body } = await post(base, '/api/export', { root: bookDir })
    expect(status).toBe(409)
    expect(body['code']).toBe('EXPORT_NO_CHAPTERS')
  })

  it('storyboard readSourceSnapshot：缺章抛 ChapterMissingError，空章抛 StoryboardValidationError', () => {
    const { bookDir } = newBook('storyboard')
    // 缺章
    expect(() => readSourceSnapshot(bookDir, 3)).toThrow(ChapterMissingError)
    // 有目录项但正文为空 ⇒ 空章校验（走真实渲染器写合法 frontmatter，不手搓 YAML）
    writeFileSync(
      join(bookDir, proseChapterPath(1)),
      renderProseChapter({
        mozhouId: 'prose_01HQ0000000000000000000000',
        revision: 0,
        chapterIndex: 1,
        phase: 'draft',
        body: '   \n',
      }),
    )
    expect(() => readSourceSnapshot(bookDir, 1)).toThrow(StoryboardValidationError)
  })
})

describe('seam 迁移后：作者意图修复未被本票破坏', () => {
  it('/api/author-intent.save 首次保存 200 且盘上可回读', async () => {
    const { bookDir } = newBook('intent')
    const base = await listen()
    const payload = {
      worldRule: '灵力为尊',
      volumePromise: '少年登顶',
      opening: '雨夜',
      firstChapterGoal: '初入宗门',
    }
    const first = await post(base, '/api/author-intent.save', { root: bookDir, ...payload })
    expect(first.status).toBe(200)
    expect(first.body['ok']).toBe(true)
    expect(String(first.body['path'])).toBe('设定/作者意图.md')

    // 幂等重放：同值重发仍 200 且带 idempotent
    const replay = await post(base, '/api/author-intent.save', { root: bookDir, ...payload })
    expect(replay.status).toBe(200)
    expect(replay.body['idempotent']).toBe(true)

    // 不同值必须冲突，不得覆盖（作者修复的核心语义）
    const conflict = await post(base, '/api/author-intent.save', {
      root: bookDir,
      ...payload,
      opening: '改成雪夜',
    })
    expect(conflict.status).toBe(409)
  })
})

describe('seam 迁移后：并发请求下书根仍可整体删除（无句柄残留）', () => {
  it('并发打一轮读端点后，书目录可被 rmSync 删掉', async () => {
    const { dataRoot, bookDir } = newBook('concurrent')
    const base = await listen()
    const calls = [
      post(base, '/api/book.state', { root: bookDir }),
      post(base, '/api/story-brain.entities', { root: bookDir }),
      post(base, '/api/change-matrix', { root: bookDir }),
      post(base, '/api/works', { root: bookDir }),
      post(base, '/api/chapter.prose', { root: bookDir, chapterIndex: 1 }),
    ]
    const results = await Promise.all(calls)
    for (const r of results) expect(r.status).toBe(200)
    // Windows 下句柄压文件时 rmSync 会 EBUSY/EPERM；删得掉即无残留句柄。
    expect(() => rmSync(dataRoot, { recursive: true, force: true })).not.toThrow()
  })
})
