// @vitest-environment node
/**
 * 步 9 S9 重提交接线（POST /api/chapter.resubmit → requestResubmit）黑盒真实 HTTP 测试。
 *
 * 职责拆分（本项交付的边界）：
 *   - /api/chapter.reopen  = 作者编辑用的**可重复**底层重开（写前哈希 + ChapterReopened
 *     事件 + 基线刷新），**不开会话窗口**——它不得被重提交的会话语义污染；
 *   - /api/chapter.resubmit = S9 重提交：committed 前置守卫 → 新会话窗口（新 taskRef、
 *     光标 prepare、V1 十步全量重走）→ 重提交期间的真相锚（事件行锚，不读已翻 draft
 *     的正文文件）。
 *
 * 覆盖的不变量与失败路径：
 *   1. reopen 可重复（回归底线）：重开 → 改文 → 再定稿 → 再重开 恒 200；别章同样 200；
 *      reopen 不落任何 TaskStarted（不开窗口）；
 *   2. resubmit 正常路径：相位移回 draft、新 taskRef 落账、真相锚 sha256 与盘上定稿正文一致
 *      且不来自正文文件（此刻文件相位已 draft、commitId 已摘）；
 *   3. resubmit 非 committed（草稿）→ 409 CHAPTER_NOT_COMMITTED，零盘面副作用；
 *   4. resubmit 盘上无此章 → 404 CHAPTER_MISSING，零副作用；
 *   5. resubmit 外部改盘 → 409 PROSE_EXTERNAL_CHANGE，相位不翻转、零会话开卷（拒绝零副作用）；
 *   6. resubmit 单飞冲突（别章已占全局活动窗口）→ 409 RESUBMIT_SESSION_CONFLICT，
 *      被重提交章保持 committed（守卫先于翻相位）；
 *   7. resubmit 账实不符（相位 committed 但事件流无匹配 ChapterCommitted 锚）→ 500，
 *      相位未翻、窗口未开、绝不返回假真相锚；
 *   8. 拒绝路径不留孤儿窗口（不变量）：被拒的 resubmit 之后别章 /api/session.open 仍 200，
 *      同章修好外部改动后重试仍 200——「拒绝零副作用」是可重试性的前提；
 *   9. 成功重提交不挡作者 reopen 旅程（不变量）：重提交窗口占的是会话单飞，reopen 走
 *      数据平面相位机、与会话账本解耦，故别章 reopen 仍 200；
 *  10. 平面句柄即用即关（不变量）：成功与失败路径都 close() 掉本次开的 LocalDataPlane。
 *
 * 已知依赖（**故意不写成不变量**）：成功重提交开出的会话窗口按 S9 由本会话第 9 步
 * CanonCommitted 或 TaskFinished 闭合，而 web 侧当前只有 session.open/advance/review/
 * rework 面，没有会话内 commit/finish 路由（apps/web 全仓无 markCommitted/finish 调用；
 * /api/session.advance 也不携带门禁 verdict，故 continuity_gate→canon_proposal 恒被
 * GateNotPassedError 拒绝）——即该窗口在 web 可达路径上无法闭合，占住全局单飞后
 * 别章 /api/session.open 恒 409。此处不写「窗口粘滞」断言（把缺陷写成不变量等于写进
 * 契约），该依赖记录在实现报告的 escalation/caveats。
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-resubmit-'))
  roots.push(dir)
  await post(base, '/api/book', { title: '重提交接线测试书', dir })
  return { base, root: dir }
}

/** 直接经数据平面提交一章（与既有 proseRoutes 用例同款夹具：写 ChapterCommitted 事件行）。 */
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

/** 事件流里的任务行（PublishBus 格式 {seq, event}）——用于断言会话窗口是否真的开了。 */
function taskRows(root: string): Record<string, unknown>[] {
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

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

describe('POST /api/chapter.reopen · 作者编辑用重开保持可重复（本项不得引入回归）', () => {
  it('重开 → 改文 → 再定稿 → 再重开：同章两次都 200；别章同样 200；reopen 不开会话窗口', async () => {
    const { base, root } = await makeBook()
    const first = commitChapter(root, 1)

    const reopen1 = await post(base, '/api/chapter.reopen', { root, chapterIndex: 1 })
    expect(reopen1.status).toBe(200)
    expect(reopen1.data.reopenedFromCommitId).toBe(first.commitId)
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
    // reopen 是底层重开，不落任何会话开卷
    expect(taskRows(root).filter((event) => event['type'] === 'TaskStarted')).toHaveLength(0)

    // 作者改文并经 web 提交路径再定稿
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '重开后的新草稿。', expectedRevision: Number(snap.data.revision),
    })
    expect(saved.status).toBe(200)
    const recommitted = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '再定稿' })
    expect(recommitted.status).toBe(200)
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed')

    // 同章第二次重开仍 200（这正是被会话窗口毒化时会失效的路径）
    const reopen2 = await post(base, '/api/chapter.reopen', { root, chapterIndex: 1 })
    expect(reopen2.status).toBe(200)
    expect(reopen2.data.reopenedFromCommitId).toBe(recommitted.data.commitId)

    // 别章重开也 200（无全局单飞占用）
    commitChapter(root, 2, 'CHAPTER TWO\n')
    const other = await post(base, '/api/chapter.reopen', { root, chapterIndex: 2 })
    expect(other.status).toBe(200)
    expect(readProseChapter(root, proseChapterPath(2)).phase).toBe('draft')
    // 全程零会话开卷：reopen 与 S9 会话窗口彻底解耦
    expect(taskRows(root).filter((event) => event['type'] === 'TaskStarted')).toHaveLength(0)
  })
})

