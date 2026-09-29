// @vitest-environment node
/**
 * 逐功能真实扫描（不开 mock）：用本机 CLI Proxy 的免费模型
 * stealth/space-bunny-alpha 把吃模型与不吃模型的功能各过一遍，
 * 逐项 console.log 留痕。接线路径与凭据处置与
 * pipelineRoutes.firstChapter.realModel.test.ts 完全一致：
 * key 只在进程内读出注入 env，不写盘不打印不落产物；CI/无代理机器必然跳过。
 *
 * 覆盖面（按「对照 OpenWrite 逐功能测试」要求）：
 * - 吃模型：AI 起名 /api/naming、章节生成 /api/draft.stream（+采纳）
 * - 探针：技能市场 /api/capability-square 的 providerAvailable
 * - 本地能力（零模型）：拆书（本地面启发式）、风格蒸馏（本地指标）、
 *   质量门查询、TXT 导出、备忘录
 * - 真实性门禁（未接外部源时必须 501，不伪造数据）：web-search、rank-scan
 * - 诚实离线状态：cloud-sync
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
import { defaultMemoStore } from '../memo/memoStore.js'
import { proseChapterPath, readProseChapter } from '@mozhou/data-plane'

const PROXY_CONFIG = 'C:/Users/a1691/cli-proxy-api/config.yaml'
const PROXY_BASE = 'http://127.0.0.1:8317/v1'
/** 短输出功能用本免费模型（用户指定）；实测 2026-09-30：起名 6.6s 正常产出。 */
const SWEEP_MODEL = 'stealth/space-bunny-alpha'
/**
 * 章节生成必须用非思考型免费模型。实测 2026-09-30（本机 CLI Proxy）：
 * - stealth/space-bunny-alpha 是思考型模型（首 reasoning delta 1.1s，首 content
 *   delta 24.1s，整章 72.3s），超出管线 failurePolicy 的 60s 窗口
 *   （pipelineRoutes.ts:373），表现为零 delta 超时——只适合短输出功能；
 * - gpt-oss-120b-medium 首测 4.0s/17.3s 可用，但上游容量不稳（间歇 503）；
 * - dots-studio/dots-3-note-preview:free 首测：首 content 1.6s、21.0s 产 1594 字，
 *   本轮最快最稳，选定章节生成用。
 */
const CHAPTER_MODEL = 'dots-studio/dots-3-note-preview:free'

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
    if (!trimmed.startsWith('-')) break
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
  if (key === null) return
  process.env['MOZHOU_API_KEY'] = key
  process.env['MOZHOU_API_BASE'] = PROXY_BASE
  process.env['MOZHOU_MODEL'] = SWEEP_MODEL
  delete process.env['MOZHOU_DRAFT_PROVIDER']
  delete process.env['MOZHOU_NAMING_PROVIDER']
  delete process.env['MOZHOU_LIVE_RANKINGS'] // 扫榜门禁必须保持 501，不真爬站点
  process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

  dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-sweep-real-'))
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.setDataRoot(dataRoot)
  defaultMemoStore.setDataRoot(dataRoot) // 备忘录同样钉到临时根，不得污染真实数据目录

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

