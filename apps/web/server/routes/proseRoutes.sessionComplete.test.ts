// @vitest-environment node
/**
 * 工单03（session 走完第 9/10 步）：/api/chapter.commit 会话窗口驱动 黑盒真实 HTTP 测试。
 *
 * 被测行为（ADR-0024 决策 4 的可观察证据）：作者把会话窗口走到 user_edit 及之后
 * （/api/session.advance + /api/chapter.review 驱动步 2-5），提交即沿十步收口窗口——
 * 步 6 runFinalExtract（web 提取器注入缝）→ 步 7 runContinuityGate（verdict 随步进
 * 事件进账）→ 步 8 提案步锚 → 步 9 markCommitted → 步 10 finish。走完的窗口不占
 * abandon 路径，第 10 步后单飞释放、下一章可开卷。
 *
 * 覆盖矩阵（工单验收）：
 *   1. 正常完成：1→10 全链走完（TaskStarted 在第 1 步）、verdict 进账、
 *      TaskFinished{succeeded}、单飞释放、下一章 session.open 200、同章可再重提交；
 *   2. 拒绝门禁：verdict='hard_conflict' 进账、窗口悬置（单飞仍被占）、正典零写入；
 *      崩溃恢复：作者改文再提交 → requestRework 回炉重走 → 从步边界续跑到完成
 *      （这是 ADR-0024 决策 4 唯一的可观察证据在 HTTP 层的形态）；
 *   3. 取消：abandon 仍是未走完窗口的出路（走了一半的窗口同样可作废）；
 *   4. 未行走窗口（prepare..review）保持既有作废收口：驱动面空转（driven=false），
 *      resubmitWindowCleanup.abandoned=true——「无行走」不伪装成「已驱动」。
 *
 * 提取缝打夹具（同 gate.test 技术，零模型调用）；审查走确定性规则策略（零模型调用）；
 * 编译走 runCompileStep（确定性检索 + 计数，零模型调用）。全程无收费 API。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newFactId, newKnowledgeStateId, newUlid, parseKnowledgeStateRow } from '@mozhou/kernel'
import type { BookId } from '@mozhou/kernel'
import type { ContextReceiptId } from '@mozhou/kernel'
import { LocalDataPlane, proseChapterPath, readNarrativeSnapshot, readProseChapter, scanEntityCards } from '@mozhou/data-plane'
import { runCompileStep } from '@mozhou/pipeline'

/** 提取缝夹具：每个用例先设定本次「模型提取产物」，再打请求。 */
const fixture: { result: DeltaExtractionResult | null } = vi.hoisted(() => ({ result: null }))

vi.mock('../analysis/deltaExtractor.js', () => ({
  extractChapterDelta: () => {
    if (fixture.result === null) {
      return Promise.reject(new Error('test fixture not set: extractor result missing'))
    }
    return Promise.resolve(fixture.result)
  },
}))

import { apiMiddleware } from '../api.js'
import type { DeltaExtractionResult } from '../analysis/deltaExtractor.js'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  fixture.result = null
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

