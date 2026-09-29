// @vitest-environment node
/**
 * 工单 01 验收补充（.scratch/mozhou-deepening-20260928/issues/01-commit-external-change-500.md）：
 * 无 provider 快速提交路径下的外部改盘守卫。
 *
 * 已有验收：proseRoutes.proposal.test.ts:369（带 appends 的续接提交路径，proseRoutes.ts:708）
 * ——本文件补齐另一条真实代码路径：delta 为空 ⇒ 无提案 ⇒ 快速提交（proseRoutes.ts:621 直接
 * commitChapter），同样必须被 assertPreWriteHash（chapter.ts:582）拦下，并由 commit 的
 * catch 链（proseRoutes.ts:737）归一为 409 PROSE_EXTERNAL_CHANGE，正文/正典零覆盖。
 *
 * 确定性：清空 provider 环境变量 ⇒ extractChapterDelta 走 'none' 提取器（零模型调用）；
 * 无 mock、无桩服务——纯黑盒真实 HTTP + 临时书目录（隔离数据，不碰真实书稿）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../api.js'
import { proseChapterPath } from '@mozhou/data-plane'

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

describe('POST /api/chapter.commit · 外部改盘守卫（工单 01 验收 · 无 provider 快速路径）', () => {
  it('外部改盘后提交：409 PROSE_EXTERNAL_CHANGE，正文保留外部字节、正典/事件零写入', async () => {
    // 清空 provider 环境变量：与开发机环境无关（确定性），提取走 'none'，零模型调用
    const saved = {
      MOZHOU_API_KEY: process.env['MOZHOU_API_KEY'],
      DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
    }
    delete process.env['MOZHOU_API_KEY']
    delete process.env['DEEPSEEK_API_KEY']
    delete process.env['OPENAI_API_KEY']
    try {
      const base = await listen()
      const root = mkdtempSync(join(tmpdir(), 'mozhou-web-commit-ext-'))
      roots.push(root)
      await post(base, '/api/book', { title: '外部改盘验收书', dir: root })
      const savedProse = await post(base, '/api/chapter.prose.save', {
        root, chapterIndex: 1, body: '　　服务器基线版本。', expectedRevision: null,
      })
      expect(savedProse.status).toBe(200)

      const prosePath = join(root, proseChapterPath(1))
      const before = readFileSync(prosePath, 'utf8')
      const beforeRevision = /revision: (\d+)/.exec(before)![1]!
      expect(before).toContain('服务器基线版本。')

      // 外部改盘：绕过 API 直接写盘（外部编辑器的真实形态）
      writeFileSync(prosePath, before.replace('服务器基线版本。', 'EXTERNAL AUTHOR CONTENT\n'), 'utf8')
      expect(readFileSync(prosePath, 'utf8')).toContain('EXTERNAL AUTHOR CONTENT')

      // 工单05 Contract Delta：提交携带作者所读 revision（此处即盘上 revision——外部改盘
      // 未走 API，frontmatter revision 不变）；失配守卫不触发，仍落外部改盘 409。
      const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: Number(beforeRevision) })

      expect(status, JSON.stringify(data)).toBe(409)
      expect(data.ok).toBe(false)
      expect(data.code).toBe('PROSE_EXTERNAL_CHANGE')

      // 正文不被覆盖：外部字节保留、相位未翻转、revision 未动
      const after = readFileSync(prosePath, 'utf8')
      expect(after).toContain('EXTERNAL AUTHOR CONTENT')
      expect(after).toContain('phase: draft')
      expect(after).not.toContain('commitId')
      expect(/revision: (\d+)/.exec(after)![1]).toBe(beforeRevision)

      // 正典不被覆盖：五族追踪流零写入（文件在建书时初始化为空，断言行数恒 0——
      // 与 proposal.test.ts assertCanonUntouched 同一语义，且 `''.split` 的假一行已滤除）
      for (const name of ['事实.jsonl', '认知.jsonl', '关系.jsonl', '伏笔.jsonl', '时间线.jsonl']) {
        const file = join(root, '追踪', name)
        const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter((l) => l.length > 0) : []
        expect(lines, `${name} 零写入`).toHaveLength(0)
      }
      // 提交事件行零追加
      const events = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
      expect(events).not.toContain('"type":"ChapterCommitted"')
      expect(events).not.toContain('"type":"CanonCommitted"')
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