describe('POST /api/chapter.resubmit · 步 9 S9 重提交（守卫 / 新会话窗口 / 真相锚）', () => {
  it('committed 章：翻回 draft + 开新会话窗口 + 返回事件行真相锚（锚不来自已翻 draft 的正文文件）', async () => {
    const { base, root } = await makeBook()
    const commit = commitChapter(root)

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(200)
    expect(resubmitted.data.ok).toBe(true)
    expect(resubmitted.data.reopenedFromCommitId).toBe(commit.commitId)

    // 相位移回 draft（S9）——旧 commit 的定稿内容保留（I5：只增不改）
    const scan = readProseChapter(root, proseChapterPath(1))
    expect(scan.phase).toBe('draft')
    expect(scan.body).toBe(FINAL)

    // 真相锚：来自 ChapterCommitted 事件行，contentSha256 = 盘上定稿正文的 sha256
    const anchor = resubmitted.data.truthAnchor as Record<string, unknown>
    expect(anchor['commitId']).toBe(commit.commitId)
    expect(anchor['proseRelPath']).toBe(proseChapterPath(1))
    expect(anchor['contentSha256']).toBe(commit.contentSha256)
    expect(anchor['contentSha256']).toBe(sha256(FINAL))
    // ……而正文文件此刻已无 commitId（相位 draft）⇒ 锚只可能来自事件行，不可能来自文件
    expect(scan.commitId).toBeUndefined()
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(snap.data.phase).toBe('draft')
    expect(snap.data.commitId).toBeUndefined()

    // 新会话窗口真落账：新 taskRef + TaskStarted(step=prepare)
    const session = resubmitted.data.resubmitSession as Record<string, unknown>
    const taskRef = session['taskRef']
    expect(typeof taskRef).toBe('string')
    expect(session['currentStep']).toBe('prepare')
    const started = taskRows(root).filter((event) => event['type'] === 'TaskStarted')
    expect(started.map((event) => event['taskRef'])).toContain(taskRef)
    expect((started.find((event) => event['taskRef'] === taskRef)?.['payload'] as Record<string, unknown>)['step']).toBe('prepare')

    // I5：旧 commit 的审计行原样在账（append-only）
    expect(readFileSync(join(root, RUNTIME_EVENTS_PATH), 'utf8')).toContain(commit.commitId)
  })

  it('草稿章：409 CHAPTER_NOT_COMMITTED 且零盘面副作用（守卫先于开卷/翻相位）', async () => {
    const { base, root } = await makeBook()
    const saved = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '草稿正文。', expectedRevision: null })
    expect(saved.status).toBe(200)
    const before = readFileSync(join(root, proseChapterPath(1)), 'utf8')

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(409)
    expect(resubmitted.data.code).toBe('CHAPTER_NOT_COMMITTED')
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(before)
    expect(taskRows(root).filter((event) => event['type'] === 'TaskStarted')).toHaveLength(0)
  })

  it('盘上无此章：404 CHAPTER_MISSING 且零副作用', async () => {
    const { base, root } = await makeBook()
    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 7 })
    expect(resubmitted.status).toBe(404)
    expect(resubmitted.data.code).toBe('CHAPTER_MISSING')
    expect(taskRows(root).filter((event) => event['type'] === 'TaskStarted')).toHaveLength(0)
  })

  it('外部改盘：409 PROSE_EXTERNAL_CHANGE，相位不翻转、文件不变、零会话开卷（拒绝零副作用）', async () => {
    const { base, root } = await makeBook()
    commitChapter(root)
    const file = join(root, proseChapterPath(1))
    writeFileSync(file, readFileSync(file, 'utf8').replace('FINAL AUTHOR CONTENT', 'EXTERNAL TAMPER'))

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(409)
    expect(resubmitted.data.code).toBe('PROSE_EXTERNAL_CHANGE')
    expect(readFileSync(file, 'utf8')).toContain('EXTERNAL TAMPER')
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed') // 相位未翻
    // 写前哈希失配在 reopenChapter 内、任何写入之前抛出 ⇒ 不留孤儿窗口
    expect(taskRows(root).filter((event) => event['type'] === 'TaskStarted')).toHaveLength(0)
  })

  it('平面句柄即用即关：成功与失败路径都 close() 掉本次开的 LocalDataPlane（每请求一个连接）', async () => {
    const { base, root } = await makeBook()
    commitChapter(root)
    const tampered = await makeBook()
    commitChapter(tampered.root)
    const tamperedFile = join(tampered.root, proseChapterPath(1))
    writeFileSync(tamperedFile, readFileSync(tamperedFile, 'utf8').replace('FINAL AUTHOR CONTENT', 'EXTERNAL TAMPER'))

    // LocalDataPlane.open 每次新建一个 better-sqlite3 连接（local-data-plane.ts:107-121），
    // 只有 close()（local-data-plane.ts:401-404）释放——故「用完即关」必须可观测。
    const openSpy = vi.spyOn(LocalDataPlane, 'open')
    const closeSpy = vi.spyOn(LocalDataPlane.prototype, 'close')
    try {
      const ok = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
      expect(ok.status).toBe(200)
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy.mock.instances[0]).toBe(openSpy.mock.results[0]?.value)

      // 失败路径（写前哈希失配）同样在 finally 里关掉，不因异常漏关
      openSpy.mockClear()
      closeSpy.mockClear()
      const rejected = await post(tampered.base, '/api/chapter.resubmit', { root: tampered.root, chapterIndex: 1 })
      expect(rejected.status).toBe(409)
      expect(rejected.data.code).toBe('PROSE_EXTERNAL_CHANGE')
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy.mock.instances[0]).toBe(openSpy.mock.results[0]?.value)
    } finally {
      openSpy.mockRestore()
      closeSpy.mockRestore()
    }
  })

  it('不变量：成功重提交不挡作者 reopen 旅程（reopen 与会话账本解耦）——别章 reopen 仍 200', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1, FINAL)
    commitChapter(root, 2, 'CHAPTER TWO\n')
    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(200)

    // 重提交窗口占的是会话单飞；reopen 走数据平面相位机、不查会话账本 ⇒ 作者编辑旅程不受影响
    const other = await post(base, '/api/chapter.reopen', { root, chapterIndex: 2 })
    expect(other.status).toBe(200)
    expect(readProseChapter(root, proseChapterPath(2)).phase).toBe('draft')
  })

  it('被拒的重提交不留孤儿窗口：失败后别章 /api/session.open 不被全局单飞挡住', async () => {
    const { base, root } = await makeBook()
    commitChapter(root)
    const file = join(root, proseChapterPath(1))
    writeFileSync(file, readFileSync(file, 'utf8').replace('FINAL AUTHOR CONTENT', 'EXTERNAL TAMPER'))

    const rejected = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(rejected.status).toBe(409)
    expect(rejected.data.code).toBe('PROSE_EXTERNAL_CHANGE')

    // 判据前移 ⇒ 被拒的调用没有落 TaskStarted；全局单飞仍空闲
    const opened = await post(base, '/api/session.open', { root, chapterIndex: 3 })
    expect(opened.status).toBe(200)
  })

  it('被拒的重提交可重试：修好外部改动后同章重提交 200（不被 SessionAlreadyActive 挡死）', async () => {
    const { base, root } = await makeBook()
    const commit = commitChapter(root)
    const file = join(root, proseChapterPath(1))
    const pristine = readFileSync(file, 'utf8')
    writeFileSync(file, pristine.replace('FINAL AUTHOR CONTENT', 'EXTERNAL TAMPER'))

    const rejected = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(rejected.status).toBe(409)

    writeFileSync(file, pristine)
    const retried = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(retried.status).toBe(200)
    expect(retried.data.reopenedFromCommitId).toBe(commit.commitId)
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
  })

  it('别章占用全局单飞：409 RESUBMIT_SESSION_CONFLICT，被重提交章保持 committed（零副作用）', async () => {
    const { base, root } = await makeBook()
    commitChapter(root, 1)
    const other = await post(base, '/api/session.open', { root, chapterIndex: 2 })
    expect(other.status).toBe(200)

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(409)
    expect(resubmitted.data.code).toBe('RESUBMIT_SESSION_CONFLICT')
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed')
  })

  it('账实不符：相位 committed 但事件流无匹配 ChapterCommitted 锚 → 500，相位未翻、窗口未开、绝不返回假锚', async () => {
    const { base, root } = await makeBook()
    const commit = commitChapter(root)
    // 抹掉事件流里的 ChapterCommitted 行（审计残渣被外部清理的真实形态）——
    // 正文相位仍是 committed，但真相锚已无处可读。
    const eventsPath = join(root, RUNTIME_EVENTS_PATH)
    const kept = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.includes('"ChapterCommitted"'))
    writeFileSync(eventsPath, kept.join('\n') + '\n')

    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(500)
    expect(String(resubmitted.data.error)).toContain('ledger/prose inconsistent')
    expect(resubmitted.data.truthAnchor).toBeUndefined()
    expect(resubmitted.data.commitId).toBeUndefined()
    // 真相锚预检在任何写入之前 ⇒ 客户端看到失败时盘面确实没动过
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('committed')
    expect(taskRows(root).filter((event) => event['type'] === 'TaskStarted')).toHaveLength(0)
    expect(commit.commitId).not.toBe('')
  })
})