/** 确定性规则策略（api.test 同款）：web 直连面无语义提供方，规则全确定性 → 零模型调用。 */
const DETERMINISTIC_POLICY = {
  schemaVersion: 1,
  projectId: 'web-session-drive-test',
  rules: [
    { id: 'PARA-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '段落瀑布', evidenceRequired: true, enabled: true },
    { id: 'REV-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '锚点一致', evidenceRequired: true, enabled: true },
  ],
  maxAutomaticReworks: 2,
}

/** 确定性 tokenizer（api.test 同款 fake-char）。 */
const charTok = { version: 'fake-char-v1', count: (text: string) => text.length }

/** 空批：等价「未配置 provider / 提取零候选」——走提交路由的无候选直提分支。 */
function emptyExtraction(): DeltaExtractionResult {
  return {
    appends: {},
    counts: { temporalFact: 0, knowledgeState: 0, relationshipState: 0, narrativePromise: 0, timelineEvent: 0 },
    dropped: [],
    extractor: 'none',
    reason: 'no provider (test fixture)',
  }
}

/** 冲突批：认知行引用悬空 factId（结构自证合法——坏的是引用，不是形状）。 */
function danglingKnowledgeExtraction(bookId: string): DeltaExtractionResult {
  const now = new Date().toISOString()
  const danglingRow = {
    id: newKnowledgeStateId(),
    bookId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    factId: newFactId(), // 格式合法但存量与批内都不存在 → 跨批悬空引用
    holder: 'protagonist',
    level: 'knows',
    knownSinceChapter: 1,
    provenance: { origin: 'ai', protectedUserContent: false },
  }
  parseKnowledgeStateRow(danglingRow)
  return {
    appends: { knowledgeState: [danglingRow] },
    counts: { temporalFact: 0, knowledgeState: 1, relationshipState: 0, narrativePromise: 0, timelineEvent: 0 },
    dropped: [],
    extractor: 'llm',
  }
}

/** 事件流里的任务行（PublishBus 格式 {seq, event}）。 */
function taskEvents(root: string): Record<string, unknown>[] {
  const raw = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
  const rows: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    const parsed = JSON.parse(line) as Record<string, unknown>
    const event = parsed['event']
    if (typeof event === 'object' && event !== null) rows.push(event as Record<string, unknown>)
  }
  return rows
}

/** 平铺行（无 seq 包装的顶层事件对象，如 commitChapter 的 ChapterCommitted）。 */
function flatEventsOf(root: string, type: string): Record<string, unknown>[] {
  const raw = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
  const rows: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    const parsed = JSON.parse(line) as Record<string, unknown>
    if (parsed['type'] === type && parsed['event'] === undefined) rows.push(parsed)
  }
  return rows
}

function eventsOf(root: string, taskRef: string, type: string): Record<string, unknown>[] {
  return taskEvents(root).filter((event) => event['taskRef'] === taskRef && event['type'] === type)
}

/**
 * 建书 + 首章定稿（无窗口平铺提交，与作者自然旅程一致）→ resubmit 开窗口 →
 * session.advance ×2（prepare→compile→draft）→ 真编译一次 → 确定性审查 pass →
 * session.advance（review→user_edit）。返回窗口 taskRef；驱动前提就位。
 */
async function makeBookWithWalkedWindow(title: string): Promise<{ base: string; root: string; bookId: string; taskRef: string }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-sessdone-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title, dir: root })
  expect(created.status).toBe(200)
  const bookId = String(created.data.bookId) as BookId
  const saved = await post(base, '/api/chapter.prose.save', {
    root, chapterIndex: 1, body: '陈缺推门而入，按剑伫立，眼神坚毅。', expectedRevision: null,
  })
  expect(saved.status).toBe(200)

  fixture.result = emptyExtraction()
  // 工单05 Contract Delta：提交携带作者所读 revision（保存响应回带的值）。
  const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '首稿定稿', expectedRevision: Number(saved.data.revision) })
  expect(committed.status).toBe(200)
  expect((committed.data.sessionWindow as Record<string, unknown>)).toMatchObject({ driven: false, taskRef: null })

  const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
  expect(resubmitted.status).toBe(200)
  const taskRef = String((resubmitted.data.resubmitSession as Record<string, unknown>)['taskRef'])

  // 步 1→3 光标行走（session.advance 自动步进到严格后继步）
  const toCompile = await post(base, '/api/session.advance', { root, chapterIndex: 1 })
  expect(toCompile.data).toMatchObject({ ok: true, previousStep: 'prepare', currentStep: 'compile' })
  const toDraft = await post(base, '/api/session.advance', { root, chapterIndex: 1 })
  expect(toDraft.data).toMatchObject({ ok: true, previousStep: 'compile', currentStep: 'draft' })

  // 步 3→4：真编译一次（评审锚点 D10 只认真编译凭证）+ 确定性审查 pass
  const plane = LocalDataPlane.open(root)
  try {
    plane.saveEntityCard('char:chenque', { name: '陈缺', aiContext: 'detected', brief: '孤城外按剑伫立的少年' })
  } finally {
    plane.close()
  }
  await runCompileStep(
    { chapterIndex: 1, staleMarker: null },
    {
      bookRoot: root,
      bookId,
      draftText: readProseChapter(root, proseChapterPath(1)).body,
      cards: scanEntityCards(root),
      snapshot: readNarrativeSnapshot(root),
      scope: { chapterIndex: 1, pov: 'protagonist' },
      modelProfile: { id: 'session-drive-test', contextWindow: 4096 },
      tokenizer: charTok,
      receiptId: ('rcpt_' + newUlid()) as ContextReceiptId,
      nowIso: '2026-09-28T00:00:00.000Z',
    },
  )
  const review = await post(base, '/api/chapter.review', { root, chapterIndex: 1, policy: DETERMINISTIC_POLICY })
  expect(review.status).toBe(200)
  expect(review.data.verdict).toBe('pass')

  // 步 4→5：review→user_edit（门禁守卫对 quality verdict='pass' 放行）
  const toUserEdit = await post(base, '/api/session.advance', { root, chapterIndex: 1 })
  expect(toUserEdit.data).toMatchObject({ ok: true, previousStep: 'review', currentStep: 'user_edit' })

  return { base, root, bookId, taskRef }
}

