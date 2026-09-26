// @vitest-environment node
/**
 * S9 收口黑盒真实 HTTP 测试（POST /api/session.abandon + /api/chapter.commit 的自动收口）。
 *
 * 被测行为：会话窗口靠「作废」而非「完成」闭合——发布 TaskFinished{outcome:'abandoned'}，
 * 释放 V1 全局单飞，绝不发 CanonCommitted（完成态语义不动）。两条路径：
 *   - 显式入口 POST /api/session.abandon（作者/运维主动清挂起窗口）；
 *   - 自动收口：作者经 POST /api/chapter.commit 重新定稿后，该章残留窗口就地作废。
 *
 * 覆盖的不变量与失败路径：
 *   1. 核心验收：resubmit 开窗口 → 别章 session.open 409（单飞被占）→ abandon →
 *      别章 session.open 200（锁真正释放）；
 *   2. 不残留锁：abandon 后同章再定稿 → 再次 resubmit 200（不被 SessionAlreadyActive 挡死）；
 *   3. 作者自然流程：resubmit → 改文 → 提交 之后本章无残留活动窗口（提交响应
 *      resubmitWindowCleanup.abandoned=true，且别章 session.open 恢复 200）；
 *   4. 无窗口提交是正常路径：resubmitWindowCleanup.abandoned=false，零多余 TaskFinished；
 *   5. abandon 幂等：无窗口 / 窗口属别章 ⇒ 200 abandoned:false 空操作，别章窗口不动；
 *   6. 形状非法：缺 root/chapterIndex、显式空 reason ⇒ 400（零落账）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { LocalDataPlane, RUNTIME_EVENTS_PATH, proseChapterPath, readProseChapter } from '@mozhou/data-plane'

const FINAL = 'FINAL AUTHOR CONTENT\n'

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
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf') })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      resolve('http://127.0.0.1:' + (server.address() as AddressInfo).port)
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

async function makeBook(): Promise<{ base: string; root: string }> {
  const base = await listen()
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-abandon-'))
  roots.push(dir)
  await post(base, '/api/book', { title: '作废收口测试书', dir })
  return { base, root: dir }
}

/** 直接经数据平面提交一章（与既有 resubmit 用例同款夹具：写平铺 ChapterCommitted 行）。 */
function commitChapter(root: string, chapterIndex = 1, prose = FINAL): { commitId: string; contentSha256: string } {
  const plane = LocalDataPlane.openOrRebuild(root)
  try {
    plane.createChapterDraft({ chapterIndex, title: 'One' })
    const result = plane.commitChapter({ chapterIndex, summary: '定稿', finalProse: prose })
    return { commitId: result.commitId, contentSha256: result.contentSha256 }
  } finally {
    plane.close()
  }
}

/** 已是 draft 的章再定稿（不建章）——用于「重提交 → 改文 → 再定稿」序列。 */
function recommitDraft(root: string, chapterIndex = 1, prose = FINAL): void {
  const plane = LocalDataPlane.openOrRebuild(root)
  try {
    plane.commitChapter({ chapterIndex, summary: '再定稿', finalProse: prose })
  } finally {
    plane.close()
  }
}

/** 事件流里的任务行（PublishBus 格式 {seq, event}）——用于断言窗口开/闭与作废留痕。 */
function taskEvents(root: string): Record<string, unknown>[] {
  const raw = readFileSync(join(root, RUNTIME_EVENTS_PATH), 'utf8')
  const rows: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    const parsed = JSON.parse(line) as Record<string, unknown>
    const event = parsed['event']
    if (typeof event === 'object' && event !== null) rows.push(event as Record<string, unknown>)
  }
  return rows
}

function abandonEvents(root: string): Record<string, unknown>[] {
  return taskEvents(root).filter(
    (event) =>
      event['type'] === 'TaskFinished' &&
      (event['payload'] as Record<string, unknown> | undefined)?.['outcome'] === 'abandoned',
  )
}

