// @vitest-environment node
/**
 * apps/web/server/routes · 技能系统路由测试 (skillRoutes.test.ts)。
 *
 * 验证：
 *   1. POST /api/skills.list   -> SkillStore.list()，列出摘要（不含 body）
 *   2. POST /api/skills.read   -> 接收 { id }，SkillStore.read(id)
 *   3. POST /api/skills.save   -> 接收 { id, name, description, body, resources }，SkillStore.write(...)
 *   4. POST /api/skills.delete -> 接收 { id }，SkillStore.remove(id)
 *   5. 参数校验与错误码验证（400 校验错误、404 未找到、资源路径越界保护等）
 */
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter, defaultBookAccessManager } from '../api.js'
import type { SkillsDeleteResponse, SkillsListResponse, SkillsReadResponse, SkillsSaveResponse } from './skillRoutes.js'

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

function makeBookEnv(prefix: string): { baseDir: string; bookRoot: string } {
  const baseDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(baseDir)
  const bookRoot = join(baseDir, 'book')
  mkdirSync(bookRoot, { recursive: true })
  return { baseDir, bookRoot }
}

describe('技能系统 HTTP 路由 (Skill Routes)', () => {
  it('POST /api/skills.save 保存技能，支持写入资源，回读验证落盘内容', async () => {
    const { bookRoot } = makeBookEnv('mozhou-skill-')
    const base = await listen()

    const saveRes = await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'suspense-hook',
        name: '悬念钩子',
        description: '在章末设置钩子吸引读者继续阅读',
        version: '1.1.0',
        license: 'MIT',
        body: '## 步骤\n1. 抛出未知线索\n2. 截断在动作发生前。',
        resources: {
          'scripts/check.txt': 'verify-hook-script',
          'references/guide.md': '钩子写作范例',
          'assets/template.md': '模板素材',
        },
      }),
    })

    expect(saveRes.status).toBe(200)
    const saveData = (await saveRes.json()) as SkillsSaveResponse
    expect(saveData.ok).toBe(true)
    expect(saveData.skill.id).toBe('suspense-hook')
    expect(saveData.skill.name).toBe('悬念钩子')
    expect(saveData.skill.version).toBe('1.1.0')
    expect(saveData.skill.resources.scripts).toBe(1)
    expect(saveData.skill.resources.references).toBe(1)
    expect(saveData.skill.resources.assets).toBe(1)
    expect(saveData.skill.body).toContain('抛出未知线索')

    // 检查磁盘上的 SKILL.md 与资源
    const skillDir = join(bookRoot, '..', 'skills', 'suspense-hook')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    const rawContent = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
    expect(rawContent).toContain('name: 悬念钩子')
    expect(rawContent).toContain('description: 在章末设置钩子吸引读者继续阅读')
    expect(existsSync(join(skillDir, 'scripts', 'check.txt'))).toBe(true)
  })

  it('POST /api/skills.list 列出技能摘要（只包含元数据，不含 body）', async () => {
    const { bookRoot } = makeBookEnv('mozhou-skill-')
    const base = await listen()

    // 1. 保存两个技能
    await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'skill-alpha',
        name: '技能甲',
        description: '描述甲',
        body: '这是详细的技能甲长正文，列表摘要不应包含此字段',
      }),
    })
    await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'skill-beta',
        name: '技能乙',
        description: '描述乙',
        body: '这是详细的技能乙长正文',
      }),
    })

    // 2. 调用 list
    const listRes = await fetch(`${base}/api/skills.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot }),
    })

    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as SkillsListResponse
    expect(listData.ok).toBe(true)
    expect(listData.skills.length).toBe(2)
    const alpha = listData.skills.find((s) => s.id === 'skill-alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.name).toBe('技能甲')
    expect(alpha?.description).toBe('描述甲')
    expect((alpha as unknown as Record<string, unknown>)['body']).toBeUndefined()
  })

  it('POST /api/skills.read 读取技能详情（包含 body 与资源统计）', async () => {
    const { bookRoot } = makeBookEnv('mozhou-skill-')
    const base = await listen()

    // 1. 保存技能
    await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'world-building',
        name: '世界观构建',
        description: '搭建小说宏大世界观',
        body: '# 设定指南\n地理、势力、力量体系。',
      }),
    })

    // 2. 正常读取
    const readRes = await fetch(`${base}/api/skills.read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: 'world-building' }),
    })

    expect(readRes.status).toBe(200)
    const readData = (await readRes.json()) as SkillsReadResponse
    expect(readData.ok).toBe(true)
    expect(readData.skill.id).toBe('world-building')
    expect(readData.skill.body).toContain('地理、势力、力量体系。')

    // 3. 不存在的技能返回 404
    const notFoundRes = await fetch(`${base}/api/skills.read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: 'non-existent' }),
    })
    expect(notFoundRes.status).toBe(404)
    const notFoundData = (await notFoundRes.json()) as { ok: boolean; code: string }
    expect(notFoundData.ok).toBe(false)
    expect(notFoundData.code).toBe('SKILL_NOT_FOUND')

    // 4. 缺少 id 返回 400
    const invalidRes = await fetch(`${base}/api/skills.read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot }),
    })
    expect(invalidRes.status).toBe(400)
  })

  it('POST /api/skills.save 参数校验：缺少必填字段、非法 id、越界资源路径均拒绝', async () => {
    const { bookRoot } = makeBookEnv('mozhou-skill-')
    const base = await listen()

    // 1. 缺少 name / description
    const res1 = await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'test-skill',
        name: '   ',
        description: 'desc',
        body: 'body',
      }),
    })
    expect(res1.status).toBe(400)

    // 2. 非法 id（大写或特殊字符）
    const res2 = await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'Invalid_ID',
        name: 'Name',
        description: 'desc',
        body: 'body',
      }),
    })
    expect(res2.status).toBe(400)
    const data2 = (await res2.json()) as { ok: boolean; code: string }
    expect(data2.code).toBe('SKILL_ID_INVALID')

    // 3. 资源路径落在 scripts/ references/ assets/ 之外
    const res3 = await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'escape-skill',
        name: '越界资源',
        description: '尝试越界',
        body: 'body',
        resources: {
          'outside.txt': '恶意内容',
        },
      }),
    })
    expect(res3.status).toBe(400)
    const data3 = (await res3.json()) as { ok: boolean; code: string }
    expect(data3.code).toBe('SKILL_RESOURCE_OUTSIDE')
  })

  it('POST /api/skills.delete 成功删除技能目录，重复删除报 404', async () => {
    const { bookRoot } = makeBookEnv('mozhou-skill-')
    const base = await listen()

    // 1. 先创建技能
    await fetch(`${base}/api/skills.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        id: 'to-be-deleted',
        name: '待删除',
        description: '将被删除的技能',
        body: '正文',
      }),
    })

    const skillDir = join(bookRoot, '..', 'skills', 'to-be-deleted')
    expect(existsSync(skillDir)).toBe(true)

    // 2. 正常删除
    const delRes = await fetch(`${base}/api/skills.delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: 'to-be-deleted' }),
    })
    expect(delRes.status).toBe(200)
    const delData = (await delRes.json()) as SkillsDeleteResponse
    expect(delData.ok).toBe(true)
    expect(delData.deleted).toBe(true)
    expect(existsSync(skillDir)).toBe(false)

    // 3. 再次删除同一技能 -> 404
    const delAgainRes = await fetch(`${base}/api/skills.delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bookRoot, id: 'to-be-deleted' }),
    })
    expect(delAgainRes.status).toBe(404)
  })
})
