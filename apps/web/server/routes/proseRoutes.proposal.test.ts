// @vitest-environment node
/**
 * 步 8 Canon Proposal 接线回归（chapter-pipeline-spec §1 表第 8 行 / S6）。
 *
 * 被测行为（一条完整数据流，从提交入口到正典落盘）：
 *   1. POST /api/chapter.commit 把通过 Gate 的 delta 交给 createCanonProposal 定档，
 *      不再全量直写 commitChapter；提案记录落 .mozhou/proposals/（跨重启待决凭据）；
 *   2. 待决（medium/high）⇒ 409 CANON_PROPOSAL_PENDING，相位不翻转、正典零写入；
 *   3. POST /api/proposal.decide 经 ProposalPort 逐条 confirm/reject/editAccept；
 *   4. 重提提交续接同一提案（不重跑提取），Commit 只写已确认集；
 *   5. 正文改过（revision 变）⇒ 409 CANON_PROPOSAL_STALE，旧提案不被静默丢弃。
 *
 * 提取缝在本文件内被替换为夹具（真实归一语义归 deltaExtractor.test.ts）——夹具行由
 * 真实 normalizeDelta 产出并自证 dropped 为空，否则「分流档位」与「行形状本就坏」
 * 无法区分，测试就失去证伪力。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RUNTIME_PROPOSALS_DIR, LocalDataPlane, proseChapterPath } from '@mozhou/data-plane'

/** 提取缝夹具：每个用例先设定本次「模型提取产物」，calls 用于证明续接路径未重跑提取。 */
const fixture = vi.hoisted(() => ({ result: null as DeltaExtractionResult | null, calls: 0 }))

vi.mock('../analysis/deltaExtractor.js', () => ({
  // 同步夹具：路由侧 `await` 非 Promise 值同样成立（提取缝是显式注入点，形状由调用方约定）
  extractChapterDelta: () => {
    fixture.calls += 1
    if (fixture.result === null) throw new Error('test fixture not set: extractor result missing')
    return fixture.result
  },
}))

import { apiMiddleware } from '../api.js'
import type { DeltaExtractionResult } from '../analysis/deltaExtractor.js'

let normalizeDelta: typeof import('../analysis/deltaExtractor.js').normalizeDelta

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('../analysis/deltaExtractor.js')>('../analysis/deltaExtractor.js')
  normalizeDelta = actual.normalizeDelta
})

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  fixture.result = null
  fixture.calls = 0
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

async function makeDraftChapter(): Promise<{ base: string; root: string; bookId: string }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-proposal-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '提案接线测试书', dir: root })
  expect(created.status).toBe(200)
  const saved = await post(base, '/api/chapter.prose.save', {
    root, chapterIndex: 1, body: '　　中平元年，黄巾起事。', expectedRevision: null,
  })
  expect(saved.status).toBe(200)
  return { base, root, bookId: String(created.data.bookId) }
}

function tracking(root: string, name: string): string {
  return join(root, '追踪', name)
}

/** 追踪流实际写入行（空文件=0 行；`''.split` 的假一行会让断言失真）。 */
function trackingLines(root: string, name: string): string[] {
  return readFileSync(tracking(root, name), 'utf8').trim().split('\n').filter((line) => line.length > 0)
}

/** 提案仓盘上记录（未确认提案跨重启待决的唯一凭据）。 */
function proposalFiles(root: string): string[] {
  const dir = join(root, RUNTIME_PROPOSALS_DIR)
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : []
}

interface ProposalView {
  readonly proposalId: string
  readonly state: 'open' | 'consumed'
  readonly pendingCount: number
  readonly routed: { readonly low: number; readonly medium: number; readonly high: number }
  readonly items: readonly {
    readonly itemId: string
    readonly family: string
    readonly riskClass: string
    readonly state: string
    readonly row: Record<string, unknown>
  }[]
}

function proposalOf(data: Record<string, unknown>): ProposalView {
  // 挂起/续接响应把视图放在 proposal（含待决条目），提交成功响应放在 canonProposal
  return (data['canonProposal'] ?? data['proposal']) as ProposalView
}

