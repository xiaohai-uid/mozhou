// @vitest-environment node
/**
 * W3 操作幂等 · 路由级验收（t35）：
 * 同 ID 同摘要回放、同 ID 不同摘要 409、非法 ID/未知 schemaVersion 400、
 * 状态查询（含越权同形 not_found）、旧客户端无 operationId 保留既有 CAS 语义。
 *
 * 真实 HTTP + 临时书目录（隔离数据，不碰真实书稿）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../api.js'
import { LocalDataPlane } from '@mozhou/data-plane'
import { createBook } from '@mozhou/data-plane'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
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

/** 建一本带第 1 章草稿的临时书（隔离夹具）。 */
function makeBook(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'mozhou-w3-routes-')), 'book')
  mkdirSync(root, { recursive: true })
  roots.push(root)
  createBook({ dir: root, title: 'W3 路由测试书' })
  const plane = LocalDataPlane.open(root)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
  } finally {
    plane.close()
  }
  return root
}

describe('W3 操作幂等 · 路由级', () => {
  it('同 ID 同摘要回放（replayed=true，版本不重复变更）；旧客户端无 operationId 保留既有语义', async () => {
    const base = await listen()
    const root = makeBook()

    const first = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '第一版',
      expectedRevision: 0,
      operationId: 'op_route_1',
      schemaVersion: 1,
    })
    expect(first.status).toBe(200)
    expect(first.data['replayed']).toBe(false)
    expect(first.data['appliedRevision']).toBe(1)
    expect(first.data['currentRevision']).toBe(1)

    const retry = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '第一版',
      expectedRevision: 0,
      operationId: 'op_route_1',
      schemaVersion: 1,
    })
    expect(retry.status).toBe(200)
    expect(retry.data['replayed']).toBe(true)
    expect(retry.data['appliedRevision']).toBe(1)
    expect(retry.data['revision']).toBe(1)

    // 旧客户端（无 operationId）：既有 CAS 语义，正常执行
    const legacy = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '第二版',
      expectedRevision: 1,
    })
    expect(legacy.status).toBe(200)
    expect(legacy.data['replayed']).toBe(false)
    expect(legacy.data['revision']).toBe(2)
  })

  it('同 ID 不同摘要 → 409 OPERATION_ID_REUSED（零盘上变更）；非法 ID / 未知 schemaVersion → 400', async () => {
    const base = await listen()
    const root = makeBook()
    await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '原始正文',
      expectedRevision: 0,
      operationId: 'op_route_reuse',
      schemaVersion: 1,
    })

    const reused = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '换了正文',
      expectedRevision: 1,
      operationId: 'op_route_reuse',
      schemaVersion: 1,
    })
    expect(reused.status).toBe(409)
    expect(reused.data['code']).toBe('OPERATION_ID_REUSED')

    const invalid = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: 'x',
      expectedRevision: 1,
      operationId: 'bad id!',
      schemaVersion: 1,
    })
    expect(invalid.status).toBe(400)
    expect(invalid.data['code']).toBe('OPERATION_ID_INVALID')

    const unsupported = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: 'x',
      expectedRevision: 1,
      operationId: 'op_route_schema',
      schemaVersion: 99,
    })
    expect(unsupported.status).toBe(400)
    expect(unsupported.data['code']).toBe('OPERATION_SCHEMA_UNSUPPORTED')

    // 零盘上变更：仍是 1 版且正文未被覆盖
    const plane = LocalDataPlane.open(root)
    try {
      expect(plane.getProseChapter(1).revision).toBe(1)
      expect(plane.getProseChapter(1).body).toContain('原始正文')
    } finally {
      plane.close()
    }
  })

  it('越权同 ID（他人 operationId）→ 404 OPERATION_SCOPE_MISMATCH，不回放他人结果', async () => {
    const base = await listen()
    const root = makeBook()
    const first = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '甲写的正文',
      expectedRevision: 0,
      operationId: 'op_route_scope',
      schemaVersion: 1,
    })
    expect(first.status).toBe(200)
    expect(first.data['replayed']).toBe(false)

    // 把记录的 principalId 改成别人（模拟他人已用同一 operationId 成功），摘要保持不变
    const { readFileSync, writeFileSync } = await import('node:fs')
    const { operationRecordPath } = await import('@mozhou/data-plane')
    const recordPath = operationRecordPath(root, 'op_route_scope')
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>
    record['principalId'] = 'someone_else'
    writeFileSync(recordPath, JSON.stringify(record))

    // 本主体用同 ID 同摘要重试：作用域不匹配 → 404 形态同 not_found，且**不泄露**他人结果
    const cross = await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '甲写的正文',
      expectedRevision: 0,
      operationId: 'op_route_scope',
      schemaVersion: 1,
    })
    expect(cross.status).toBe(404)
    expect(cross.data['code']).toBe('OPERATION_SCOPE_MISMATCH')
    expect(cross.data['appliedRevision']).toBeUndefined()
    expect(cross.data['currentRevision']).toBeUndefined()
    expect(cross.data['revision']).toBeUndefined()
  })

  it('状态查询：succeeded 同时给 appliedRevision 与 currentRevision；未知 ID / 越权 → not_found 同形', async () => {
    const base = await listen()
    const root = makeBook()
    await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '查询用正文',
      expectedRevision: 0,
      operationId: 'op_route_status',
      schemaVersion: 1,
    })
    // 章节此后又被改了一次 → currentRevision 前进，appliedRevision 保持历史值
    await post(base, '/api/chapter.prose.save', {
      root,
      chapterIndex: 1,
      body: '第二次改动',
      expectedRevision: 1,
    })

    const status = await post(base, '/api/chapter.operation.status', { root, operationId: 'op_route_status', schemaVersion: 1 })
    expect(status.status).toBe(200)
    expect(status.data['state']).toBe('succeeded')
    expect(status.data['result']).toMatchObject({ appliedRevision: 1 })
    expect(status.data['currentRevision']).toBe(2)

    const unknown = await post(base, '/api/chapter.operation.status', { root, operationId: 'op_never_seen', schemaVersion: 1 })
    expect(unknown.status).toBe(200)
    expect(unknown.data['state']).toBe('not_found')
    expect(unknown.data['safeToRetrySameId']).toBe(true)

    // 越权：把记录改成别人的主体 → 与 not_found 同形（不暴露存在性）
    const { writeFileSync, readFileSync } = await import('node:fs')
    const { operationRecordPath } = await import('@mozhou/data-plane')
    const recordPath = operationRecordPath(root, 'op_route_status')
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>
    record['principalId'] = 'someone_else'
    writeFileSync(recordPath, JSON.stringify(record))
    const crossPrincipal = await post(base, '/api/chapter.operation.status', { root, operationId: 'op_route_status', schemaVersion: 1 })
    expect(crossPrincipal.status).toBe(200)
    expect(crossPrincipal.data['state']).toBe('not_found')
  })
})
