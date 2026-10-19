// @vitest-environment node
/**
 * apps/web · 文档分章导入路由集成测试 (S-03 · TXT/MD/DOCX 导入与原子回滚)。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { exportSubmissionDocx, readProseChapter, proseChapterPath, withStrictBook } from '@mozhou/data-plane'
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
      if (existsSync(d)) {
        rmSync(d, { recursive: true, force: true })
      }
    } catch {
      // Windows file lock tolerance
    }
  }
  tempDirs = []
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

async function post(base: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data }
}

describe('既有稿文档导入 API (/api/library.import & /api/library.import.doc)', () => {
  it('TXT 导入：正常识别章节标题切分并原子建书落盘', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-txt-'))
    tempDirs.push(parent)

    const txt = `第一章 绝境逢生
少年孤身一人站在断崖边缘，夜风凛冽。

第二章 洞天福地
穿过瀑布后的水帘，别有洞天。`

    const res = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '仙途逆旅',
      content: txt,
      format: 'txt',
    })

    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)
    expect(res.data.chapterCount).toBe(2)
    expect(typeof res.data.root).toBe('string')
    expect(typeof res.data.bookId).toBe('string')
    expect(res.data.title).toBe('仙途逆旅')

    const root = res.data.root as string
    expect(existsSync(root)).toBe(true)

    // 验证物理正文文件落地
    const ch1 = readProseChapter(root, proseChapterPath(1))
    expect(ch1.phase).toBe('draft')
    expect(ch1.body).toContain('绝境逢生')
    expect(ch1.body).toContain('少年孤身一人站在断崖边缘')

    const ch2 = readProseChapter(root, proseChapterPath(2))
    expect(ch2.phase).toBe('draft')
    expect(ch2.body).toContain('洞天福地')
    expect(ch2.body).toContain('穿过瀑布后的水帘')

    // 验证书库扫描读面可见
    const scan = await post(base, '/api/library', { parentDir: parent })
    expect(scan.status).toBe(200)
    const books = scan.data.books as { title: string; chapterCount: number }[]
    expect(books.some((b) => b.title === '仙途逆旅' && b.chapterCount === 2)).toBe(true)
  })

  it('Markdown 导入：按 # 与 ## 标题切分', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-md-'))
    tempDirs.push(parent)

    const md = `# 第一章 觉醒之日
沉睡万年的机械巨兽重新亮起蓝光。

# 第二章 遗落都市
废弃的摩天大楼被藤蔓与青苔完全包裹。`

    const res = await post(base, '/api/library.import', {
      parentDir: parent,
      title: '赛博纪元',
      content: md,
      format: 'md',
    })

    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)
    expect(res.data.chapterCount).toBe(2)

    const root = res.data.root as string
    const overview = withStrictBook(root, (plane) => plane.getWorksOverview())
    expect(overview.chapters.length).toBe(2)
  })

  it('DOCX 导入：通过 base64 上传 DOCX 二进制并成功解析分章', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-docx-'))
    tempDirs.push(parent)

    const docxBuf = exportSubmissionDocx('长夜残烛', '悬疑惊悚推理小说。', [
      { title: '第一章 暴风雨之夜', content: '暴风雨切断了海岛通往外界的所有通讯。\n公馆大厅的时钟敲响了十二下。' },
      { title: '第二章 消失的客人', content: '二楼客房的门半掩着，地毯上留下一串潮湿的脚印。' },
    ])

    const res = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '长夜残烛',
      fileBase64: docxBuf.toString('base64'),
      format: 'docx',
    })

    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)
    expect(res.data.chapterCount).toBe(2)

    const root = res.data.root as string
    const ch1 = readProseChapter(root, proseChapterPath(1))
    expect(ch1.body).toContain('暴风雨之夜')
    expect(ch1.body).toContain('公馆大厅的时钟敲响了十二下')
  })

  it('分章预览模式：previewOnly/action=preview 仅返回切分结构，不写盘', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-prev-'))
    tempDirs.push(parent)

    const txt = `第一章 启程
出发的号角吹响。

第二章 抵达
新的旅程已经开始。`

    const res = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '未建之书',
      content: txt,
      action: 'preview',
    })

    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)
    expect(res.data.preview).toBe(true)
    expect(res.data.chapterCount).toBe(2)
    const chapters = res.data.chapters as { chapterIndex: number; title: string; preview: string }[]
    expect(chapters[0]?.title).toBe('第一章 启程')
    expect(chapters[1]?.title).toBe('第二章 抵达')

    // 关键断言：预览模式未落盘，目标书目录不存在
    const targetDir = join(parent, '未建之书')
    expect(existsSync(targetDir)).toBe(false)
  })

  it('负例 1：缺参（无 parentDir 或空 title）返回 400', async () => {
    const base = await listen()
    const res1 = await post(base, '/api/library.import.doc', { title: '缺少父目录' })
    expect(res1.status).toBe(400)
    expect(res1.data.ok).toBe(false)

    const res2 = await post(base, '/api/library.import.doc', { parentDir: tmpdir(), title: '   ' })
    expect(res2.status).toBe(400)
    expect(res2.data.ok).toBe(false)
  })

  it('负例 2：空文本或损坏 DOCX 返回 400，绝不建书或残留目录', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-err-'))
    tempDirs.push(parent)

    // 空文本
    const resEmpty = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '空文档',
      content: '   \n  \t  ',
      format: 'txt',
    })
    expect(resEmpty.status).toBe(400)
    expect(resEmpty.data.ok).toBe(false)
    expect(existsSync(join(parent, '空文档'))).toBe(false)

    // 损坏 DOCX
    const resCorrupt = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '坏文档',
      fileBase64: Buffer.from('NOT_DOCX').toString('base64'),
      format: 'docx',
    })
    expect(resCorrupt.status).toBe(400)
    expect(resCorrupt.data.ok).toBe(false)
    expect(existsSync(join(parent, '坏文档'))).toBe(false)
  })

  it('负例 3：重名书导入返回 409', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-dup-'))
    tempDirs.push(parent)

    const first = await post(base, '/api/library.import', {
      parentDir: parent,
      title: '重名测试书',
      content: '第一章 始\n正文。',
    })
    expect(first.status).toBe(200)

    const dup = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '重名测试书',
      content: '第一章 始\n正文。',
    })
    expect(dup.status).toBe(409)
    expect(dup.data.ok).toBe(false)
  })

  it('负例 4 (HTTP 接口原子回滚)：建章中途发生异常时自动回滚，绝不残留半本书', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-route-import-rollback-'))
    tempDirs.push(parent)

    const txt = `第一章 正常开头
这是正文。

第二章 故障触发
这里将发生异常。`

    const targetDir = join(parent, '接口回滚测试书')

    const res = await post(base, '/api/library.import.doc', {
      parentDir: parent,
      title: '接口回滚测试书',
      content: txt,
      format: 'txt',
      _failAtChapter: 2,
    })

    expect(res.status).toBe(409)
    expect(res.data.ok).toBe(false)
    expect(String(res.data.error)).toContain('SIMULATED_IMPORT_FAILURE_AT_CHAPTER_2')

    // 关键原子断言：目录被彻底回滚，磁盘上无残留的半本书
    expect(existsSync(targetDir)).toBe(false)
  })
})