/** 挂起/拒绝后必须成立的不变量：相位未翻转、五族零写入、无提交事件行。 */
function assertCanonUntouched(root: string): void {
  const prose = readFileSync(join(root, proseChapterPath(1)), 'utf8')
  expect(prose).toContain('phase: draft')
  expect(prose).not.toContain('commitId')
  for (const name of ['事实.jsonl', '认知.jsonl', '关系.jsonl', '伏笔.jsonl', '时间线.jsonl']) {
    expect(trackingLines(root, name)).toHaveLength(0)
  }
  const events = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
  expect(events).not.toContain('"type":"ChapterCommitted"')
  expect(events).not.toContain('"type":"CanonCommitted"')
}

/** 真实提取产物：low 事实 + 授权认知 + 时间线（全 low）+ 关系（恒 medium）+ 伏笔（非兑现位 ⇒ medium）。 */
function mediumExtraction(bookId: string): DeltaExtractionResult {
  const result = normalizeDelta(
    {
      facts: [{ subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' }],
      knowledge: [{ factIndex: 0, holder: 'protagonist', level: 'knows' }],
      relationships: [{ entityA: 'char:liu-bei', entityB: 'char:guan-yu', relationshipType: '结义兄弟', affinityScore: 80 }],
      promises: [{ type: 'foreshadowing', description: '断剑的来历', targetChapter: null }],
      timeline: [{ worldTimeLabel: '中平元年', summary: '黄巾起事', participants: ['char:liu-bei'], impactFactIndexes: [0] }],
    },
    { bookId, chapterIndex: 1, liveMaxOrder: 0 },
  )
  expect(result.dropped).toEqual([])
  return result
}

/** 真实提取产物：secret 谓词（归一即抬到 high）+ reader 披露行（Gate 零泄漏核检的授权凭据）。 */
function secretExtraction(bookId: string): DeltaExtractionResult {
  const result = normalizeDelta(
    {
      facts: [{ subject: 'char:liu-bei', predicate: 'secret.identity', value: '汉室宗亲', importance: 'critical', riskClass: 'low' }],
      knowledge: [{ factIndex: 0, holder: 'reader', level: 'knows' }],
    },
    { bookId, chapterIndex: 1, liveMaxOrder: 0 },
  )
  expect(result.dropped).toEqual([])
  // Q7：secret.* 与 riskClass='high' 同现（模型给 low 也按纪律抬起）
  expect((result.appends['temporalFact'] as { riskClass: string }[])[0]!.riskClass).toBe('high')
  return result
}

describe('POST /api/chapter.commit · 步 8 Canon Proposal 分流与挂起', () => {
  it('medium 待决：409 CANON_PROPOSAL_PENDING，提案落盘、正典零写入、相位不翻转', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)

    const { status, data } = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })

    expect(status).toBe(409)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('CANON_PROPOSAL_PENDING')
    const proposal = proposalOf(data)
    // 分流明细：三条 low 自动确认、关系与伏笔两条挂起（未确认即入 canon 才是缺口）
    expect(proposal.routed).toEqual({ low: 3, medium: 2, high: 0 })
    expect(proposal.pendingCount).toBe(2)
    expect((data.pendingItems as { itemId: string }[]).map((item) => item.itemId).sort()).toEqual([
      'narrativePromise#0',
      'relationshipState#0',
    ])
    // 挂起也要让作者看出「这次提取了什么」
    expect((data.deltaExtraction as { counts: Record<string, number> }).counts['relationshipState']).toBe(1)

    assertCanonUntouched(root)
    // 未决提案跨重启待决的盘面凭据（S8 Proposal 后行）
    const files = proposalFiles(root)
    expect(files).toHaveLength(1)
    const onDisk = JSON.parse(readFileSync(join(root, RUNTIME_PROPOSALS_DIR, files[0]!), 'utf8')) as ProposalView
    expect(onDisk.proposalId).toBe(proposal.proposalId)
    expect(onDisk.state).toBe('open')
    expect(onDisk.items.filter((item) => item.state === 'pending')).toHaveLength(2)
    expect(onDisk.items.filter((item) => item.state === 'confirmed')).toHaveLength(3)
    // 成对头已开、未闭合（悬挂 = 待决的账面标记）
    const events = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    expect(events).toContain('"type":"CanonProposalCreated"')
  })

  it('high 待决：secret 事实无显式确认不进正典；确认后提交，正典含该行且 POV 视角不可见', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = secretExtraction(bookId)

    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(suspended.status).toBe(409)
    expect(suspended.data.code).toBe('CANON_PROPOSAL_PENDING')
    const proposal = proposalOf(suspended.data)
    expect(proposal.routed).toEqual({ low: 0, medium: 0, high: 2 })
    expect((suspended.data.pendingItems as { riskClass: string }[]).every((item) => item.riskClass === 'high')).toBe(true)
    assertCanonUntouched(root)

    // 逐条显式确认（ProposalPort 三动词经队列 API 暴露）
    for (const itemId of ['temporalFact#0', 'knowledgeState#0']) {
      const decided = await post(base, '/api/proposal.decide', {
        root, proposalId: proposal.proposalId, itemId, action: 'confirm',
      })
      expect(decided.status).toBe(200)
      expect(decided.data.action).toBe('confirmed')
    }

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)
    expect(committed.data.phase).toBe('committed')
    expect(proposalOf(committed.data).state).toBe('consumed')
    expect(proposalOf(committed.data).pendingCount).toBe(0)

    const facts = trackingLines(root, '事实.jsonl')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toContain('secret.identity')
    // 零泄漏不变量：reader 披露不等于 protagonist 可见（写进正典 ≠ 泄漏给视角）
    const plane = LocalDataPlane.open(root)
    try {
      const visible = plane.queryActiveFacts({ chapter: 1, pov: 'protagonist' }).map((fact) => fact.predicate)
      expect(visible).not.toContain('secret.identity')
    } finally {
      plane.close()
    }
  })

  it('续接路径：重提提交复用同一提案（不重跑提取），确认集逐条决定后写入正典', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)

    const first = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(first.status).toBe(409)
    expect(fixture.calls).toBe(1)
    const firstId = proposalOf(first.data).proposalId

    // 未决时重提：同一提案、同一待决面，提取不再跑（否则新行 id 与作者已确认的行对不上）
    const again = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(again.status).toBe(409)
    expect(again.data.code).toBe('CANON_PROPOSAL_PENDING')
    expect(proposalOf(again.data).proposalId).toBe(firstId)
    expect(fixture.calls).toBe(1)
    expect(proposalFiles(root)).toHaveLength(1)

    // 关系 confirm 原样入集；伏笔 editAccept 以 patch 顶层浅合并后的载荷入集
    const confirmed = await post(base, '/api/proposal.decide', {
      root, proposalId: firstId, itemId: 'relationshipState#0', action: 'confirm',
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.data.finalized).toBe(false)
    const edited = await post(base, '/api/proposal.decide', {
      root, proposalId: firstId, itemId: 'narrativePromise#0', action: 'editAccept',
      patch: { description: '改写后的伏笔' },
    })
    expect(edited.status).toBe(200)
    expect(edited.data.action).toBe('edit_accepted')
    expect(edited.data.finalized).toBe(true)
    expect(edited.data.pendingItems).toBe(0)

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)
    expect(fixture.calls).toBe(1) // 仍走续接，不重跑提取
    expect(trackingLines(root, '关系.jsonl')).toHaveLength(1)
    const promises = trackingLines(root, '伏笔.jsonl')
    expect(promises).toHaveLength(1)
    expect(promises[0]).toContain('改写后的伏笔') // patch 生效，未确认的原文不进正典
    expect(proposalOf(committed.data).state).toBe('consumed')
    // 收口后不再出现在待决队列
    const queue = await post(base, '/api/proposal.list', { root })
    expect(queue.status).toBe(200)
    expect(queue.data.proposals).toEqual([])
  })

  it('reject 的条目绝不进正典（确认集只含 confirmed/edit_accepted）', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)

    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    const proposalId = proposalOf(suspended.data).proposalId
    for (const itemId of ['relationshipState#0', 'narrativePromise#0']) {
      const decided = await post(base, '/api/proposal.decide', { root, proposalId, itemId, action: 'reject' })
      expect(decided.status).toBe(200)
    }

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)
    expect(trackingLines(root, '关系.jsonl')).toHaveLength(0)
    expect(trackingLines(root, '伏笔.jsonl')).toHaveLength(0)
    expect(trackingLines(root, '事实.jsonl')).toHaveLength(1) // 自动确认的 low 行照常入 canon
  })

  it('不变量：正文改过 ⇒ 409 CANON_PROPOSAL_STALE（旧提案不被静默丢弃），收口后可重新提交', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)

    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(suspended.status).toBe(409)
    const staleId = proposalOf(suspended.data).proposalId

    // 作者改文：revision 变 ⇒ 盘上提案描述的是旧正文
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '　　中平元年，黄巾起事。关羽提刀入帐。', expectedRevision: Number(snap.data.revision),
    })
    expect(saved.status).toBe(200)

    const stale = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(stale.status).toBe(409)
    expect(stale.data.code).toBe('CANON_PROPOSAL_STALE')
    expect(stale.data.proposalId).toBe(staleId)
    // 显式拒绝的同时把旧提案内容交回作者（不静默丢弃逐条决策）
    expect((stale.data.staleProposals as ProposalView[])[0]!.proposalId).toBe(staleId)
    assertCanonUntouched(root)

    // 显式收口旧提案后，新 revision 重新走分流
    const discarded = await post(base, '/api/proposal.discard', { root, proposalId: staleId })
    expect(discarded.status).toBe(200)
    expect((discarded.data.proposal as ProposalView).state).toBe('consumed')

    const reproposed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(reproposed.status).toBe(409)
    expect(reproposed.data.code).toBe('CANON_PROPOSAL_PENDING')
    expect(proposalOf(reproposed.data).proposalId).not.toBe(staleId)
    expect(proposalFiles(root)).toHaveLength(2) // 旧记录留档（审计面），新记录待决
  })
  it('不变量：web 提交留下的提案头不制造幻影会话窗口（session.open/advance 照常）', async () => {
    // 本路径无 session，提案头（CanonProposalCreated）在窗口外开——若投影把它当成
    // 开放窗口，紧随其后的会话步进就会误判。此用例钉住「投影只计窗口内事件」。
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)
    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(suspended.status).toBe(409)

    const opened = await post(base, '/api/session.open', { root, chapterIndex: 1 })
    expect(opened.status).toBe(200)
    const advanced = await post(base, '/api/session.advance', { root, chapterIndex: 1 })
    expect(advanced.status).toBe(200)
    expect(advanced.data.previousStep).toBe('prepare')
    expect(advanced.data.currentStep).toBe('compile')
  })
})

