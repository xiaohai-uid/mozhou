// @vitest-environment node
/**
 * 回归：无 provider 时 /api/session.advance 不得放行会话进入 draft 步。
 *
 * 缺陷：advance 只移步光标、不执行步内工作，而草稿步的唯一工作入口
 * /api/draft.stream 有 provider 前置闸。无任何 provider 时 advance 能把会话
 * 从 prepare 一路推到 review（盘上无正文、无编译凭证），最后在
 * review→user_edit 撞 QualityReviewNotPassError（verdict '<none>'）——
 * fail-closed 守卫的内部术语错误，会话除 abandon 外无路可走。
 *
 * 修复语义：与 draft.stream 前置闸同缝——仅 no_provider_configured 在
 * 进入 draft 步前以 PROVIDER_UNAVAILABLE 拒绝；配置类病因照常放行。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []
const SAVED_ENV: Record<string, string | undefined> = {}
const PROVIDER_ENV_KEYS = [
  'MOZHOU_DRAFT_PROVIDER',
  'MOZHOU_DATA_ROOT',
  'MOZHOU_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'MOZHOU_API_BASE',
  'MOZHOU_MODEL',
] as const

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  for (const key of PROVIDER_ENV_KEYS) {
    SAVED_ENV[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  for (const key of PROVIDER_ENV_KEYS) {
    const saved = SAVED_ENV[key]
    if (saved === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved
    }
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

function makeDataRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-advance-guard-'))
  tempDirs.push(dir)
  return dir
}

interface Journey {
  base: string
  root: string
}

async function openSessionAt(dataRoot: string): Promise<Journey> {
  defaultBookAccessManager.setDataRoot(dataRoot)
  const base = await listen()
  const created = await postJson(base, '/api/book', { title: 'advance 守卫测试书' })
  expect(created.status).toBe(200)
  const root = created.data['root'] as string
  const opened = await postJson(base, '/api/session.open', { root, chapterIndex: 1 })
  expect(opened.status).toBe(200)
  expect(opened.data).toMatchObject({ ok: true, currentStep: 'prepare' })
  return { base, root }
}

describe('/api/session.advance 无 provider 守卫', () => {
  it('无任何 provider：prepare→compile 可推进；compile→draft 被 PROVIDER_UNAVAILABLE 拒绝且会话停在 compile', async () => {
    const { base, root } = await openSessionAt(makeDataRoot())

    // compile 步不依赖 provider：照常推进（守卫不得误伤其他步）
    const toCompile = await postJson(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(toCompile.status).toBe(200)
    expect(toCompile.data).toMatchObject({ ok: true, previousStep: 'prepare', currentStep: 'compile' })

    // 进入 draft 步被显式拒绝：结构化错误码 + 病因 + 指引
    const toDraft = await postJson(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(toDraft.status).toBe(409)
    expect(toDraft.data).toMatchObject({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      providerUnavailableReason: 'no_provider_configured',
    })
    expect(typeof toDraft.data['providerDetail']).toBe('string')
    expect(String(toDraft.data['providerDetail']).length).toBeGreaterThan(0)

    // 拒绝是幂等的：会话没有移动，重试同一步仍是同一个结构化错误
    const retry = await postJson(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(retry.status).toBe(409)
    expect(retry.data).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' })
  })

  it('MOZHOU_DRAFT_PROVIDER=mock：compile→draft 照常放行（守卫不误伤显式 mock）', async () => {
    process.env.MOZHOU_DRAFT_PROVIDER = 'mock'
    const { base, root } = await openSessionAt(makeDataRoot())

    const toCompile = await postJson(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(toCompile.status).toBe(200)
    expect(toCompile.data).toMatchObject({ ok: true, currentStep: 'compile' })

    const toDraft = await postJson(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(toDraft.status).toBe(200)
    expect(toDraft.data).toMatchObject({ ok: true, previousStep: 'compile', currentStep: 'draft' })
  })
})
