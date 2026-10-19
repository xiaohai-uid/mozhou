// @vitest-environment node
/**
 * apps/web/server/routes · 智能体工具路由测试 (POST /api/tools.list / POST /api/tools.execute)。
 *
 * 验证：
 *   1. 真实路由器集成分发；
 *   2. 工具定义下发与开关过滤（web_search 默认关闭且不下发）；
 *   3. 权限模型生效（书根内读写放行、外部未确认拦截、系统路径硬拒绝）；
 *   4. 未知工具与未启用工具显式拒绝。
 */
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter, defaultBookAccessManager } from '../api.js'

let servers: Server[] = []
const tempDirs: string[] = []

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
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

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('智能体工具路由 (Agent Tools Routes)', () => {
  it('POST /api/tools.list 下发已启用工具清单，web_search 默认关闭且不下发', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/tools.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; tools: Array<{ name: string }> }
    expect(data.ok).toBe(true)
    expect(data.tools).toHaveLength(7)
    expect(data.tools.some((t) => t.name === 'file_read')).toBe(true)
    expect(data.tools.some((t) => t.name === 'file_write')).toBe(true)
    expect(data.tools.some((t) => t.name === 'web_search')).toBe(false)
  })

  it('POST /api/tools.list 支持通过 enabledTools 开启 web_search', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/tools.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledTools: { web_search: true } }),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; tools: Array<{ name: string }> }
    expect(data.ok).toBe(true)
    expect(data.tools.some((t) => t.name === 'web_search')).toBe(true)
    expect(data.tools).toHaveLength(8)
  })

  it('POST /api/tools.execute 缺少 name 时返回 400', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
    const data = (await res.json()) as { ok: boolean; code: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('INVALID_TOOL_REQUEST')
  })

  it('POST /api/tools.execute 调用未知工具与未启用工具返回明确失败', async () => {
    const base = await listen()

    // 未知工具
    const res1 = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'terminal' }),
    })
    expect(res1.status).toBe(200)
    const data1 = (await res1.json()) as { ok: boolean; content: string }
    expect(data1.ok).toBe(false)
    expect(data1.content).toContain('未知工具')

    // 未启用工具 (web_search)
    const res2 = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'web_search', args: { keywords: 'test' } }),
    })
    expect(res2.status).toBe(200)
    const data2 = (await res2.json()) as { ok: boolean; content: string }
    expect(data2.ok).toBe(false)
    expect(data2.content).toContain('工具未启用')
  })

  it('POST /api/tools.execute 执行 file_write 与 file_read 在书根内正常读写', async () => {
    const bookRoot = makeTemp('mozhou-agent-book-')
    const base = await listen()

    // 1. 写文件
    const writeRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_write',
        args: { path: join(bookRoot, 'notes.md'), content: '# 设定灵感\n少年拔剑' },
      }),
    })
    expect(writeRes.status).toBe(200)
    const writeData = (await writeRes.json()) as { ok: boolean; content: string }
    expect(writeData.ok).toBe(true)
    expect(existsSync(join(bookRoot, 'notes.md'))).toBe(true)

    // 2. 读文件
    const readRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_read',
        args: { path: join(bookRoot, 'notes.md') },
      }),
    })
    expect(readRes.status).toBe(200)
    const readData = (await readRes.json()) as { ok: boolean; content: string }
    expect(readData.ok).toBe(true)
    expect(readData.content).toContain('少年拔剑')
  })

  it('POST /api/tools.execute 路径越界保护：外部路径需确认，系统目录硬拒绝', async () => {
    const bookRoot = makeTemp('mozhou-agent-book-')
    const outsideRoot = makeTemp('mozhou-agent-outside-')
    const outsideFile = join(outsideRoot, 'secret.md')
    writeFileSync(outsideFile, '外部机密内容', 'utf8')

    const base = await listen()

    // 1. 外部未确认路径 → 拒绝并提示需要确认
    const unconfirmedRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_read',
        args: { path: outsideFile },
      }),
    })
    const unconfirmedData = (await unconfirmedRes.json()) as { ok: boolean; content: string }
    expect(unconfirmedData.ok).toBe(false)
    expect(unconfirmedData.content).toContain('需要作者确认')

    // 2. 外部已确认路径 → 正常读取
    const confirmedRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_read',
        args: { path: outsideFile },
        confirmedPaths: [outsideFile],
      }),
    })
    const confirmedData = (await confirmedRes.json()) as { ok: boolean; content: string }
    expect(confirmedData.ok).toBe(true)
    expect(confirmedData.content).toContain('外部机密内容')

    // 3. 系统目录 → 硬拒绝
    const systemRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_read',
        args: { path: '/etc/passwd' },
        confirmedPaths: ['/etc/passwd'], // 即便带了确认位也绝不放行
      }),
    })
    const systemData = (await systemRes.json()) as { ok: boolean; content: string }
    expect(systemData.ok).toBe(false)
    expect(systemData.content).toContain('路径被拒绝')
  })

  it('POST /api/tools.execute 支持 file_manage 创建目录与移动至回收站', async () => {
    const bookRoot = makeTemp('mozhou-agent-book-')
    const targetFile = join(bookRoot, 'draft.md')
    writeFileSync(targetFile, '待删除草稿', 'utf8')

    const base = await listen()

    // 1. 移动至回收站
    const trashRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_manage',
        args: { action: 'move_to_trash', path: targetFile },
      }),
    })
    expect(trashRes.status).toBe(200)
    const trashData = (await trashRes.json()) as { ok: boolean; content: string; meta?: { trashId?: string } }
    expect(trashData.ok).toBe(true)
    expect(trashData.meta?.trashId).toBeDefined()
    expect(existsSync(targetFile)).toBe(false)

    // 2. 创建目录
    const newDir = join(bookRoot, 'subfolder')
    const mkdirRes = await fetch(`${base}/api/tools.execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        name: 'file_manage',
        args: { action: 'mkdir', path: newDir },
      }),
    })
    expect(mkdirRes.status).toBe(200)
    const mkdirData = (await mkdirRes.json()) as { ok: boolean }
    expect(mkdirData.ok).toBe(true)
    expect(existsSync(newDir)).toBe(true)
  })
})