describe('POST /api/session.abandon · 显式作废释放全局单飞（核心验收）', () => {
  it('resubmit 开窗口 → 别章 session.open 409 → abandon → 别章 session.open 200', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1)
    commitChapter(root, 2, 'CHAPTER TWO\n')

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(200)
    const taskRef = (resubmitted.data.resubmitSession as Record<string, unknown>)['taskRef']
    expect(typeof taskRef).toBe('string')

    // 窗口占住 V1 全局单飞：别章开卷被拒（作废前的死锁形态）
    const blocked = await post(base, '/api/session.open', { root, chapterIndex: 2 })
    expect(blocked.status).toBe(409)

    // 显式作废本章挂起窗口
    const abandoned = await post(base, '/api/session.abandon', { root, chapterIndex: 1 })
    expect(abandoned.status).toBe(200)
    expect(abandoned.data).toMatchObject({ ok: true, abandoned: true, taskRef, chapterIndex: 1 })
    // 留痕可观测：TaskFinished{outcome:'abandoned'} 落账
    const traces = abandonEvents(root)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ taskRef, chapterIndex: 1, payload: { outcome: 'abandoned', reason: 'author_abandoned' } })
    // 作废绝不发 CanonCommitted
    expect(taskEvents(root).some((event) => event['type'] === 'CanonCommitted')).toBe(false)

    // 单飞真正释放：别章开卷恢复 200
    const reopened = await post(base, '/api/session.open', { root, chapterIndex: 2 })
    expect(reopened.status).toBe(200)
  })

  it('不残留锁：abandon 后再定稿，同章再次 resubmit 200（不被 SessionAlreadyActive 挡死）', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1)

    const first = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(first.status).toBe(200)
    const abandoned = await post(base, '/api/session.abandon', { root, chapterIndex: 1 })
    expect(abandoned.status).toBe(200)
    expect(abandoned.data.abandoned).toBe(true)

    // 作者改文并再定稿（数据面：本章回到 committed）
    recommitDraft(root, 1, 'REVISED FINAL\n')
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed')

    const again = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(again.status).toBe(200)
    expect(again.data.reopenedFromCommitId).toBeDefined()
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
  })

  it('幂等：无窗口 / 窗口属别章 ⇒ 200 abandoned:false 空操作，别章窗口不动', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1)
    commitChapter(root, 2, 'CHAPTER TWO\n')

    // 无任何窗口：空操作
    const none = await post(base, '/api/session.abandon', { root, chapterIndex: 1 })
    expect(none.status).toBe(200)
    expect(none.data).toMatchObject({ ok: true, abandoned: false, taskRef: null })

    // 窗口属别章（ch2）：对 ch1 作废是空操作，ch2 窗口原封不动
    const other = await post(base, '/api/session.open', { root, chapterIndex: 2 })
    expect(other.status).toBe(200)
    const otherTaskRef = other.data.taskRef
    const noop = await post(base, '/api/session.abandon', { root, chapterIndex: 1 })
    expect(noop.status).toBe(200)
    expect(noop.data).toMatchObject({ ok: true, abandoned: false, taskRef: null })
    // ch2 窗口仍在（别章 session.open 仍 409；对 ch2 作废才返回其 taskRef）
    expect((await post(base, '/api/session.open', { root, chapterIndex: 3 })).status).toBe(409)
    const own = await post(base, '/api/session.abandon', { root, chapterIndex: 2 })
    expect(own.status).toBe(200)
    expect(own.data).toMatchObject({ ok: true, abandoned: true, taskRef: otherTaskRef })
    expect(abandonEvents(root)).toHaveLength(1)
  })

  it('形状非法：缺 root/chapterIndex、显式空 reason ⇒ 400 且零落账', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1)
    await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })

    expect((await post(base, '/api/session.abandon', { chapterIndex: 1 })).status).toBe(400)
    expect((await post(base, '/api/session.abandon', { root })).status).toBe(400)
    expect((await post(base, '/api/session.abandon', { root, chapterIndex: 1, reason: '   ' })).status).toBe(400)
    // 非法请求零落账：作废窗口仍开着（对别章 session.open 仍 409）
    expect(abandonEvents(root)).toHaveLength(0)
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(409)
  })
})

describe('POST /api/chapter.commit · 作者重新定稿自动收口陈旧重提交窗口', () => {
  it('resubmit → 改文 → 提交：本章无残留活动窗口，别章 session.open 恢复 200', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1)
    commitChapter(root, 2, 'CHAPTER TWO\n')

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(200)
    const staleTaskRef = (resubmitted.data.resubmitSession as Record<string, unknown>)['taskRef']
    // 窗口开着：别章开卷 409
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(409)

    // 作者改文（重提交已把相位翻回 draft，可直接保存）
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '重提交后的新定稿。', expectedRevision: Number(snap.data.revision),
    })
    expect(saved.status).toBe(200)

    // 提交：出口自动作废陈旧窗口
    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '重提交定稿' })
    expect(committed.status).toBe(200)
    expect(committed.data.resubmitWindowCleanup).toMatchObject({
      abandoned: true,
      taskRef: staleTaskRef,
      errorDetail: null,
    })
    // 留痕：TaskFinished{outcome:'abandoned', reason:'author_resubmitted'}
    const traces = abandonEvents(root)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      taskRef: staleTaskRef,
      chapterIndex: 1,
      payload: { outcome: 'abandoned', reason: 'author_resubmitted' },
    })
    // 本章无残留活动窗口：别章开卷恢复 200
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(200)
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed')
  })

  it('正常提交（无重提交窗口）：abandoned=false，零多余 TaskFinished', async () => {
    const { base, root } = await makeBook()
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '首稿。', expectedRevision: null,
    })
    expect(saved.status).toBe(200)

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '首稿定稿' })
    expect(committed.status).toBe(200)
    expect(committed.data.resubmitWindowCleanup).toMatchObject({ abandoned: false, taskRef: null, errorDetail: null })
    // 无窗口可作废 ⇒ 不落任何 TaskFinished（零噪声）
    expect(taskEvents(root).filter((event) => event['type'] === 'TaskFinished')).toHaveLength(0)
    expect(snap.data.exists).toBe(false)
  })
})