describe('POST /api/proposal.* · ProposalPort 确认面（S6）', () => {
  it('list：未决提案队列（跨重启待决的读取面），决毕后不再列出', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    const empty = await post(base, '/api/proposal.list', { root })
    expect(empty.status).toBe(200)
    expect(empty.data.proposals).toEqual([])

    fixture.result = mediumExtraction(bookId)
    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    const proposalId = proposalOf(suspended.data).proposalId

    const listed = await post(base, '/api/proposal.list', { root })
    expect(listed.status).toBe(200)
    const proposals = listed.data.proposals as ProposalView[]
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.proposalId).toBe(proposalId)
    expect(proposals[0]!.pendingCount).toBe(2)
    // 行载荷原样带出（editAccept 需要看到候选行全字段）
    expect(proposals[0]!.items.find((item) => item.itemId === 'narrativePromise#0')!.row['description']).toBe('断剑的来历')

    for (const itemId of ['relationshipState#0', 'narrativePromise#0']) {
      await post(base, '/api/proposal.decide', { root, proposalId, itemId, action: 'reject' })
    }
    const afterDecided = await post(base, '/api/proposal.list', { root })
    expect(afterDecided.data.proposals).toEqual([]) // 决毕即离开待决队列（下一步是重提提交）
  })

  it('decide 失败路径：未知条目/已决条目 409；空 patch、patch 用于 confirm、非法 action 400', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)
    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    const proposalId = proposalOf(suspended.data).proposalId

    const unknownItem = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'temporalFact#9', action: 'confirm',
    })
    expect(unknownItem.status).toBe(409)
    expect(unknownItem.data.code).toBe('PROPOSAL_DECISION_REJECTED')
    expect(String(unknownItem.data.error)).toContain('unknown item')

    const unknownProposal = await post(base, '/api/proposal.decide', {
      root, proposalId: 'prp_nope', itemId: 'temporalFact#0', action: 'confirm',
    })
    expect(unknownProposal.status).toBe(409)
    expect(unknownProposal.data.code).toBe('PROPOSAL_DECISION_REJECTED')

    const emptyPatch = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'narrativePromise#0', action: 'editAccept', patch: {},
    })
    expect(emptyPatch.status).toBe(400)
    expect(String(emptyPatch.data.error)).toContain('non-empty patch')

    const missingPatch = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'narrativePromise#0', action: 'editAccept',
    })
    expect(missingPatch.status).toBe(400)

    const patchOnConfirm = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'narrativePromise#0', action: 'confirm', patch: { description: 'x' },
    })
    expect(patchOnConfirm.status).toBe(400)

    const badAction = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'narrativePromise#0', action: 'applyAll',
    })
    expect(badAction.status).toBe(400)

    // 以上全部被拒 ⇒ 待决面未被触碰（失败路径零副作用）
    const listed = await post(base, '/api/proposal.list', { root })
    expect((listed.data.proposals as ProposalView[])[0]!.pendingCount).toBe(2)

    // 已决条目二次决策必须响亮失败，不许静默改写
    const first = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'relationshipState#0', action: 'confirm',
    })
    expect(first.status).toBe(200)
    const twice = await post(base, '/api/proposal.decide', {
      root, proposalId, itemId: 'relationshipState#0', action: 'reject',
    })
    expect(twice.status).toBe(409)
    expect(String(twice.data.error)).toContain('already decided')
    const stillConfirmed = await post(base, '/api/proposal.list', { root })
    const item = (stillConfirmed.data.proposals as ProposalView[])[0]!.items.find((entry) => entry.itemId === 'relationshipState#0')!
    expect(item.state).toBe('confirmed')
  })

  it('discard：整份提案逐条 reject 后收口，正典零写入且不再待决', async () => {
    const { base, root, bookId } = await makeDraftChapter()
    fixture.result = mediumExtraction(bookId)
    const suspended = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    const proposalId = proposalOf(suspended.data).proposalId

    const discarded = await post(base, '/api/proposal.discard', { root, proposalId })
    expect(discarded.status).toBe(200)
    const proposal = discarded.data.proposal as ProposalView
    expect(proposal.state).toBe('consumed')
    expect(proposal.pendingCount).toBe(0)
    // 放弃只改未决条目：入场即确认的 low 行保持 confirmed（不追溯改写已决状态）
    expect(proposal.items.filter((item) => item.state === 'rejected').map((item) => item.itemId).sort()).toEqual([
      'narrativePromise#0',
      'relationshipState#0',
    ])
    expect(proposal.items.filter((item) => item.state === 'confirmed')).toHaveLength(3)
    assertCanonUntouched(root)

    // 放弃后本 revision 的提案已收口：再提交即视为全新提案（此处同一 revision ⇒ 续接已收口记录不可用）
    const missing = await post(base, '/api/proposal.discard', { root, proposalId: 'prp_nope' })
    expect(missing.status).toBe(409)
    expect(missing.data.code).toBe('PROPOSAL_DISCARD_REJECTED')
    // 未知提案的收口被拒 ⇒ 盘上记录未被触碰
    expect(proposalFiles(root)).toHaveLength(1)
  })
})