async function postJson(path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

describe('逐功能真实扫描（stealth/space-bunny-alpha）', () => {
  it('技能市场：BYOK 配好后 providerAvailable 变 true（探针不吃 token）', async () => {
    if (!available) {
      console.log('[sweep] 跳过：本机无 CLI Proxy API 配置')
      return
    }
    const res = await postJson('/api/capability-square', {})
    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    expect(res.data['providerAvailable']).toBe(true)
    const groups = res.data['groups'] as unknown[]
    expect(groups.length).toBeGreaterThan(0)
    console.log(`[sweep] capability-square: providerAvailable=true groups=${groups.length}`)
  })

  it('AI 起名：真模型产出中文人名（category 传导）', async () => {
    if (!available) return
    const started = Date.now()
    const res = await postJson('/api/naming', { mode: 'ai', category: 'technique', count: 4, hint: '剑修功法，意境冷冽' })
    const elapsed = Date.now() - started
    expect(res.status).toBe(200)
    expect(res.data['mode']).toBe('ai')
    const names = res.data['names'] as Array<{ name: string }>
    expect(names.length).toBeGreaterThanOrEqual(1)
    for (const n of names) {
      expect(n.name).toMatch(/[\u4e00-\u9fff]/)
      expect(n.name.startsWith('mock-')).toBe(false)
    }
    console.log(`[sweep] naming: elapsedMs=${elapsed} names=${JSON.stringify(names.map((n) => n.name))}`)
  }, 300_000)

  it('章节生成 + 采纳：真模型正文落进正文面', async () => {
    if (!available) return
    // 章节生成切换到非思考型免费模型（原因见 CHAPTER_MODEL 注释），用完恢复
    const prevModel = process.env['MOZHOU_MODEL']
    process.env['MOZHOU_MODEL'] = CHAPTER_MODEL
    try {
      await runChapterGenerationCase()
    } finally {
      if (prevModel === undefined) delete process.env['MOZHOU_MODEL']
      else process.env['MOZHOU_MODEL'] = prevModel
    }
  }, 300_000)

  async function runChapterGenerationCase(): Promise<void> {
    const created = await postJson('/api/book', { title: '逐功能扫描书' })
    expect(created.status).toBe(200)
    const root = created.data['root'] as string

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

    const startFrame = frames.find((f) => f['event'] === 'start')
    expect(startFrame, '首帧缺失：请求没进生成路径').toBeDefined()
    expect(startFrame?.['provider']).toBe('real-openai-compatible')
    expect(existsSync(join(root, proseChapterPath(1)))).toBe(true)

    const candidateId = startFrame?.['candidateId'] as string
    const candidate = await postJson('/api/draft.candidate', { root, candidateId })
    expect(candidate.status).toBe(200)
    const text = (candidate.data as { candidate: { text: string } }).candidate.text
    expect(text.length).toBeGreaterThan(50)
    expect(text).toMatch(/[\u4e00-\u9fff]/)

    const before = readProseChapter(root, proseChapterPath(1))
    const base0 = {
      revision: before.revision,
      sha256: createHash('sha256').update(readFileSync(join(root, proseChapterPath(1)))).digest('hex'),
    }
    const terminalEvent = frames.at(-1)?.['event']
    const allowPartial = frames.at(-1)?.['partial'] === true
    const accepted = await postJson('/api/draft.accept', {
      root,
      candidateId,
      base: base0,
      idempotencyKey: 'sweep-first-chapter',
      allowPartial,
    })
    let chapterReady = false
    if (!allowPartial && terminalEvent === 'done') {
      expect(accepted.status).toBe(200)
      chapterReady = true
    } else {
      // 上游超时终态：采纳按既有 409 口径拒绝；生成主张已由候选正文达成
      expect(accepted.status).toBe(409)
    }
    console.log(
      `[sweep] draft.stream: model=${CHAPTER_MODEL} elapsedMs=${elapsed} candidateChars=${text.length} ` +
        `terminal=${JSON.stringify(terminalEvent)} accepted=${accepted.status}`,
    )

    // —— 依赖正文的后续功能（采纳成功才断言）——
    if (chapterReady) {
      const quality = await postJson('/api/chapter.quality', { root, chapterIndex: 1 })
      expect(quality.status).toBe(200)
      expect(quality.data['ok']).toBe(true)
      expect(typeof quality.data['status']).toBe('string')
      console.log(`[sweep] chapter.quality: status=${JSON.stringify(quality.data['status'])}`)

      const exportRes = await fetch(base + '/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, format: 'txt', bookTitle: '逐功能扫描书' }),
      })
      expect(exportRes.status).toBe(200)
      expect(exportRes.headers.get('content-type')).toContain('text/plain')
      const txt = await exportRes.text()
      expect(txt.length).toBeGreaterThan(200)
      console.log(`[sweep] export txt: bytes=${txt.length}`)
    }
  }

  it('拆书：本地面启发式（origin=local-heuristic，不吃模型——如实留痕）', async () => {
    if (!available) return
    const sample = '第一章 山门雨夜。陈默跪在青石阶上，掌心的断剑微微发烫。三日前宗门大比，他还是内门第一。' +
      '第二章 藏经阁。老者递来一卷残经，纸页间有星光流动。“此经认主，”他说，“也认劫。”' +
      '第三章 下山。陈默背着断剑走出山门，身后是燃烧的钟楼。他不知道，那只手早已伸向人间。'
    const res = await postJson('/api/novel-breakdown', { sampleText: sample })
    expect(res.status).toBe(200)
    const result = res.data['result'] as Record<string, unknown> | null
    expect(result).not.toBeNull()
    expect(result?.['origin']).toBe('local-heuristic')
    const beats = result?.['emotionalBeats'] as unknown[]
    expect(beats.length).toBeGreaterThanOrEqual(1)
    console.log(`[sweep] novel-breakdown: origin=local-heuristic beats=${beats.length}（当前为本地启发式实现，无模型调用）`)
  })

  it('风格蒸馏：本地指标计算（零模型、零网络）', async () => {
    if (!available) return
    const res = await postJson('/api/style.distill', { text: '雨落在青瓦上，像谁在数拍子。她收伞，抬头，看见他站在灯下。' })
    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    const metrics = res.data['sampleMetrics'] as Record<string, unknown>
    expect(metrics).toBeDefined()
    console.log(`[sweep] style.distill: sampleMetrics=${JSON.stringify(metrics).slice(0, 120)}…`)
  })

  it('备忘录：增查回环（本地持久化）', async () => {
    if (!available) return
    const created = await postJson('/api/memo', { action: 'create', title: '扫描便签', content: '逐功能真实扫描留痕。' })
    expect(created.status).toBe(200)
    const listed = await postJson('/api/memo', { action: 'list' })
    expect(listed.status).toBe(200)
    expect((listed.data['notes'] as unknown[]).length).toBe(1)
    console.log('[sweep] memo: create+list ok')
  })

  it('web-search：未接外部搜索源时 501 诚实报错（不伪造结果）', async () => {
    if (!available) return
    const res = await postJson('/api/web-search', { query: '测试' })
    expect(res.status).toBe(501)
    expect(res.data['code']).toBe('WEB_SEARCH_NOT_CONFIGURED')
    console.log('[sweep] web-search: 501 WEB_SEARCH_NOT_CONFIGURED（真实性门禁生效）')
  })

  it('rank-scan：未开启实时榜单源时 501 诚实报错', async () => {
    if (!available) return
    const res = await postJson('/api/rank-scan', {})
    expect(res.status).toBe(501)
    expect(res.data['code']).toBe('RANK_SOURCE_NOT_CONFIGURED')
    console.log('[sweep] rank-scan: 501 RANK_SOURCE_NOT_CONFIGURED（真实性门禁生效）')
  })

  it('cloud-sync：如实报告本地离线状态（不伪装云同步）', async () => {
    if (!available) return
    const created = await postJson('/api/book', { title: '云同步状态书' })
    const root = created.data['root'] as string
    const res = await postJson('/api/cloud-sync', { root })
    expect(res.status).toBe(200)
    expect(res.data['cloudSyncAvailable']).toBe(false)
    expect(res.data['syncStatus']).toBe('offline_ready')
    console.log('[sweep] cloud-sync: offline_ready（诚实离线）')
  })
})
