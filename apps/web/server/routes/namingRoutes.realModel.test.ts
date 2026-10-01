// @vitest-environment node
/**
 * AI 起名 · 真实模型端到端复验（不开 mock）：证明 /api/naming 在**真实模型**下真的产出名称。
 * 与 pipelineRoutes.firstChapter.realModel.test.ts 共用同一门控
 * （../test-support/realModelGate.ts），与 realModel.featureSweep.test.ts 同一接线路径。
 *
 * 【整改 T02 后的门控语义 —— 逐条对应契约】
 *  1. 只有 MOZHOU_RUN_REAL_MODEL_TESTS=1 才执行下方两个真实用例；未启用时它们是
 *     **it.skipIf ⇒ skipped**，不是"提前 return 的 passing"。默认零上游请求。
 *  2. 凭据只认显式传入的 MOZHOU_API_KEY / MOZHOU_API_BASE / MOZHOU_MODEL。
 *     本文件**不再**读任何本机配置文件、不再硬编码代理端口与模型名。
 *  3. 启用但三项任一缺失 ⇒ requireRealModelConfig() 在 beforeAll 里抛错 ⇒
 *     整份 suite 失败、vitest 退出码非零。绝不退化成 skip。
 *  4. 启用后上游不可达 / 鉴权失败 ⇒ 被测链路自身抛错或断言失败 ⇒ 同样非零。
 *  5. MOZHOU_ALLOW_PRIVATE_LLM **本文件绝不设置**：是否授权环回端点由部署者决定，
 *     测试不替部署者放宽 SSRF 门禁。
 *
 * 凭据处置：key 只在本测试进程内注入 process.env（providerSettings.resolveEnvEndpoint
 * 只读环境变量），afterAll 逐项恢复原值；全程不写盘、不打印、不落任何产物。
 *
 * SSRF 门禁：下方第一个用例是**确定性守卫**，不依赖任何凭据、不发网络请求，
 * 因此**不受门控开关影响，任何时候都跑**——它反向断言未授权时环回端点被拒，
 * 证明本切片没有借道放宽门禁。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { assertSafeEndpointUrl } from '../llm/openaiStream.js'
import {
  applyEnvOverrides,
  requireRealModelConfig,
  resolveRealModelGate,
} from '../test-support/realModelGate.js'

/**
 * 仅供 SSRF 守卫用例使用的环回 URL 字面量。assertSafeEndpointUrl 是**纯 URL 判定**
 * （协议白名单 + 字面 IP/本机名），不会发任何请求；端口取一个明显的占位值，
 * 以免被误读成"本机某服务的真实地址"。真实上游一律来自 MOZHOU_API_BASE。
 */
const LOOPBACK_BASE = 'http://127.0.0.1:45999/v1'

const gate = resolveRealModelGate()
const realModelEnabled = gate.kind === 'enabled'

let server: ReturnType<typeof createServer> | null = null
let base = ''
let dataRoot = ''
let restoreEnv: (() => void) | null = null

beforeAll(async () => {
  // 未启用：下方真实用例全部 it.skip，此处只负责不建服务、不读凭据。
  if (gate.kind !== 'enabled') return
  // 启用但配置不全 ⇒ 抛 RealModelConfigError ⇒ suite 失败 + 退出码非零。
  const config = requireRealModelConfig(gate)
  restoreEnv = applyEnvOverrides({
    MOZHOU_API_KEY: config.apiKey,
    MOZHOU_API_BASE: config.apiBase,
    MOZHOU_MODEL: config.model,
    // 真实模型验证：绝不吃 mock 接缝
    MOZHOU_NAMING_PROVIDER: undefined,
  })

  // 每次运行独占书根（mkdtemp）与随机可用端口（listen(0)），不与并行进程共享。
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
    server!.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + (server!.address() as AddressInfo).port))
  })
})

afterAll(() => {
  restoreEnv?.()
  restoreEnv = null
  server?.close()
  try {
    // 清理只涉及本次运行创建的书根
    if (dataRoot.length > 0) rmSync(dataRoot, { recursive: true, force: true })
  } catch {
    /* Windows file lock tolerance */
  }
})

async function postNaming(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + '/api/naming', {
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
  // 确定性守卫：不依赖凭据、不发网络请求，任何时候都执行。
  it('SSRF 门禁未被本切片放宽：未授权时环回端点被拒', () => {
    expect(() => assertSafeEndpointUrl(LOOPBACK_BASE, false)).toThrowError(/SSRF 门禁/)
    expect(() => assertSafeEndpointUrl(LOOPBACK_BASE, true)).not.toThrow()
  })

  it.skipIf(!realModelEnabled)('走真 provider（不 mock）：人物名 · 东方玄幻提示 → 真模型产出中文人名', async () => {
    const started = Date.now()
    const res = await postNaming({ mode: 'ai', category: 'character', count: 5, hint: '东方玄幻修仙，主角出身寒微' })
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    expect(res.data['mode']).toBe('ai')
    const names = assertRealNames(res.data['names'], 5)

    // 只回显模型名与耗时，不回显任何凭据
    console.log(
      '[real-naming] model=' + String(process.env['MOZHOU_MODEL']) +
        ' category=character elapsedMs=' + String(elapsed) +
        ' names=' + JSON.stringify(names.map((n) => n.name)),
    )
  }, 300_000)

  it.skipIf(!realModelEnabled)('走真 provider：宗门势力类目 → 类目正确传导到生成', async () => {
    const res = await postNaming({ mode: 'ai', category: 'sect', count: 3, hint: '正道大派与魔道圣地' })
    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    const names = assertRealNames(res.data['names'], 3)

    console.log('[real-naming] category=sect names=' + JSON.stringify(names.map((n) => n.name)))
  }, 300_000)
})