// @vitest-environment node
/**
 * W4-2c-3 HTTP 路由测试：半稿采纳、续写成本估算与 outcome_unknown 显式重试门禁。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../api.js'
import {
  LocalDataPlane,
  createBook,
  createTaskRecord,
  beginTaskAttempt,
  finishTaskAttempt,
} from '@mozhou/data-plane'
import {
  appendCandidateDelta,
  createCandidateId,
  createDraftCandidate,
  finishCandidate,
  proseFileSha256,
} from '@mozhou/pipeline'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  roots = []
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.end('nf')
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

async function post(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data }
}

function makeBook(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'mozhou-c3-routes-')), 'book')
  mkdirSync(root, { recursive: true })
  roots.push(root)
  createBook({ dir: root, title: 'W4 路由测试书' })
  const plane = LocalDataPlane.open(root)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    plane.saveProseDraft({ chapterIndex: 1, body: '原章节初始文本。\n', expectedRevision: 0 })
  } finally {
    plane.close()
  }
  return root
}

describe('W4-2c-3 路由验收：半稿采纳、续写成本估算与 outcome_unknown 重试门禁', () => {
  it('POST /api/draft.accept：未确认半稿返回 409；显式确认 confirmPartial=true 返回 200', async () => {
    const base = await listen()
    const root = makeBook()
    const baseHash = proseFileSha256(root, 1)

    const candidateId = createCandidateId()
    createDraftCandidate(root, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: 1, sha256: baseHash },
      mode: 'replace',
    })
    appendCandidateDelta(root, candidateId, '断流半稿正文。')
    finishCandidate(root, candidateId, 'partial')

    // 未确认半稿
    const unconfirmed = await post(base, '/api/draft.accept', {
      root,
      candidateId,
      base: { revision: 1, sha256: baseHash },
      idempotencyKey: 'idemp_route_unconf',
      confirmPartial: false,
    })
    expect(unconfirmed.status).toBe(409)
    expect(unconfirmed.data['code']).toBe('CANDIDATE_NOT_ACCEPTABLE')

    // 显式确认半稿
    const confirmed = await post(base, '/api/draft.accept', {
      root,
      candidateId,
      base: { revision: 1, sha256: baseHash },
      idempotencyKey: 'idemp_route_conf',
      confirmPartial: true,
      operationId: 'op_accept_route_confirmed',
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.data['ok']).toBe(true)
    expect(confirmed.data['confirmPartial']).toBe(true)
    expect(confirmed.data['revision']).toBe(2)
  })

  it('POST /api/draft.continue.estimate：返回发起前可见的成本预估', async () => {
    const base = await listen()
    const root = makeBook()
    const baseHash = proseFileSha256(root, 1)

    const candidateId = createCandidateId()
    createDraftCandidate(root, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: 1, sha256: baseHash },
      mode: 'replace',
    })
    appendCandidateDelta(root, candidateId, '一段待续写的文本内容。')

    const res = await post(base, '/api/draft.continue.estimate', {
      root,
      candidateId,
    })

    expect(res.status).toBe(200)
    expect(res.data['ok']).toBe(true)
    const estimate = res.data['estimate'] as Record<string, unknown>
    expect(estimate).toBeDefined()
    expect(estimate['baseChars']).toBeGreaterThan(0)
    expect(estimate['costNotice']).toContain('续写基底')
  })

  it('POST /api/tasks.retry：outcome_unknown 未确认重复计费被拒 400；确认后分配新 attemptId 成功', async () => {
    const base = await listen()
    const root = makeBook()

    createTaskRecord(root, {
      taskId: 'task_route_unknown',
      bookId: 'book-local',
      taskKind: 'draft.generate',
    })
    beginTaskAttempt(root, 'task_route_unknown', { attemptId: 'att_route_1', provider: 'deepseek' })
    finishTaskAttempt(root, 'task_route_unknown', { attemptId: 'att_route_1', state: 'outcome_unknown' })

    // 未确认重复计费风险
    const rejected = await post(base, '/api/tasks.retry', {
      root,
      taskId: 'task_route_unknown',
      confirmDuplicateBilling: false,
    })
    expect(rejected.status).toBe(400)
    expect(rejected.data['code']).toBe('BILLING_CONFIRMATION_REQUIRED')
    expect(rejected.data['retryAllowed']).toBe(false)

    // 显式确认重复计费风险
    const accepted = await post(base, '/api/tasks.retry', {
      root,
      taskId: 'task_route_unknown',
      confirmDuplicateBilling: true,
      newAttemptId: 'att_route_explicit_2',
      newOperationId: 'op_route_explicit_2',
    })
    expect(accepted.status).toBe(200)
    expect(accepted.data['ok']).toBe(true)
    expect(accepted.data['attemptId']).toBe('att_route_explicit_2')
    expect(accepted.data['operationId']).toBe('op_route_explicit_2')
  })
})
