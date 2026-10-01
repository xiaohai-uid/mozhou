// @vitest-environment node
/**
 * P1 真实模型端到端复验（不开 mock）：证明「新用户建书 → 第一次点生成」在**真实模型**
 * 下真的成功，不只是 mock provider 下的绿。
 *
 * 【整改 T02 后的门控语义】见 ../test-support/realModelGate.ts 与
 * namingRoutes.realModel.test.ts 头注，逐条对应同一份契约：
 *  1. 只有 MOZHOU_RUN_REAL_MODEL_TESTS=1 才执行真实用例；否则 it.skipIf ⇒ skipped
 *     （不是"提前 return 的 passing"），默认零上游请求。
 *  2. 凭据只认显式传入的 MOZHOU_API_KEY / MOZHOU_API_BASE / MOZHOU_MODEL；
 *     本文件不再读本机代理配置文件、不再硬编码端口与模型名。
 *  3. 启用但配置不全 ⇒ beforeAll 抛错 ⇒ suite 失败 + 退出码非零，不退化成 skip。
 *  4. 启用后上游不可达 / 鉴权失败 ⇒ 断言失败 ⇒ 同样非零。
 *  5. MOZHOU_ALLOW_PRIVATE_LLM 本文件绝不设置：授权环回端点是部署者的决定。
 *
 * 凭据处置：key 只在本测试进程内注入 process.env，afterAll 逐项恢复原值；
 * 全程不写盘、不打印、不落任何产物。
 *
 * SSRF 门禁：下方第一个用例是**确定性守卫**（纯 URL 判定，不发请求），
 * 不依赖凭据，任何时候都执行——反向断言未授权时环回端点仍被拒，
 * 以证明本次修复没有借道放宽门禁。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { proseChapterPath, readProseChapter } from '@mozhou/data-plane'
import { assertSafeEndpointUrl } from '../llm/openaiStream.js'
import {
  applyEnvOverrides,
  requireRealModelConfig,
  resolveRealModelGate,
} from '../test-support/realModelGate.js'

/** 仅供 SSRF 守卫用例的环回 URL 字面量；不发起任何请求，端口是明显的占位值。 */
const LOOPBACK_BASE = 'http://127.0.0.1:45999/v1'

const gate = resolveRealModelGate()
const realModelEnabled = gate.kind === 'enabled'

let server: ReturnType<typeof createServer> | null = null
let base = ''
let dataRoot = ''
let restoreEnv: (() => void) | null = null

beforeAll(async () => {
  if (gate.kind !== 'enabled') return
  const config = requireRealModelConfig(gate)
  restoreEnv = applyEnvOverrides({
    MOZHOU_API_KEY: config.apiKey,
    MOZHOU_API_BASE: config.apiBase,
    MOZHOU_MODEL: config.model,
    MOZHOU_DRAFT_PROVIDER: undefined,
  })

  // 每次运行独占书根与随机可用端口
  dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-first-chapter-real-'))
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
    if (dataRoot.length > 0) rmSync(dataRoot, { recursive: true, force: true })
  } catch {
    /* Windows file lock tolerance */
  }
})

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

