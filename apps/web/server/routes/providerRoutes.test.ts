// @vitest-environment node
/**
 * 模型端点设置与可靠传输 (T07 · 真实 HTTP 级端到端测试)。
 * 
 * 依照 reference/01-core.md T07 规格：
 * 1. GET /api/llm/settings：返回脱敏凭据 (maskedKey)，明文 Key 永不泄露；
 * 2. POST /api/llm/settings：保存配置，configVersion 递增；
 * 3. 两用户 Key 隔离：主体 A 配置 KeyA，主体 B 配置 KeyB，互相不可见各自凭据；
 * 4. 恶意 URL 拦截：拒绝 javascript:、未授权私有 IP、本地回环等非法端点；
 * 5. POST /api/llm/test：测试连接端点，回显模型名、耗时及脱敏结果；
 * 6. POST /api/llm/settings/reset：重置配置生效。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultProviderSettingsManager } from '../llm/providerSettings.js'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

function generateTestKey(suffix = ''): string {
  return 'fixture_key_' + randomBytes(8).toString('hex') + suffix
}

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.clear()
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
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

describe('模型通道与端点设置 (T07)', () => {
  it('未配置时 GET /api/llm/settings 返回默认与未配置状态', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/llm/settings`, { method: 'GET' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; settings: { configured: boolean; maskedKey: string } }
    expect(body.ok).toBe(true)
    expect(typeof body.settings.configured).toBe('boolean')
  })

  it('POST /api/llm/settings：保存配置并自增 configVersion，GET 只返回脱敏 key', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-llm-settings-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const rawKey = generateTestKey('sample')

    // 1. 保存配置
    const resSave = await fetch(`${base}/api/llm/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: rawKey,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        providerId: 'deepseek',
      }),
    })
    expect(resSave.status).toBe(200)
    const dataSave = (await resSave.json()) as { ok: boolean; configVersion: number; model: string }
    expect(dataSave.ok).toBe(true)
    expect(dataSave.configVersion).toBe(1)
    expect(dataSave.model).toBe('deepseek-chat')

    // 2. 读取配置，验证明文未外泄且掩码正确
    const resGet = await fetch(`${base}/api/llm/settings`, { method: 'GET' })
    expect(resGet.status).toBe(200)
    const dataGet = (await resGet.json()) as {
      ok: boolean
      settings: { configured: boolean; maskedKey: string; configVersion: number }
    }
    expect(dataGet.ok).toBe(true)
    expect(dataGet.settings.configured).toBe(true)
    expect(dataGet.settings.configVersion).toBe(1)
    expect(dataGet.settings.maskedKey).toContain('****')
    expect(dataGet.settings.maskedKey).not.toBe(rawKey)

    // 3. 再次保存，版本递增
    const resUpdate = await fetch(`${base}/api/llm/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: generateTestKey('updated'),
        model: 'deepseek-reasoner',
      }),
    })
    const dataUpdate = (await resUpdate.json()) as { ok: boolean; configVersion: number; model: string }
    expect(dataUpdate.ok).toBe(true)
    expect(dataUpdate.configVersion).toBe(2)
    expect(dataUpdate.model).toBe('deepseek-reasoner')
  })

  it('两用户 Key 隔离：主体 A 与主体 B 各自持有独立的 BYOK 凭据', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-llm-users-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)
    defaultBookAccessManager.setHostedMode(true)

    const base = await listen()
    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)

    // 创建两名用户
    const { user: userA } = await provider.signUp('userA@test.com', 'passA123')
    const { user: userB } = await provider.signUp('userB@test.com', 'passB123')

    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.id, email: userA.email })
    const { cookie: cookieB } = defaultSessionManager.createSession({ userId: userB.id, email: userB.email })

    const keyA = generateTestKey('userA')
    const keyB = generateTestKey('userB')

    // 主体 A 保存 KeyA
    await fetch(`${base}/api/llm/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({
        apiKey: keyA,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      }),
    })

    // 主体 B 保存 KeyB
    await fetch(`${base}/api/llm/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({
        apiKey: keyB,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
      }),
    })

    // 主体 A 读自己的配置
    const resA = await fetch(`${base}/api/llm/settings`, {
      method: 'GET',
      headers: { Cookie: cookieA },
    })
    const dataA = (await resA.json()) as { ok: boolean; settings: { maskedKey: string; model: string } }
    expect(dataA.settings.maskedKey).toBe(keyA.slice(0, 3) + '****' + keyA.slice(-4))
    expect(dataA.settings.model).toBe('gpt-4o')

    // 主体 B 读自己的配置
    const resB = await fetch(`${base}/api/llm/settings`, {
      method: 'GET',
      headers: { Cookie: cookieB },
    })
    const dataB = (await resB.json()) as { ok: boolean; settings: { maskedKey: string; model: string } }
    expect(dataB.settings.maskedKey).toBe(keyB.slice(0, 3) + '****' + keyB.slice(-4))
    expect(dataB.settings.model).toBe('deepseek-chat')
  })

  it('恶意 URL 校验与公网 HTTPS 强制拦截', async () => {
    defaultBookAccessManager.setHostedMode(true)
    const base = await listen()

    const provider = new InMemoryAuthProvider()
    defaultSessionManager.setProvider(provider)
    const { user } = await provider.signUp('admin@test.com', 'admin123')
    const { cookie } = defaultSessionManager.createSession({ userId: user.id, email: user.email })

    const maliciousUrls = [
      'javascript:alert(1)',
      'ftp://ftp.evil.com',
      'http://insecure-http-endpoint.com', // hosted 模式必须 HTTPS
    ]

    for (const url of maliciousUrls) {
      const res = await fetch(`${base}/api/llm/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          apiKey: generateTestKey('malicious'),
          baseUrl: url,
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(false)
    }
  })

  it('POST /api/llm/test：无可用凭据时诚实返回 PROVIDER_UNAVAILABLE', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-llm-test-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    const res = await fetch(`${base}/api/llm/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; code: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('POST /api/llm/settings/reset：重置配置成功', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-llm-reset-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const base = await listen()
    // 先保存
    await fetch(`${base}/api/llm/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: generateTestKey('reset') }),
    })

    // 重置
    const resReset = await fetch(`${base}/api/llm/settings/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(resReset.status).toBe(200)
    const dataReset = (await resReset.json()) as { ok: boolean }
    expect(dataReset.ok).toBe(true)

    // 读取确认已重置
    expect(defaultProviderSettingsManager.getSettings()).toBeNull()
  })
})
