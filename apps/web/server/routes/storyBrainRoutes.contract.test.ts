// @vitest-environment node
/**
 * Story Brain 契约创建的基线纪律回归（S4 写验证）。
 *
 * 回归防护：`/api/story-brain.contract` 曾直接 appendFileSync 到 追踪/伏笔.jsonl
 * 而不刷新 hash 基线——该文件是 canon，基线与盘面失配后，下次对账会把应用自己
 * 刚写的契约行误判为 EXTERNAL_MODIFIED，作者建完契约即收到伪冲突提案。
 * 故此处断言：走真实 HTTP 路由建契约后，verifyBaseline 对该文件必须零漂移；
 * 并以「未吸收基线的裸追加必须被标记」作反向对照，证明断言本身有检出力。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { TRACKING_STREAMS, createBook, LocalDataPlane } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []
const ORIGINAL_DATA_ROOT = process.env['MOZHOU_DATA_ROOT']

const promiseStream = TRACKING_STREAMS.find((stream) => stream.kind === 'narrativePromise')
if (promiseStream === undefined) throw new Error('narrativePromise tracking stream missing')

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

describe('POST /api/story-brain.contract · 追踪流基线纪律', () => {
  it('建契约后：行已落盘，且基线对该文件零漂移（不产生伪 EXTERNAL_MODIFIED）', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-contract-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const bookDir = join(dataRoot, 'contract-book')
    createBook({ dir: bookDir, title: '契约测试书' })

    const base = await listen()
    const res = await fetch(`${base}/api/story-brain.contract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookDir,
        sourceName: '林枫',
        targetName: '沈巍',
        summary: '十年之约：沈巍助林枫重铸剑心',
      }),
    })
    const body = (await res.json()) as { ok: boolean; contractId: string }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.contractId).toMatch(/^contract_/)

    // 行真实落盘
    const streamFile = join(bookDir, promiseStream.path)
    expect(existsSync(streamFile)).toBe(true)
    const raw = readFileSync(streamFile, 'utf8')
    expect(raw).toContain('十年之约')

    // 基线已吸收应用自己的写入：对账面不得把该文件标为外部修改
    const plane = LocalDataPlane.open(bookDir)
    try {
      const report = plane.verifyBaseline()
      expect(report.modified).not.toContain(promiseStream.path)
      expect(report.reconcileSurface).not.toContain(promiseStream.path)
    } finally {
      plane.close()
    }
  })

  it('反向对照：绕过吸收的裸追加必须被 verifyBaseline 标记（守卫有检出力）', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-contract-ctl-'))
    tempDirs.push(dataRoot)
    defaultBookAccessManager.setDataRoot(dataRoot)

    const bookDir = join(dataRoot, 'control-book')
    createBook({ dir: bookDir, title: '对照书' })

    appendFileSync(join(bookDir, promiseStream.path), '{"bypass":true}\n', 'utf8')

    const plane = LocalDataPlane.open(bookDir)
    try {
      const report = plane.verifyBaseline()
      expect(report.modified).toContain(promiseStream.path)
    } finally {
      plane.close()
    }
  })
})