describe('POST /api/chapter.commit · 会话窗口驱动走完第 1→10 步（工单03）', () => {
  it('正常完成（无候选直提分支）：十步全链走完、verdict 进账、TaskFinished{succeeded}、单飞释放', async () => {
    const { base, root, taskRef } = await makeBookWithWalkedWindow('走完之书')
    fixture.result = emptyExtraction()

    // 工单05 Contract Delta：重提交后携带作者所读 revision（重开快照回带的值）。
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '重提交定稿', expectedRevision: Number(snap.data.revision) })
    expect(committed.status).toBe(200)
    expect(committed.data.phase).toBe('committed')
    expect(committed.data.sessionWindow).toMatchObject({ driven: true, taskRef, completed: true, errorDetail: null })
    // 走完的窗口不需要作废：清理面看到的是「无残留开放窗口」
    expect(committed.data.resubmitWindowCleanup).toMatchObject({ abandoned: false, taskRef: null, errorDetail: null })

    // 第 1 步落账：TaskStarted(step=prepare) 是本窗口第一条任务事件（不是第 9 步才开卷）
    const started = eventsOf(root, taskRef, 'TaskStarted')
    expect(started).toHaveLength(1)
    expect((started[0]!['payload'] as Record<string, unknown>)['step']).toBe('prepare')

    // 十步步进序列完整（步 1-5 走行走路径，步 6-10 走提交驱动路径）
    const transitions = eventsOf(root, taskRef, 'TaskStepTransitioned').map(
      (event) => (event['payload'] as Record<string, unknown>)['to'],
    )
    expect(transitions).toEqual([
      'compile', 'draft', 'review', 'user_edit',
      'final_extract', 'continuity_gate', 'canon_proposal', 'commit', 'flywheel_record',
    ])

    // 步 7 verdict 随步进事件 Result 字段进账
    const gateTransition = eventsOf(root, taskRef, 'TaskStepTransitioned').find(
      (event) => (event['payload'] as Record<string, unknown>)['to'] === 'continuity_gate',
    )
    expect((gateTransition!['payload'] as Record<string, unknown>)['verdict']).toBe('pass')

    // 步 6 步锚：runFinalExtract 以会话 taskRef 落账 CandidateDeltaExtracted
    expect(eventsOf(root, taskRef, 'CandidateDeltaExtracted')).toHaveLength(1)

    // 步 9/10：CanonCommitted + TaskFinished{succeeded}——零 abandoned 留痕
    expect(eventsOf(root, taskRef, 'CanonCommitted')).toHaveLength(1)
    const finished = eventsOf(root, taskRef, 'TaskFinished')
    expect(finished).toHaveLength(1)
    expect(finished[0]!['payload']).toMatchObject({ outcome: 'succeeded' })
    expect(taskEvents(root).some((event) => (event['payload'] as Record<string, unknown> | undefined)?.['outcome'] === 'abandoned')).toBe(false)

    // web_commit_* 窗口键形状不变：学习器窗口锚仍以 web_commit_ch<N>_rev<R> 落账
    // （基线提交 + 本次驱动提交各一条）
    const flywheel = taskEvents(root).filter((event) => event['type'] === 'FlywheelRecorded')
    expect(flywheel).toHaveLength(2)
    for (const row of flywheel) {
      expect(String(row['taskRef'])).toMatch(/^web_commit_ch1_rev\d+$/)
    }

    // 第 10 步后单飞释放：别章可开卷；同章也可再重提交（完成态单一事实源不挡新会话）。
    // ch2 的探针窗口先作废清场，否则 resubmit(ch1) 撞全局单飞。
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(200)
    expect((await post(base, '/api/session.abandon', { root, chapterIndex: 2 })).status).toBe(200)
    expect((await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })).status).toBe(200)
  })

  it('拒绝门禁：verdict=hard_conflict 进账、窗口悬置（单飞仍被占）、正典零写入', async () => {
    const { base, root, bookId, taskRef } = await makeBookWithWalkedWindow('悬置之书')
    const committedBefore = flatEventsOf(root, 'ChapterCommitted').length
    fixture.result = danglingKnowledgeExtraction(bookId)

    // 工单05 Contract Delta：携带当前所读 revision（门禁拒绝，不是版本失配）。
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const rejected = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: Number(snap.data.revision) })
    expect(rejected.status).toBe(409)
    expect(rejected.data.code).toBe('CONTINUITY_HARD_CONFLICT')
    expect((rejected.data.hardConflicts as unknown[]).length).toBe(1)

    // verdict 进账：continuity_gate 步进事件携带 hard_conflict（回炉判据读投影）
    const gateTransition = eventsOf(root, taskRef, 'TaskStepTransitioned').find(
      (event) => (event['payload'] as Record<string, unknown>)['to'] === 'continuity_gate',
    )
    expect((gateTransition!['payload'] as Record<string, unknown>)['verdict']).toBe('hard_conflict')

    // 正典零写入：相位未翻转、无新平铺提交行、无 CanonCommitted 任务行
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
    expect(flatEventsOf(root, 'ChapterCommitted')).toHaveLength(committedBefore)
    expect(eventsOf(root, taskRef, 'CanonCommitted')).toHaveLength(0)

    // 窗口悬置：单飞仍被占（别章开卷 409）——冲突不解锁，出路是显式回炉或作废
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(409)
  })

  it('崩溃恢复：悬置窗口经作者改文再提交 → requestRework 回炉重走 → 从步边界续跑到完成', async () => {
    const { base, root, bookId, taskRef } = await makeBookWithWalkedWindow('续跑之书')
    fixture.result = danglingKnowledgeExtraction(bookId)
    // 工单05 Contract Delta：携带当前所读 revision（门禁拒绝，不是版本失配）。
    const presnap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect((await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿', expectedRevision: Number(presnap.data.revision) })).status).toBe(409)

    // 作者承认错误改文（revision 前移），换上无候选提取，再次提交
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　改过的正文，无冲突。', expectedRevision: Number(snap.data.revision),
    })
    expect(saved.status).toBe(200)
    fixture.result = emptyExtraction()

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '改文定稿', expectedRevision: Number(saved.data.revision) })
    expect(committed.status).toBe(200)
    expect(committed.data.sessionWindow).toMatchObject({ driven: true, taskRef, completed: true, errorDetail: null })

    // 回炉边落账：continuity_gate → user_edit（S7 显式驱动，重提交即作者动作）
    const rework = eventsOf(root, taskRef, 'TaskStepTransitioned').find((event) => {
      const payload = event['payload'] as Record<string, unknown>
      return payload['from'] === 'continuity_gate' && payload['to'] === 'user_edit'
    })
    expect((rework!['payload'] as Record<string, unknown>)['reason']).toBe('hard_conflict_rework')

    // 从步边界续跑到完成：回炉后重走 final_extract→continuity_gate（pass）→…→flywheel_record
    const transitionsAfterRework = eventsOf(root, taskRef, 'TaskStepTransitioned')
      .filter((event) => (event['payload'] as Record<string, unknown>)['to'] === 'final_extract')
    expect(transitionsAfterRework.length).toBeGreaterThanOrEqual(1)
    const gateTransition = eventsOf(root, taskRef, 'TaskStepTransitioned').filter(
      (event) => (event['payload'] as Record<string, unknown>)['to'] === 'continuity_gate',
    )
    expect(gateTransition.length).toBeGreaterThanOrEqual(2) // 冲突一次 + 回炉后通过一次
    expect((gateTransition[gateTransition.length - 1]!['payload'] as Record<string, unknown>)['verdict']).toBe('pass')
    expect(eventsOf(root, taskRef, 'CanonCommitted')).toHaveLength(1)
    expect(eventsOf(root, taskRef, 'TaskFinished')[0]!['payload']).toMatchObject({ outcome: 'succeeded' })

    // 单飞释放
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(200)
  })

  it('取消：走到一半的窗口 abandon 仍是出路，TaskFinished{abandoned} 留痕、零 CanonCommitted', async () => {
    const { base, root, taskRef } = await makeBookWithWalkedWindow('取消之书')

    const abandoned = await post(base, '/api/session.abandon', { root, chapterIndex: 1, reason: 'author_changed_mind' })
    expect(abandoned.status).toBe(200)
    expect(abandoned.data).toMatchObject({ ok: true, abandoned: true, taskRef })

    const finished = eventsOf(root, taskRef, 'TaskFinished')
    expect(finished).toHaveLength(1)
    expect(finished[0]!['payload']).toMatchObject({ outcome: 'abandoned', reason: 'author_changed_mind' })
    expect(eventsOf(root, taskRef, 'CanonCommitted')).toHaveLength(0)
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(200)
  })

  it('未行走窗口（光标停在 prepare）保持既有作废收口：驱动面空转，driven=false', async () => {
    const base = await listen()
    const root = mkdtempSync(join(tmpdir(), 'mozhou-web-sessidle-'))
    roots.push(root)
    await post(base, '/api/book', { title: '未行走之书', dir: root })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　首稿。', expectedRevision: null,
    })
    expect(saved.status).toBe(200)

    // 基线平铺提交（resubmit 前置：章节必须 committed）
    fixture.result = emptyExtraction()
    const baseline = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '首稿定稿', expectedRevision: Number(saved.data.revision) })
    expect(baseline.status).toBe(200)

    // 重提交开窗口但作者不行走会话（光标停在 prepare）——今天的真实 web 旅程
    const resubmitted = await post(base, '/api/chapter.resubmit', { root, chapterIndex: 1 })
    expect(resubmitted.status).toBe(200)
    const staleTaskRef = String((resubmitted.data.resubmitSession as Record<string, unknown>)['taskRef'])

    fixture.result = emptyExtraction()
    // 工单05 Contract Delta：重提交后携带作者所读 revision（重开快照回带的值）。
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '重提交定稿', expectedRevision: Number(snap.data.revision) })
    expect(committed.status).toBe(200)
    // 驱动面如实呈报「未驱动」，窗口按既有语义就地作废
    expect(committed.data.sessionWindow).toMatchObject({ driven: false, taskRef: null, completed: false })
    expect(committed.data.resubmitWindowCleanup).toMatchObject({ abandoned: true, taskRef: staleTaskRef, errorDetail: null })
    const finished = eventsOf(root, staleTaskRef, 'TaskFinished')
    expect(finished[0]!['payload']).toMatchObject({ outcome: 'abandoned', reason: 'author_resubmitted' })
    expect(eventsOf(root, staleTaskRef, 'CanonCommitted')).toHaveLength(0)
    expect((await post(base, '/api/session.open', { root, chapterIndex: 2 })).status).toBe(200)
  })
})