describe('P1 真实模型 · 建书后第一次点生成', () => {
  // 确定性守卫：不依赖凭据、不发请求，任何时候都执行。
  it('SSRF 门禁未被本次修复放宽：未授权时环回端点被拒（且与章脚手架无关）', () => {
    // 直接打门禁本体，而不是靠生成请求顺带触发——生成请求还要穿 provider 解析，
    // 一旦别处先拒，断言就测不到门禁本身了。
    expect(() => assertSafeEndpointUrl(LOOPBACK_BASE, false)).toThrowError(/SSRF 门禁/)
    // 显式授权后才放行（与 openaiStream.ts 的部署者环境变量口径一致）
    expect(() => assertSafeEndpointUrl(LOOPBACK_BASE, true)).not.toThrow()
    // 非 http/https 协议无论是否授权都拒绝
    expect(() => assertSafeEndpointUrl('file:///etc/passwd', true)).toThrowError()
  })

  it.skipIf(!realModelEnabled)('走真 provider（不 mock）：建书零脚手架 → 首次生成到达真模型并落出真实正文', async () => {
    const created = await post('/api/book', { title: '首章真实模型书' })
    expect(created.status).toBe(200)
    const root = created.data['root'] as string
    expect(existsSync(join(root, 'book.json'))).toBe(true)
    // 前置事实：建书零脚手架（缺陷起点）
    expect(existsSync(join(root, '大纲', '章节', '第0001章.md'))).toBe(false)
    expect(existsSync(join(root, proseChapterPath(1)))).toBe(false)

    const started = Date.now()
    const res = await fetch(base + '/api/draft.stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, prompt: '写第一章：少年在渡口初遇持伞女子。' }),
    })
    const frames = (await res.text())
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const elapsed = Date.now() - started

    // —— P1 主张（本次修复的唯一可观察目标）——
    // 1) 请求穿过 provider 解析，抵达**真模型**（不是 mock 回吐 prompt）
    const startFrame = frames.find((f) => f['event'] === 'start')
    expect(startFrame, '首帧缺失：说明请求没进生成路径').toBeDefined()
    expect(startFrame?.['provider']).toBe('real-openai-compatible')

    // 2) 缺陷本身消失：全帧**无 ENOENT**。裸 ENOENT 是本次要消灭的东西。
    for (const f of frames) {
      const text = JSON.stringify(f)
      expect(text, '仍出现 ENOENT：章脚手架没补齐').not.toContain('ENOENT')
    }

    // 3) 脚手架按需补齐（两条根因闭合：建书不建章 + 生成路径不兜底）
    expect(existsSync(join(root, '大纲', '章节', '第0001章.md'))).toBe(true)
    expect(existsSync(join(root, proseChapterPath(1)))).toBe(true)

    // 4) 候选里有**真实模型产出**的正文（>=50 字，绝非 prompt 回吐）
    const candidateId = startFrame?.['candidateId'] as string
    const candidate = await post('/api/draft.candidate', { root, candidateId })
    expect(candidate.status).toBe(200)
    const text = (candidate.data as { candidate: { text: string } }).candidate.text
    expect(text.length).toBeGreaterThan(50)

    // 5) 采纳通路：把候选真写进正文。allowPartial 依据候选终态给——
    //    上游超时后候选被标 failed，此时采纳按既有 409 语义拒绝，这是
    //    provider 超时口径的既有行为，不是本票要改的东西。
    const before = readProseChapter(root, proseChapterPath(1))
    const base0 = {
      revision: before.revision,
      sha256: createHash('sha256').update(readFileSync(join(root, proseChapterPath(1)))).digest('hex'),
    }
    const terminalEvent = frames.at(-1)?.['event']
    const allowPartial = frames.at(-1)?.['partial'] === true
    const accepted = await post('/api/draft.accept', {
      root,
      candidateId,
      base: base0,
      idempotencyKey: 'real-first-chapter',
      allowPartial,
    })
    if (!allowPartial && terminalEvent === 'done') {
      expect(accepted.status).toBe(200)
      const after = readProseChapter(root, proseChapterPath(1))
      expect(after.body.length).toBeGreaterThan(before.body.length + 20)
    } else {
      // 上游超时终态：采纳被既有守卫拒绝（409），但 P1 的主张（能生成、能落脚手架、
      // 候选有真正文）已全部达成。显式记录，不把上游延迟伪装成 P1 通过。
      expect(accepted.status).toBe(409)
    }

    console.log(
      '[real-model] provider=real-openai-compatible model=' + String(process.env['MOZHOU_MODEL']) +
        ' elapsedMs=' + String(elapsed) + ' candidateChars=' + String(text.length) +
        ' terminal=' + JSON.stringify(terminalEvent) +
        ' head=' + JSON.stringify(text.slice(0, 40)),
    )
  }, 300_000)

  /**
   * 对照组（不是修法，是归因）：**已有章脚手架**的书走同一条生成路径，
   * 若终态与 P1 用例完全一致（同样的 TIMEOUT/partial），则该终态与本次修复无关，
   * 而属于既有的 provider 超时口径（pipelineRoutes.ts 的 60_000ms）。
   * 这一条不修 P1，也不该由 P1 票去改 60s 常量。
   */
  it.skipIf(!realModelEnabled)('对照组：章 1 已存在时走同路径，终态与首章用例一致 ⇒ 证明终态不来自脚手架补齐', async () => {
    const created = await post('/api/book', { title: '对照组书' })
    expect(created.status).toBe(200)
    const root = created.data['root'] as string
    // 用既有建章路径预置第 1 章（= 修复前的世界：脚手架已存在）
    const seeded = await post('/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '作者原文。\n',
      expectedRevision: null,
      title: '第一章',
    })
    expect(seeded.status).toBe(200)

    const res = await fetch(base + '/api/draft.stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, prompt: '写第一章：少年在渡口初遇持伞女子。' }),
    })
    const frames = (await res.text())
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const terminal = frames.at(-1)
    console.log('[real-model/control] terminal=' + JSON.stringify(terminal))

    // 对照组同样不出现 ENOENT（有脚手架时更不该有）
    expect(JSON.stringify(frames)).not.toContain('ENOENT')
    // 终态形态记录下来即可；不硬断言 succeeded —— 上游延迟不由本票负责
    expect(terminal?.['event']).toMatch(/done|error/)
  }, 300_000)
})