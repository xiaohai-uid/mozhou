/**
 * 服务端现状探针测试（P1-probe）。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run src/migration/serverStateProbe.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerStateProbe } from './serverStateProbe'
import { okJson } from '../test/http'
import { computeSha256Hex } from '../workbench/lib/sha256'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOOK = { root: 'C:\\tmp\\a', bookId: 'bk_1' }

describe('createServerStateProbe', () => {
  it('经 /api/chapter.prose 取 revision/phase/body 摘要；经 /api/book.state 取存在性', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) => {
        seen.push(path)
        if (path === '/api/chapter.prose') {
          return okJson({ ok: true, exists: true, chapterIndex: 1, revision: 4, phase: 'draft', body: '正文内容' })
        }
        if (path === '/api/book.state') return okJson({ ok: true, state: { book: { id: 'bk_1' } } })
        throw new Error('unexpected path ' + path)
      }),
    )
    const probe = createServerStateProbe()
    const chapter = await probe.queryChapter(BOOK, 1)
    expect(seen).toContain('/api/chapter.prose')
    expect(chapter.reachable).toBe(true)
    expect(chapter.exists).toBe(true)
    expect(chapter.revision).toBe(4)
    expect(chapter.phase).toBe('draft')
    expect(chapter.bodySha256).toBe(await computeSha256Hex('正文内容'))

    const book = await probe.queryBook(BOOK)
    expect(book).toEqual({ reachable: true, exists: true })
  })

  it('章不存在 → exists:false，revision/phase/bodySha256 为 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, exists: false, chapterIndex: 9 })))
    const probe = createServerStateProbe()
    const chapter = await probe.queryChapter(BOOK, 9)
    expect(chapter).toEqual({ reachable: true, exists: false, revision: null, phase: null, bodySha256: null })
  })

  it('探针失败（网络/非 2xx）→ reachable:false，不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const probe = createServerStateProbe()
    expect(await probe.queryChapter(BOOK, 1)).toEqual({
      reachable: false,
      exists: false,
      revision: null,
      phase: null,
      bodySha256: null,
    })
    expect(await probe.queryBook(BOOK)).toEqual({ reachable: false, exists: false })
  })

  it('body 缺失时 bodySha256 为 null（不臆造哈希）', async () => {
    const postFn = vi.fn().mockResolvedValue({ ok: true, exists: true, chapterIndex: 1, revision: 2, phase: 'draft' })
    const probe = createServerStateProbe({ postFn: postFn as never })
    const chapter = await probe.queryChapter(BOOK, 1)
    expect(chapter.bodySha256).toBeNull()
    expect(postFn).toHaveBeenCalledWith('/api/chapter.prose', { root: 'C:\\tmp\\a', chapterIndex: 1 })
  })

  it('哈希可注入（测试不依赖 Web Crypto 实现细节）', async () => {
    const probe = createServerStateProbe({
      postFn: (() => Promise.resolve({ ok: true, exists: true, revision: 1, phase: 'draft', body: 'abc' })) as never,
      hashFn: () => Promise.resolve('f'.repeat(64)),
    })
    expect((await probe.queryChapter(BOOK, 1)).bodySha256).toBe('f'.repeat(64))
  })
})

describe('E01：探针的未知 / 格式不合法不得当作「服务端为空」', () => {
  it('缺 ok / 缺 exists / exists 非布尔 / ok 非 true → 一律按未知（reachable:false）', async () => {
    const malformed: readonly unknown[] = [
      {},
      { ok: true },
      { exists: false },
      { ok: true, exists: 'no' },
      { ok: false, exists: false },
    ]
    for (const body of malformed) {
      const probe = createServerStateProbe({ postFn: (() => Promise.resolve(body)) as never })
      // 关键：不得返回 { reachable: true, exists: false }——那会被导入计划读成「服务端无此章」，
      // 从而放行覆盖。
      expect(await probe.queryChapter(BOOK, 1)).toEqual({
        reachable: false,
        exists: false,
        revision: null,
        phase: null,
        bodySha256: null,
      })
    }
  })

  it('声称存在却给不出合法 revision → 按未知处理（不拿 null 当「无冲突」）', async () => {
    const probe = createServerStateProbe({
      postFn: (() => Promise.resolve({ ok: true, exists: true, phase: 'draft' })) as never,
    })
    expect((await probe.queryChapter(BOOK, 1)).reachable).toBe(false)
  })

  it('book.state 未明确 ok → 不得当作「作品不存在」', async () => {
    const probe = createServerStateProbe({ postFn: (() => Promise.resolve({})) as never })
    expect(await probe.queryBook(BOOK)).toEqual({ reachable: false, exists: false })
  })
})
