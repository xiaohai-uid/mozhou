// @vitest-environment node
/**
 * W4-2c-2 路由级：/api/tasks.events 的游标补发优先、快照回退兜底，
 * 以及「平铺领域行格式不被改动」的**机械**断言（读文件字节，不是口头承诺）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PublishBus } from '@mozhou/runtime'
import { createBook } from '@mozhou/data-plane'
import { apiMiddleware } from '../api.js'
import { taskStreamRoutes } from './taskStreamRoutes.js'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows 文件锁容忍
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
      resolve('http://127.0.0.1:' + (server.address() as AddressInfo).port)
    })
  })
}

async function post(base: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + '/api/tasks.events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

function makeBook(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'mozhou-tasks-events-')), 'book')
  mkdirSync(root, { recursive: true })
  // 真实书根：book 策略要求可解析的书（与既有路由用例同款夹具）
  createBook({ dir: root, title: 'W4-2c-2 事件流测试书' })
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  roots.push(root)
  return root
}

const ev = (type: 'GenerationStarted' | 'GenerationFinished', taskRef: string) => ({ type, taskRef }) as const

function seed(root: string): void {
  const bus = new PublishBus()
  bus.publish({ root }, ev('GenerationStarted', 'task_A'), { taskId: 'task_A', attemptId: 'attempt_1', generationEpoch: 1, sequence: 1 })
  bus.publish({ root }, ev('GenerationFinished', 'task_A'), { taskId: 'task_A', attemptId: 'attempt_1', generationEpoch: 1, sequence: 2 })
  bus.publish({ root }, ev('GenerationStarted', 'task_B'), { taskId: 'task_B', generationEpoch: 4, sequence: 1 })
  bus.publish({ root }, ev('GenerationFinished', 'task_B'), { taskId: 'task_B', generationEpoch: 4, sequence: 2 })
}

describe('POST /api/tasks.events', () => {
  it('游标补发优先：带 since 只补 seq > since 的任务行，并回新游标', async () => {
    const base = await listen()
    const root = makeBook()
    seed(root)

    const all = await post(base, { root, since: 0 })
    expect(all.status).toBe(200)
    expect(all.data['mode']).toBe('replay')
    const rows = all.data['rows'] as { seq: number; taskId: string; sequence: number }[]
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4])
    expect(all.data['cursor']).toBe(4)

    const tail = await post(base, { root, since: 2 })
    expect((tail.data['rows'] as { seq: number }[]).map((r) => r.seq)).toEqual([3, 4])
    expect(tail.data['cursor']).toBe(4)

    // 已追平：空补发但游标不回退
    const none = await post(base, { root, since: 4 })
    expect(none.data['rows']).toEqual([])
    expect(none.data['cursor']).toBe(4)
  })

  it('快照回退兜底：游标非法 / 领先账本 / 早于首号 ⇒ 快照，且快照与账本真实终态一致', async () => {
    const base = await listen()
    const root = makeBook()
    seed(root)

    const invalid = await post(base, { root, since: 'abc' })
    expect(invalid.data['mode']).toBe('snapshot')
    expect(invalid.data['reason']).toBe('cursor_invalid')

    const ahead = await post(base, { root, since: 999 })
    expect(ahead.data['mode']).toBe('snapshot')
    expect(ahead.data['reason']).toBe('cursor_ahead')

    // 模拟账本被截断：只保留最后一行（首号前移 ⇒ 客户端游标 0 已早于首号之前）
    const eventsPath = join(root, '.mozhou', 'events.jsonl')
    const lines = readFileSync(eventsPath, 'utf8').trim().split('\n')
    writeFileSync(eventsPath, (lines[lines.length - 1] ?? '') + '\n')
    const truncated = await post(base, { root, since: 0 })
    expect(truncated.data['mode']).toBe('snapshot')
    expect(truncated.data['reason']).toBe('ledger_truncated')
    const snapshot = truncated.data['snapshot'] as { lastSeq: number; tasks: { taskId: string; sequence: number }[] }
    expect(snapshot.lastSeq).toBe(4)
    // 快照 = 每个任务在账本里的最后一条（此处只剩 task_B 的末行）
    expect(snapshot.tasks.map((t) => t.taskId)).toEqual(['task_B'])
    expect(snapshot.tasks[0]?.sequence).toBe(2)
  })

  it('平铺领域行：既不进补发，也**逐字节不被改动**（机械断言）', async () => {
    const base = await listen()
    const root = makeBook()
    seed(root)
    const eventsPath = join(root, '.mozhou', 'events.jsonl')
    const flatLine = JSON.stringify({ type: 'ChapterCommitted', chapterIndex: 1 })
    writeFileSync(eventsPath, readFileSync(eventsPath, 'utf8') + flatLine + '\n')
    const bytesBefore = readFileSync(eventsPath, 'utf8')

    const res = await post(base, { root, since: 0 })
    const rows = res.data['rows'] as { seq: number; event: { type: string } }[]
    // 平铺行不在补发里
    expect(rows.some((r) => r.event.type === 'ChapterCommitted')).toBe(false)
    expect(rows).toHaveLength(4)
    // 且请求前后账本**逐字节相同**（本路由只读）
    expect(readFileSync(eventsPath, 'utf8')).toBe(bytesBefore)
  })

  it('缺 root ⇒ 400；越权/未知路径不返回 200 成功形', async () => {
    const base = await listen()
    const bad = await post(base, {})
    expect(bad.status).toBe(400)
    expect(bad.data['ok']).toBe(false)
  })

  it('F-02：书根只认网关已授权书根（ctx.bookRoot）——绝不回读客户端 body.root', () => {
    // 本地模式 HTTP 层 bookRoot=body.root 区分不出来源，故直调处理器构造
    // 「网关授权 A、客户端伪造 B」的分离场景（审查 hosted 探针的本地等价物）
    const rootA = makeBook()
    seed(rootA)
    const rootB = makeBook() // 攻击者伪造的他人书根：空账本
    let captured: { status: number; body: unknown } | null = null
    const handled = taskStreamRoutes(
      { } as never,
      { } as never,
      {
        path: '/api/tasks.events',
        body: { root: rootB, since: null },
        json: (status: number, payload: unknown) => { captured = { status, body: payload } },
        bookRoot: rootA,
      },
    )
    expect(handled).toBe(true)
    expect(captured).not.toBeNull()
    const data = (captured as { body: { mode: string; snapshot: { tasks: { taskId: string }[] } } }).body
    expect(data.mode).toBe('snapshot')
    // 快照来自 A 的账本（task_A/task_B），而非 body.root 指向的空账本 B
    expect(data.snapshot.tasks.map((t) => t.taskId).sort()).toEqual(['task_A', 'task_B'])
  })
})
