// @vitest-environment node
/**
 * mock 开关生产环境闸（UVSD §4-13：mock 仅限 dev/test/demo）：
 * - MOZHOU_DRAFT_PROVIDER=mock 在生产环境不得让能力探针报 mock 可用（对齐 mock-empty 先例）；
 * - MOZHOU_NAMING_PROVIDER=mock 在生产环境不得返回伪造名称，走显式 501 NAMING_NOT_CONFIGURED。
 * 两个开关在非生产环境行为不变（既有测试覆盖 happy path，此处只锁生产面）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { draftProviderAvailability } from './pipelineRoutes.js'
import { apiMiddleware } from '../../server/api.js'
import { defaultBookAccessManager } from '../../server/bookAccess.js'

let server: ReturnType<typeof createServer> | null = null
let root = ''
const savedEnv: Record<string, string | undefined> = {}

function saveEnv(): void {
  for (const key of ['NODE_ENV', 'MOZHOU_DRAFT_PROVIDER', 'MOZHOU_NAMING_PROVIDER', 'MOZHOU_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY']) {
    savedEnv[key] = process.env[key]
  }
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function startServer(): Promise<string> {
  return new Promise((resolveListen) => {
    server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.end('nf')
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as AddressInfo
      resolveListen(`http://127.0.0.1:${addr.port}`)
    })
  })
}

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
  restoreEnv()
})

describe('mock 开关 · 生产环境闸（UVSD §4-13）', () => {
  it('生产环境 MOZHOU_DRAFT_PROVIDER=mock：探针不得报 mock 可用，回到真实解析缝', async () => {
    saveEnv()
    process.env['NODE_ENV'] = 'production'
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'

    const probe = await draftProviderAvailability(process.env)

    expect(probe.reason).not.toBe('mock')
    expect(probe.available).toBe(false)
  })

  it('非生产环境 MOZHOU_DRAFT_PROVIDER=mock：行为不变，探针报 mock 可用', async () => {
    saveEnv()
    delete process.env['NODE_ENV']
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'

    const probe = await draftProviderAvailability(process.env)

    expect(probe.available).toBe(true)
    expect(probe.reason).toBe('mock')
  })

  it('生产环境 MOZHOU_NAMING_PROVIDER=mock：不返回伪造名称，显式 501（未配真实端点时）', async () => {
    saveEnv()
    root = mkdtempSync(join(tmpdir(), 'mozhou-mock-gate-'))
    defaultBookAccessManager.setDataRoot(root)
    process.env['NODE_ENV'] = 'production'
    process.env['MOZHOU_NAMING_PROVIDER'] = 'mock'
    const base = await startServer()

    const res = await fetch(`${base}/api/naming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ai', category: 'sect', count: 3 }),
    })
    const payload = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(501)
    expect(payload['code']).toBe('NAMING_NOT_CONFIGURED')
  })
})
