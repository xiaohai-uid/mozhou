// @vitest-environment node
/**
 * apps/web · 出版级全格式导出路由测试 (T10 · TXT / DOCX / EPUB 物理链路真实 HTTP 验证)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { createBook, LocalDataPlane, renderProseChapter, proseChapterPath, unpackZip } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  tempDirs = []
})

function newBookDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mozhou-export-${prefix}-`))
  tempDirs.push(dir)
  createBook({ dir, title: '苍穹之境' })
  return dir
}

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

describe('全格式出版级导出 HTTP 链路 (T10)', () => {
  it('TXT 导出：HTTP 200 返回纯文本流与 Content-Disposition 标头', async () => {
    const bookDir = newBookDir('txt')
    const base = await listen()
    const res = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookDir,
        bookTitle: '苍穹之境',
        format: 'txt',
        chapters: [
          { title: '第一章 破晓', content: '朝霞如火，点亮了群山之巅。' },
          { title: '第二章 风起', content: '远方的呼啸声由远及近。' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('content-disposition')).toContain('attachment;')
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('苍穹之境'))

    const text = await res.text()
    expect(text).toContain('苍穹之境')
    expect(text).toContain('第一章 破晓')
    expect(text).toContain('朝霞如火')
    expect(text).toContain('第二章 风起')
  })

  it('DOCX 导出：HTTP 200 返回合规 OOXML 二进制并在解包后校验 XML 内容', async () => {
    const bookDir = newBookDir('docx')
    const base = await listen()
    const res = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookDir,
        bookTitle: '苍穹之境',
        synopsis: '一部讲述云海探索的史诗。',
        format: 'docx',
        chapters: [
          { title: '第一章 破晓', content: '朝霞如火，点亮了群山之巅。' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(res.headers.get('content-disposition')).toContain('.docx')

    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.readUInt32LE(0)).toBe(0x04034b50)

    const unpacked = unpackZip(buf)
    const docFile = unpacked.find((f) => f.path === 'word/document.xml')
    expect(docFile).toBeDefined()
    const docXml = docFile!.data.toString('utf8')
    expect(docXml).toContain('苍穹之境')
    expect(docXml).toContain('一部讲述云海探索的史诗。')
    expect(docXml).toContain('第一章 破晓')
  })

  it('EPUB 导出：HTTP 200 返回合规 EPUB 3 二进制并在解包后校验各组件', async () => {
    const bookDir = newBookDir('epub')
    const base = await listen()
    const res = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookDir,
        bookTitle: '苍穹之境',
        author: '云海行者',
        format: 'epub',
        chapters: [
          { title: '第一章 破晓', content: '朝霞如火，点亮了群山之巅。' },
        ],
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/epub+zip')
    expect(res.headers.get('content-disposition')).toContain('.epub')

    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.readUInt32LE(0)).toBe(0x04034b50)

    const unpacked = unpackZip(buf)
    expect(unpacked[0]?.path).toBe('mimetype')
    expect(unpacked[0]?.data.toString('utf8')).toBe('application/epub+zip')
    const opf = unpacked.find((f) => f.path === 'OEBPS/content.opf')
    expect(opf).toBeDefined()
    expect(opf!.data.toString('utf8')).toContain('苍穹之境')
  })

  it('防坏单保护：含空章节时拦截并返回 409 EXPORT_EMPTY_CHAPTER', async () => {
    const bookDir = newBookDir('empty-ch')
    const base = await listen()
    const res = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookDir,
        bookTitle: '苍穹之境',
        format: 'txt',
        chapters: [
          { title: '第一章 破晓', content: '朝霞如火' },
          { title: '第二章 风起', content: '   ' }, // 空章节
        ],
      }),
    })

    expect(res.status).toBe(409)
    const json = await res.json() as Record<string, unknown>
    expect(json['ok']).toBe(false)
    expect(json['code']).toBe('EXPORT_EMPTY_CHAPTER')
  })

  it('从真实磁盘书根读取章节进行一键导出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-export-disk-'))
    tempDirs.push(dir)
    createBook({ dir, title: '真实磁盘小说' })

    const plane = LocalDataPlane.open(dir)
    plane.createChapterDraft({ chapterIndex: 2, title: '第二章' })
    const ch1Path = join(dir, proseChapterPath(1))
    const ch2Path = join(dir, proseChapterPath(2))
    writeFileSync(ch1Path, renderProseChapter({
      mozhouId: 'prose_01HQ0000000000000000000001',
      revision: 0,
      chapterIndex: 1,
      phase: 'draft',
      body: '晨光洒在宽阔的港湾中。',
    }), 'utf8')
    writeFileSync(ch2Path, renderProseChapter({
      mozhouId: 'prose_01HQ0000000000000000000002',
      revision: 0,
      chapterIndex: 2,
      phase: 'draft',
      body: '狂风席卷了海面，惊涛拍岸。',
    }), 'utf8')
    plane.close()

    const base = await listen()
    const res = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: dir,
        format: 'txt',
      }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('真实磁盘小说')
    expect(text).toContain('第 1 章')
    expect(text).toContain('晨光洒在宽阔的港湾中。')
    expect(text).toContain('第 2 章')
    expect(text).toContain('狂风席卷了海面，惊涛拍岸。')
  })
})
