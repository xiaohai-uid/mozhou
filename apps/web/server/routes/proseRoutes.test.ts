// @vitest-environment node
/**
 * 章节正文存取路由集成测试（发布评审 R1/R2 回归 · 黑盒真实 HTTP + 磁盘回读）：
 * - POST /api/chapter.prose：读取章快照（revision/phase/commitId/body），缺失显式 exists:false。
 * - POST /api/chapter.prose.save：预期版本契约——expectedRevision:null=仅新建；
 *   数字=必须等于盘上 revision。冲突 409 不改磁盘；外部改盘 409（写前哈希）；
 *   committed 章 409 拒绝普通保存（R2：绝不静默降级）。
 * - POST /api/chapter.reopen：作者显式重开（复用数据平面 reopenChapter 语义：
 *   写前哈希 + ChapterReopened 事件 + 基线刷新），重开后可编辑保存。
 * Commit 语义不受影响：本路由绝不翻转相位。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { LocalDataPlane, proseChapterPath } from '@mozhou/data-plane'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
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

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-prose-'))
  roots.push(dir)
  return dir
}

async function makeBook(): Promise<{ base: string; root: string }> {
  const base = await listen()
  const root = makeRoot()
  await post(base, '/api/book', { title: '主权链测试书', dir: root })
  return { base, root }
}

describe('POST /api/chapter.prose（读快照）', () => {
  it('缺失章：200 exists:false（显式空态，不 500）', async () => {
    const { base, root } = await makeBook()
    const { status, data } = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.exists).toBe(false)
  })

  it('已有章：revision/phase/body 如实返回', async () => {
    const { base, root } = await makeBook()
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '第一版。', expectedRevision: null })
    const { status, data } = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(status).toBe(200)
    expect(data.exists).toBe(true)
    expect(data.phase).toBe('draft')
    expect(Number(data.revision)).toBeGreaterThanOrEqual(1)
    expect(String(data.body)).toContain('第一版')
  })
})

describe('POST /api/chapter.prose.save（预期版本契约 · R1 冲突保护）', () => {
  it('验收A：新建 → 读取 → 编辑保存 → 重读，内容一致', async () => {
    const { base, root } = await makeBook()
    const created = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　雨夜码头，黑船靠岸。', title: '主权链测试书', expectedRevision: null,
    })
    expect(created.status).toBe(200)
    expect(created.data.created).toBe(true)
    expect(created.data.phase).toBe('draft')
    expect(Number(created.data.revision)).toBeGreaterThanOrEqual(1)

    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　雨夜码头，黑船靠岸。天亮前离港。', expectedRevision: Number(snap.data.revision),
    })
    expect(saved.status).toBe(200)
    expect(Number(saved.data.revision)).toBe(Number(snap.data.revision) + 1)

    const raw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(raw).toContain('phase: draft')
    expect(raw).toContain('天亮前离港')
    expect(raw).not.toContain('commitId')
    const reread = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(String(reread.data.body)).toContain('天亮前离港')
  })

  it('验收B/D：读取后外部改盘，保存必须 409 且磁盘原文保留、界面编辑由调用方持有', async () => {
    const { base, root } = await makeBook()
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '服务器基线版本。', expectedRevision: null })
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const diskRevision = Number(snap.data.revision)

    const file = join(root, proseChapterPath(1))
    writeFileSync(file, readFileSync(file, 'utf8').replace('服务器基线版本。', 'EXTERNAL AUTHOR CONTENT\n'))

    const stale = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: 'STALE BROWSER CONTENT', expectedRevision: diskRevision,
    })
    expect(stale.status).toBe(409)
    expect(stale.data.code).toBe('PROSE_EXTERNAL_CHANGE')
    const disk = readFileSync(file, 'utf8')
    expect(disk).toContain('EXTERNAL AUTHOR CONTENT') // 磁盘原文保留
    expect(disk).not.toContain('STALE BROWSER CONTENT') // 冲突零写入

    // 验收E（外部修改类冲突）：无显式确认位时解决流同样被拒；作者显式确认后才可完成保存
    const unresolved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '未确认的覆盖。', expectedRevision: diskRevision,
    })
    expect(unresolved.status).toBe(409)
    expect(unresolved.data.code).toBe('PROSE_EXTERNAL_CHANGE')
    const resolvedExternal = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '作者核对外部改动后重写。', expectedRevision: diskRevision, confirmExternalOverwrite: true,
    })
    expect(resolvedExternal.status).toBe(200)
    expect(readFileSync(file, 'utf8')).toContain('作者核对外部改动后重写。')
    // 确认覆盖后基线已刷新：后续普通保存恢复正常
    const nextNormal = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '确认后的正常续写。', expectedRevision: Number(resolvedExternal.data.revision),
    })
    expect(nextNormal.status).toBe(200)
  })

  it('验收C：两端同版本读取，第一端保存后第二端保存 409 不静默覆盖', async () => {
    const { base, root } = await makeBook()
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '基线。', expectedRevision: null })
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const sharedRevision = Number(snap.data.revision)

    const first = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '第一端的新文本。', expectedRevision: sharedRevision,
    })
    expect(first.status).toBe(200)

    const second = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '第二端的过期文本。', expectedRevision: sharedRevision,
    })
    expect(second.status).toBe(409)
    expect(second.data.code).toBe('PROSE_REVISION_CONFLICT')
    expect(Number(second.data.currentRevision)).toBe(sharedRevision + 1)
    const disk = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(disk).toContain('第一端的新文本。')
    expect(disk).not.toContain('第二端的过期文本。')
  })

  it('验收E：冲突后以当前版本显式确认覆盖（解决流程）才完成保存', async () => {
    const { base, root } = await makeBook()
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '基线。', expectedRevision: null })
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '他端先行保存。', expectedRevision: Number(snap.data.revision) })
    const conflict = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '我的版本。', expectedRevision: Number(snap.data.revision),
    })
    expect(conflict.status).toBe(409)
    // 明确流程：读取最新版本并显式以其为基线覆盖
    const latest = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const resolved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '我的版本。', expectedRevision: Number(latest.data.revision),
    })
    expect(resolved.status).toBe(200)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toContain('我的版本。')
  })

  it('新建语义遇已存在章：409 CHAPTER_EXISTS 不静默转覆盖', async () => {
    const { base, root } = await makeBook()
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '已存在。', expectedRevision: null })
    const again = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '并发新建。', expectedRevision: null })
    expect(again.status).toBe(409)
    expect(again.data.code).toBe('CHAPTER_EXISTS')
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toContain('已存在。')
  })

  it('缺失 expectedRevision：400（契约显式，杜绝旧客户端静默覆盖）', async () => {
    const { base, root } = await makeBook()
    const missing = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '无预期版本。' })
    expect(missing.status).toBe(400)
  })

  it('空 body：400 显式拒绝', async () => {
    const { base, root } = await makeBook()
    const { status, data } = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '   ', expectedRevision: null })
    expect(status).toBe(400)
    expect(String(data.error)).toContain('non-empty body')
  })
})

describe('R2：普通保存不降级定稿；显式重开走既有语义', () => {
  it('验收A：committed 章普通保存被 409 拒绝且零内容变更', async () => {
    const { base, root } = await makeBook()
    const plane = LocalDataPlane.openOrRebuild(root)
    plane.createChapterDraft({ chapterIndex: 1, title: 'One' })
    const commit = plane.commitChapter({ chapterIndex: 1, summary: '定稿', finalProse: 'FINAL AUTHOR CONTENT\n' })
    plane.close()
    const file = join(root, proseChapterPath(1))
    const before = readFileSync(file, 'utf8')

    // 过期编辑端的真实形态：读取过该章（持有 committed revision）后保存
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(snap.data.phase).toBe('committed')
    const rejected = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: 'DRAFT OVER COMMITTED', expectedRevision: Number(snap.data.revision),
    })
    expect(rejected.status).toBe(409)
    expect(rejected.data.code).toBe('CHAPTER_COMMITTED')
    expect(rejected.data.commitId).toBe(commit.commitId)

    const after = readFileSync(file, 'utf8')
    expect(after).toBe(before) // 零字节变更
    expect(after).toContain('phase: committed')
    expect(after).toContain('FINAL AUTHOR CONTENT')
  })

  it('验收B/C/D：显式重开生成 ChapterReopened 事件；重开后编辑保存一致；commit 追溯可核验', async () => {
    const { base, root } = await makeBook()
    const plane = LocalDataPlane.openOrRebuild(root)
    plane.createChapterDraft({ chapterIndex: 1, title: 'One' })
    const commit = plane.commitChapter({ chapterIndex: 1, summary: '定稿', finalProse: 'FINAL AUTHOR CONTENT\n' })
    plane.close()

    const reopened = await post(base, '/api/chapter.reopen', { root, chapterIndex: 1 })
    expect(reopened.status).toBe(200)
    expect(reopened.data.reopenedFromCommitId).toBe(commit.commitId)

    const file = join(root, proseChapterPath(1))
    const afterReopen = readFileSync(file, 'utf8')
    expect(afterReopen).toContain('phase: draft')
    expect(afterReopen).toContain('FINAL AUTHOR CONTENT') // 重开保留定稿正文
    const events = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    expect(events).toContain('"type":"ChapterReopened"')
    expect(events).toContain(commit.commitId) // 追溯关系可核验

    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '重开后的新草稿。', expectedRevision: Number(snap.data.revision),
    })
    expect(saved.status).toBe(200)
    const reread = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(String(reread.data.body)).toContain('重开后的新草稿')
  })

  it('验收E：外部修改与重开同时发生——重开同样拒绝（写前哈希守卫）', async () => {
    const { base, root } = await makeBook()
    const plane = LocalDataPlane.openOrRebuild(root)
    plane.createChapterDraft({ chapterIndex: 1, title: 'One' })
    plane.commitChapter({ chapterIndex: 1, summary: '定稿', finalProse: 'FINAL AUTHOR CONTENT\n' })
    plane.close()
    const file = join(root, proseChapterPath(1))
    writeFileSync(file, readFileSync(file, 'utf8').replace('FINAL AUTHOR CONTENT', 'EXTERNAL TAMPER'))

    const reopened = await post(base, '/api/chapter.reopen', { root, chapterIndex: 1 })
    expect(reopened.status).toBe(409)
    expect(reopened.data.code).toBe('PROSE_EXTERNAL_CHANGE')
    expect(readFileSync(file, 'utf8')).toContain('EXTERNAL TAMPER') // 零变更
  })

  it('draft 章重开：409 CHAPTER_NOT_COMMITTED（无定稿可重开）', async () => {
    const { base, root } = await makeBook()
    await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '草稿。', expectedRevision: null })
    const reopened = await post(base, '/api/chapter.reopen', { root, chapterIndex: 1 })
    expect(reopened.status).toBe(409)
    expect(reopened.data.code).toBe('CHAPTER_NOT_COMMITTED')
  })
})

describe('POST /api/chapter.quality（既有行为保持）', () => {
  it('无章新书：200 no_review（诚实守卫，非 500）', async () => {
    const { base, root } = await makeBook()
    const { status, data } = await post(base, '/api/chapter.quality', { root, chapterIndex: 1 })
    expect(status).toBe(200)
    expect(data.status).toBe('no_review')
    expect(data.report).toBeNull()
  })
})

describe('POST /api/chapter.commit · 五族增量提取接线（步 6 Final Extract）', () => {
  it('未配置 provider 时提交仍成功，并如实报告增量未提取（不假装叙事层已增长）', async () => {
    // 清空 provider 环境变量使本用例与开发机环境无关（确定性）
    const saved = {
      MOZHOU_API_KEY: process.env['MOZHOU_API_KEY'],
      DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
    }
    delete process.env['MOZHOU_API_KEY']
    delete process.env['DEEPSEEK_API_KEY']
    delete process.env['OPENAI_API_KEY']
    try {
      const { base, root } = await makeBook()
      await post(base, '/api/chapter.prose.save', {
        root,
        chapterIndex: 1,
        body: '第一章正文。',
        expectedRevision: null,
      })
      const { status, data } = await post(base, '/api/chapter.commit', {
        root,
        chapterIndex: 1,
        summary: '定稿',
      })

      expect(status).toBe(200)
      expect(data.phase).toBe('committed')
      const delta = data.deltaExtraction as {
        extractor: string
        counts: Record<string, number>
        reason?: string
      }
      expect(delta.extractor).toBe('none')
      expect(delta.reason).toContain('未配置可用 provider')

      // 追踪层保持 0 行——诚实反映「增量未提取」，而不是伪造增长
      const facts = readFileSync(join(root, '追踪', '事实.jsonl'), 'utf8').trim()
      expect(facts).toBe('')
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
