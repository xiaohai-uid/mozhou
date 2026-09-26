// @vitest-environment node
/**
 * 健康探针契约：`/api/health` 必须是可达的真实处理器。
 *
 * 回归防护：该路径此前只在 `routePolicies.ts` 登记了 `public` 策略、没有任何
 * 处理器，请求穿透到兜底分支返回 404——编排层因此拿不到就绪信号，`docker compose`
 * 也无法配 healthcheck。故此处断言「经真实路由器返回 200/503」，而非直接调用处理器。
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
const ORIGINAL_DATA_ROOT = process.env['MOZHOU_DATA_ROOT']

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  if (ORIGINAL_DATA_ROOT === undefined) {
    delete process.env['MOZHOU_DATA_ROOT']
  } else {
    process.env['MOZHOU_DATA_ROOT'] = ORIGINAL_DATA_ROOT
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
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

describe('/api/health · 存活与就绪', () => {
  it('数据根可写 ⇒ 200 且 ok=true，并回传解析后的数据根与来源', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-health-ok-'))
    tempDirs.push(dir)
    defaultBookAccessManager.setDataRoot(dir)
    process.env['MOZHOU_DATA_ROOT'] = dir

    const base = await listen()
    const res = await fetch(`${base}/api/health`)
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body['ok']).toBe(true)
    expect(body['status']).toBe('ok')
    expect(body['dataRoot']).toBe(dir)
    expect(body['dataRootWritable']).toBe(true)
    expect(body['dataRootSource']).toBe('env')
  })

  it('未显式配置数据根时 source 报 default —— 容器里出现该值即说明卷没接上', async () => {
    delete process.env['MOZHOU_DATA_ROOT']
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-health-default-'))
    tempDirs.push(dir)
    defaultBookAccessManager.setDataRoot(dir)

    const base = await listen()
    const res = await fetch(`${base}/api/health`)
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body['dataRootSource']).toBe('default')
  })

  it('数据根不可用 ⇒ 503 且 ok=false（处理器契约；真实服务启动时会 mkdir 出该目录）', async () => {
    defaultBookAccessManager.setDataRoot(join(tmpdir(), `mozhou-missing-${process.pid}-${Date.now()}`))

    const base = await listen()
    const res = await fetch(`${base}/api/health`)
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(503)
    expect(body['ok']).toBe(false)
    expect(body['status']).toBe('degraded')
    expect(body['dataRootWritable']).toBe(false)
  })

  it('非 GET/HEAD ⇒ 405 并声明 Allow', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-health-method-'))
    tempDirs.push(dir)
    defaultBookAccessManager.setDataRoot(dir)

    const base = await listen()
    // 用 DELETE 而非 POST：无请求体，避免把「体解析失败」与「方法不被允许」混为一谈。
    const res = await fetch(`${base}/api/health`, { method: 'DELETE' })

    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })
})
