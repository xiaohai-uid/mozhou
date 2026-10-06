// @vitest-environment node
/**
 * 策略飞轮与模型评估 BFF 契约测试（CHG-20261006-06）。
 *
 * 覆盖：
 * 1. /api/flywheel.preference：冷启动（诚实空态/未物化）与写入观测后物化读取；
 * 2. /api/flywheel.preference.rebuild：显式全量重建画像与观测计数；
 * 3. /api/flywheel.suggestions：只读建议列表与诚实空态；
 * 4. /api/flywheel.evaluator.status：样本量与最小评估门槛（EVAL_MIN_DECISIONS / EVAL_MIN_CHAPTER_WINDOWS）；
 * 5. /api/flywheel.evaluator.run：显式评估入口与零自动改动路由硬不变量；
 * 6. 鉴权与边界校验：缺 root 或非法请求一律拒绝。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { recordProseEditDecision } from './proseEditRoutes.js'
import { runPreferenceLearning } from '@mozhou/flywheel'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 独占锁容错
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

function makeDataRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-flywheel-test-'))
  tempDirs.push(dir)
  return dir
}

interface Booked {
  base: string
  root: string
}

async function createBook(dataRoot: string): Promise<Booked> {
  defaultBookAccessManager.setDataRoot(dataRoot)
  const base = await listen()
  const created = await fetch(base + '/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '飞轮测试书' }),
  })
  expect(created.status).toBe(200)
  const book = (await created.json()) as { ok: boolean; root: string }
  expect(book.ok).toBe(true)
  return { base, root: book.root }
}

describe('flywheelRoutes BFF 契约测试', () => {
  it('1. /api/flywheel.preference 在新书时返回冷启动画像与诚实空态 (materialized=false, observationCount=0)', async () => {
    const { base, root } = await createBook(makeDataRoot())

    const res = await fetch(base + '/api/flywheel.preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      materialized: boolean
      observationCount: number
      profile: { obsCount: number; dims: Record<string, { mean: number }> }
    }
    expect(body.ok).toBe(true)
    expect(body.materialized).toBe(false)
    expect(body.observationCount).toBe(0)
    expect(body.profile.obsCount).toBe(0)
    expect(body.profile.dims['sent_len_mean']).toBeDefined()
    expect(body.profile.dims['dlg_char_ratio']).toBeDefined()
  })

  it('2. 产生真实观测并运行偏好学习后，/api/flywheel.preference 返回已物化画像与真实观测计数', async () => {
    const { base, root } = await createBook(makeDataRoot())

    // 记录一条编辑器的 Accept 决策
    recordProseEditDecision({
      root,
      chapterIndex: 1,
      candidateId: 'cand_test_001',
      decision: 'accepted',
      selectedText: '原句简短。',
      proposedText: '扩展后的详细描写，充满了丰富的色彩与动作。',
      level: 'selection',
    })

    // 触发偏好学习
    runPreferenceLearning(root)

    const res = await fetch(base + '/api/flywheel.preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      materialized: boolean
      observationCount: number
      profile: { obsCount: number }
    }
    expect(body.ok).toBe(true)
    expect(body.materialized).toBe(true)
    expect(body.observationCount).toBeGreaterThan(0)
    expect(body.profile.obsCount).toBeGreaterThan(0)
  })

  it('3. /api/flywheel.preference.rebuild 支持显式全量重建画像', async () => {
    const { base, root } = await createBook(makeDataRoot())

    recordProseEditDecision({
      root,
      chapterIndex: 1,
      candidateId: 'cand_test_002',
      decision: 'rejected',
      selectedText: '“不，决不。”他坚决地拒绝道。',
      proposedText: '他摇了摇头，没有答应这个荒唐的请求。',
      level: 'selection',
    })

    const res = await fetch(base + '/api/flywheel.preference.rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      observationCount: number
      profile: { obsCount: number }
    }
    expect(body.ok).toBe(true)
    expect(body.observationCount).toBeGreaterThan(0)
    expect(body.profile.obsCount).toBeGreaterThan(0)
  })

  it('4. /api/flywheel.suggestions 在无建议时返回诚实空数组', async () => {
    const { base, root } = await createBook(makeDataRoot())

    const res = await fetch(base + '/api/flywheel.suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      suggestions: unknown[]
      count: number
    }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.suggestions)).toBe(true)
    expect(body.suggestions.length).toBe(0)
    expect(body.count).toBe(0)
  })

  it('5. /api/flywheel.evaluator.status 正确反映当前样本量与资格门槛', async () => {
    const { base, root } = await createBook(makeDataRoot())

    const res = await fetch(base + '/api/flywheel.evaluator.status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      eligible: boolean
      sampleSize: { decisions: number; chapterWindows: number }
      thresholds: { minDecisions: number; minChapterWindows: number }
    }
    expect(body.ok).toBe(true)
    expect(body.eligible).toBe(false)
    expect(body.sampleSize.decisions).toBe(0)
    expect(body.thresholds.minDecisions).toBeGreaterThan(0)
    expect(body.thresholds.minChapterWindows).toBeGreaterThan(0)
  })

  it('6. /api/flywheel.evaluator.run 运行显式重新评估，且坚守不变量（绝不自动改变模型路由）', async () => {
    const { base, root } = await createBook(makeDataRoot())

    const res = await fetch(base + '/api/flywheel.evaluator.run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      mode: string
      suggestions: unknown[]
      notice: string
    }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.suggestions)).toBe(true)
    expect(body.notice).toContain('不自动改动当前模型路由配置')
  })

  it('7. 缺失 root 时的防御性 400 校验', async () => {
    const base = await listen()

    const res = await fetch(base + '/api/flywheel.preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
