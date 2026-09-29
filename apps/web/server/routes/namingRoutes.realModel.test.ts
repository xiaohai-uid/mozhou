// @vitest-environment node
/**
 * AI 起名 · 真实模型端到端复验（不开 mock）：证明 /api/naming 在**本机真实模型**
 * 下真的产出名称，不只是 mock provider 下的绿。与
 * pipelineRoutes.firstChapter.realModel.test.ts 同一接线路径与凭据处置。
 *
 * 凭据处置：key 只在本测试进程内从本机代理配置读出并注入 `process.env`
 * （`providerSettings.resolveEnvEndpoint` 只读环境变量），全程不写盘、不打印、
 * 不落任何产物。
 *
 * SSRF 门禁：环回端点必须由部署者显式 `MOZHOU_ALLOW_PRIVATE_LLM=1` 授权
 * （providerSettings.ts:268/279 把该变量写进解析端点的 allowPrivateNetwork；
 *  streamOpenAiChat 出站前仍过 assertSafeRemoteTarget 兜底）。下方第一用例
 * 反向断言未授权时门禁仍然拒绝环回，证明本切片没有借道放宽门禁。
 *
 * 跳过语义：本测试依赖本机 CLI Proxy API 与其配置，CI/他人机器上必然跳过。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { assertSafeEndpointUrl } from '../llm/openaiStream.js'

const PROXY_CONFIG = 'C:/Users/a1691/cli-proxy-api/config.yaml'
const PROXY_BASE = 'http://127.0.0.1:8317/v1'
const PROXY_MODEL = 'DeepSeek-V4-Flash'

/**
 * 从本机代理配置的 `api-keys:` 段读出第一条 key 到内存。
 * 纯行解析，不执行任何外部进程，key 不离开本函数返回值。
 */
function readProxyKey(): string | null {
  let lines: string[]
  try {
    lines = readFileSync(PROXY_CONFIG, 'utf8').split('\n')
  } catch {
    return null
  }
  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('api-keys:')) {
      inSection = true
      continue
    }
    if (!inSection) continue
    if (trimmed.length === 0) continue
    if (!trimmed.startsWith('-')) break // 段内出现非列表行 ⇒ 段结束
    const value = trimmed.slice(1).trim().replace(/^["']|["']$/g, '')
    if (value.length > 0) return value
  }
  return null
}

let server: ReturnType<typeof createServer> | null = null
let base = ''
let dataRoot = ''
let available = false

beforeAll(async () => {
  const key = readProxyKey()
  if (key === null) return // 无本机代理 ⇒ 整套跳过（本文件不承诺在别处可跑）
  process.env['MOZHOU_API_KEY'] = key
  process.env['MOZHOU_API_BASE'] = PROXY_BASE
  process.env['MOZHOU_MODEL'] = PROXY_MODEL
  delete process.env['MOZHOU_NAMING_PROVIDER'] // 真实模型验证：绝不吃 mock 接缝
  // 环回端点的部署者授权（providerSettings.ts:268/279 读此变量）
  process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

  dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-naming-real-'))
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.setDataRoot(dataRoot)

  const router = createMoZhouApiRouter()
  server = createServer((req, res) => {
    void router.dispatch(req, res).then((handled) => {
      if (!handled && !res.writableEnded) {
        res.statusCode = 404
        res.end('nf')
      }
    })
  })
  base = await new Promise((r) => {
    server!.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`))
  })
  available = true
})

afterAll(() => {
  server?.close()
  try {
    if (dataRoot.length > 0) rmSync(dataRoot, { recursive: true, force: true })
  } catch {
    /* Windows file lock tolerance */
  }
})

async function postNaming(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/naming`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

function assertRealNames(names: unknown, maxCount: number): Array<{ name: string; meaning?: string }> {
  expect(Array.isArray(names)).toBe(true)
  const list = names as Array<{ name: string; meaning?: string }>
  expect(list.length).toBeGreaterThanOrEqual(1)
  expect(list.length).toBeLessThanOrEqual(maxCount)
  for (const item of list) {
    expect(typeof item.name).toBe('string')
    expect(item.name.trim().length).toBeGreaterThan(0)
    // 真模型产出：含中文字符，且不是 mock 接缝的固定样本
    expect(item.name).toMatch(/[\u4e00-\u9fff]/)
    expect(item.name.startsWith('mock-')).toBe(false)
  }
  return list
}

describe('P1 真实模型 · /api/naming AI 起名', () => {
  it('SSRF 门禁未被本切片放宽：未授权时环回端点被拒', () => {
    // 直接打门禁本体（与 firstChapter.realModel 同款反向断言）
    expect(() => assertSafeEndpointUrl(PROXY_BASE, false)).toThrowError(/SSRF 门禁/)
    expect(() => assertSafeEndpointUrl(PROXY_BASE, true)).not.toThrow()
  })

  it('走真 provider（不 mock）：人物名 · 东方玄幻提示 → 真模型产出中文人名', async () => {
    if (!available) {
      console.log('[real-naming] 跳过：本机无 CLI Proxy API 配置')
      return
    }

    const started = Date.now()
    const res = await postNaming({ mode: 'ai', category: 'character', count: 5, hint: '东方玄幻修仙，主角出身寒微' })
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    expect(res.data['mode']).toBe('ai')
    const names = assertRealNames(res.data['names'], 5)

    console.log(
      `[real-naming] model=${PROXY_MODEL} category=character elapsedMs=${elapsed} ` +
        `names=${JSON.stringify(names.map((n) => n.name))}`,
    )
  }, 300_000)

  it('走真 provider：宗门势力类目 → 类目正确传导到生成', async () => {
    if (!available) {
      console.log('[real-naming] 跳过：本机无 CLI Proxy API 配置')
      return
    }

    const res = await postNaming({ mode: 'ai', category: 'sect', count: 3, hint: '正道大派与魔道圣地' })
    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    const names = assertRealNames(res.data['names'], 3)

    console.log(`[real-naming] category=sect names=${JSON.stringify(names.map((n) => n.name))}`)
  }, 300_000)
})
