// @vitest-environment node
/**
 * AI 起名路由测试（OpenWrite 对标切片 · 工单 22）：
 * - mock provider（MOZHOU_NAMING_PROVIDER=mock，对齐 MOZHOU_DRAFT_PROVIDER 先例）：
 *   happy path 返回确定性名称；
 * - 未配置模型 → 501 NAMING_NOT_CONFIGURED（真实性门禁：不伪造名称）；
 * - mode/category/count 校验 400；
 * - prompt 构造与容错解析为纯函数单元测试。
 * AI 真实网络调用不在此覆盖：SSRF 守卫禁止私网目标，控制流由 mock provider
 * 与纯函数证明（模型提取使用夹具证明控制流，不证明真实生成质量）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { defaultBookAccessManager } from '../../server/bookAccess.js'
import {
  NAMING_MAX_COUNT,
  buildNamingPrompt,
  parseNamingNames,
} from '../../server/routes/namingRoutes.js'

let server: ReturnType<typeof createServer> | null = null
let root = ''
let envSnapshot: Record<string, string | undefined> = {}

function startServer(): Promise<string> {
  return new Promise((resolveListen) => {
    server = createServer((req, res) => {
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf') })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as AddressInfo
      resolveListen(`http://127.0.0.1:${addr.port}`)
    })
  })
}

async function callNaming(base: string, body: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/naming`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  envSnapshot = { ...process.env }
})

afterEach(() => {
  if (server !== null) server.close()
  server = null
  if (root !== '') {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  root = ''
  for (const key of Object.keys(process.env)) {
    if (/^(MOZHOU|DEEPSEEK|OPENAI)_/.test(key)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (key.startsWith('MOZHOU_') || key.startsWith('DEEPSEEK_') || key.startsWith('OPENAI_')) {
      if (value !== undefined) process.env[key] = value
    }
  }
})

describe('POST /api/naming（AI 起名 · 工单 22）', () => {
  it('mock provider：确定性返回 category/count 对应名称', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-naming-'))
    defaultBookAccessManager.setDataRoot(root)
    process.env['MOZHOU_NAMING_PROVIDER'] = 'mock'
    const base = await startServer()

    const res = await callNaming(base, { mode: 'ai', category: 'sect', count: 3 })
    expect(res.status).toBe(200)
    const names = res.payload['names'] as Array<{ name: string; meaning: string }>
    expect(names).toHaveLength(3)
    expect(names[0]?.name).toBe('mock-sect-1')
    expect(names[0]?.meaning).toContain('mock')
  })

  it('未配置模型 → 501 NAMING_NOT_CONFIGURED（不伪造名称）', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-naming-'))
    defaultBookAccessManager.setDataRoot(root)
    const base = await startServer()

    const res = await callNaming(base, { mode: 'ai', category: 'character', count: 5 })
    expect(res.status).toBe(501)
    expect(res.payload['code']).toBe('NAMING_NOT_CONFIGURED')
  })

  it('非法 mode / category / count → 400', async () => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-naming-'))
    defaultBookAccessManager.setDataRoot(root)
    const base = await startServer()

    const badMode = await callNaming(base, { mode: 'random' })
    expect(badMode.status).toBe(400)

    const badCategory = await callNaming(base, { mode: 'ai', category: 'magic' })
    expect(badCategory.status).toBe(400)

    const badCount = await callNaming(base, { mode: 'ai', category: 'sect', count: NAMING_MAX_COUNT + 1 })
    expect(badCount.status).toBe(400)
  })

  it('buildNamingPrompt：包含类目、数量与可选提示', () => {
    const withHint = buildNamingPrompt('character', 5, '东方玄幻')
    expect(withHint).toContain('人物名')
    expect(withHint).toContain('5 个')
    expect(withHint).toContain('东方玄幻')

    const withoutHint = buildNamingPrompt('sect', 3, '  ')
    expect(withoutHint).toContain('宗门势力')
    expect(withoutHint).not.toContain('题材与风格提示')
  })

  it('parseNamingNames：容错截取 JSON 数组；垃圾输出返回 null；空名过滤', () => {
    const extracted = parseNamingNames('好的，以下是结果：\n[{"name":"陆沉","meaning":"沉入深渊的剑客"},{"name":"  ","meaning":"无效"},{"name":"姜檀"}]\n以上。')
    expect(extracted).toEqual([
      { name: '陆沉', meaning: '沉入深渊的剑客' },
      { name: '姜檀' },
    ])

    expect(parseNamingNames('模型抱歉，无法生成')).toBeNull()
    expect(parseNamingNames('{"name":"不是数组"}')).toBeNull()
    expect(parseNamingNames('[{"meaning":"缺 name"}]')).toEqual([])
  })
})
