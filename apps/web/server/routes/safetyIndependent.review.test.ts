// @vitest-environment node
/**
 * 独立审查（REVIEW-20261004-01）负样本回归锁。
 * 四个用例锁定 2026-10-04 审查发现的应有行为，修复对应：
 *   W3 save 回放零事件副作用 → F-09（proseRoutes 回放不落作者编辑信号）
 *   W3 成功 commit 同号重试回放原结果 → F-04（commit-orchestration 相位守卫前回放）
 *   W2 已确认 proposal 续接必须等跨进程书锁 → F-03（写租约注入编排层写回段）
 *   F02 活着的无关 PID 不误判历史 dataRoot 锁 → F-10（锁记录 v2，旧格式可接管）
 * 提取缝被 mock：本文件零模型调用、零真实书稿访问。
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { afterAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../analysis/deltaExtractor.js', () => ({
  extractChapterDelta: () => {
    fixture.calls++
    return { extractor: 'unavailable', appends: {}, counts: { temporalFact: 0, knowledgeState: 0, narrativePromise: 0, relationshipState: 0, timelineEvent: 0 }, dropped: 0, reason: 'review isolated external edge; zero model calls' }
  },
}))
import { apiMiddleware } from '../api.js'
import { DataRootProcessLock } from '../bookAccess.js'
import { acquireBookWriteLock } from '../platform/writerLock.js'
import { createBook, LocalDataPlane, readOperationRecord } from '@mozhou/data-plane'
import { createCanonProposal, webCommitWindowTaskRef } from '@mozhou/pipeline'
import { newTimelineEventId } from '@mozhou/kernel'
import { PublishBus } from '@mozhou/runtime'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []
afterAll(async () => {
  for (const server of servers) await new Promise<void>((r) => server.close(() => r()))
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
function rootDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
function makeBook(): { root: string, bookId: string, revision: number } {
  const root = join(rootDir('mozhou-independent-safety-'), 'book')
  mkdirSync(root)
  createBook({ dir: root, title: '独立安全探针合成书' })
  const plane = LocalDataPlane.open(root)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '测试章' })
    plane.saveProseDraft({ chapterIndex: 1, body: '完全合成的作者正文。', expectedRevision: 0 })
    return { root, bookId: plane.book.id, revision: plane.getProseChapter(1).revision }
  } finally { plane.close() }
}
async function listen(): Promise<string> {
  const server = createServer((req, res) => apiMiddleware()(req, res, () => { res.statusCode=404; res.end('nf') }))
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address() as { port: number }
  return 'http://127.0.0.1:' + addr.port
}
async function post(base: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(base+path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json() as Record<string, unknown> }
}

describe('独立安全审查：应有行为的负样本', () => {
  it('W3 历史 save 回放应零事件副作用，不伪造把当前正文改回旧文的作者信号', async () => {
    const { root, revision } = makeBook()
    const base = await listen()
    const firstCommand = { root, chapterIndex: 1, body: '作者第一版 A。', expectedRevision: revision, operationId: 'review_save_A', schemaVersion: 1 }
    const first = await post(base, '/api/chapter.prose.save', firstCommand)
    const later = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '作者后来新版 B。', expectedRevision: revision + 1, operationId: 'review_save_B', schemaVersion: 1 })
    const eventsPath = join(root, '.mozhou', 'events.jsonl')
    const ledgerBefore = readFileSync(eventsPath, 'utf8')
    const replay = await post(base, '/api/chapter.prose.save', firstCommand)
    const ledgerAfter = readFileSync(eventsPath, 'utf8')
    const plane = LocalDataPlane.open(root)
    let body: string
    try { body=plane.getProseChapter(1).body } finally { plane.close() }
    expect(first.status).toBe(200)
    expect(later.status).toBe(200)
    expect(replay.data.replayed).toBe(true)
    expect(body).toContain('新版 B')
    expect(ledgerAfter).toBe(ledgerBefore)
  })

  it('W3 同一成功 commit 的 HTTP 重试应回放原结果', async () => {
    const { root, revision } = makeBook()
    const base = await listen()
    const command = { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision, operationId: 'review_commit_retry', schemaVersion: 1 }
    const first = await post(base, '/api/chapter.commit', command)
    const retry = await post(base, '/api/chapter.commit', command)
    const record = readOperationRecord(root, 'review_commit_retry')
    expect(first.status, JSON.stringify(first)).toBe(200)
    expect(record?.state).toBe('succeeded')
    expect(retry.status, JSON.stringify(retry)).toBe(200)
    expect(retry.data.replayed).toBe(true)
    expect(retry.data.commitId).toBe(first.data.commitId)
  })

  it('W2 已确认 proposal 续接必须等已有跨进程书锁释放后才提交', async () => {
    const { root, bookId, revision } = makeBook()
    const base = await listen()
    createCanonProposal({ bus: new PublishBus(), bookRoot: root, taskRef: webCommitWindowTaskRef(1, revision), chapterIndex: 1, delta: { timelineEvent: [{ id: newTimelineEventId(), bookId, revision: 0, createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z', worldTimeLabel: '开篇', worldTimeOrder: 1, chapterIndex: 1, participants: [], summary: '合成事件', impactFactIds: [] }] } })
    const lockModuleUrl = pathToFileURL(join(process.cwd(), 'dist-server/platform/writerLock.js')).href
    const holderScript = 'import(' + JSON.stringify(lockModuleUrl) + ').then(async ({acquireBookWriteLock}) => {const lock=await acquireBookWriteLock(' + JSON.stringify(root) + ');console.log("HELD");setInterval(()=>{},1000)})'
    const child = spawn(process.execPath, ['-e', holderScript], { stdio: ['ignore','pipe','pipe'], windowsHide: true })
    let holderError = ''
    child.stderr?.on('data', (data) => { holderError += String(data) })
    if (child.stdout) {
      await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('holder exited: '+holderError+' module='+lockModuleUrl) })])
    }
    await expect(acquireBookWriteLock(root)).rejects.toMatchObject({ code: 'WRITER_LOCK_HELD' })
    let outcome: { status: number, data: Record<string, unknown> } | undefined
    let committedWhileHeld = false
    try {
      const pending = post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: revision }).then((v) => { outcome=v; return v })
      await Promise.race([pending, new Promise<void>((r) => setTimeout(r, 200))])
      const plane = LocalDataPlane.open(root)
      try { committedWhileHeld = plane.getProseChapter(1).phase === 'committed' } finally { plane.close() }
      child.kill(); await once(child, 'exit')
      await pending
      expect(committedWhileHeld).toBe(false)
      expect(outcome?.status, JSON.stringify(outcome)).toBe(200)
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit') } }
  })

  it('F02 活着的无关 PID 不应把历史 dataRoot 锁误判为现有墨舟实例', async () => {
    const root = rootDir('mozhou-independent-pid-')
    const child = spawn(process.execPath, ['-e', 'console.log("READY");setInterval(()=>{},1000)'], { stdio: ['ignore','pipe','pipe'], windowsHide: true })
    if (child.stdout) {
      await once(child.stdout, 'data')
    }
    const lockPath = join(root, '.mozhou_instance.lock')
    writeFileSync(lockPath, String(child.pid)+'\n')
    const lock = new DataRootProcessLock()
    let outcome: string
    try {
      try { lock.acquire(root); outcome = 'acquired' } catch (error) { outcome = (error as Error).message }
      expect(outcome).toBe('acquired')
    } finally { lock.release(); child.kill(); await once(child, 'exit') }
  })
})
