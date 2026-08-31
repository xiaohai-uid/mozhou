// @vitest-environment node
/**
 * T31 apps/web 同进程 API 中间件测试（Phase 6；t76 R1 修订形态）。
 * 黑盒：真实 HTTP 起服 → POST /api/* 断言 JSON 直出。
 * （vitest 默认环境为 jsdom——组件测试引入后的约定；真实 HTTP 套件固定 node。）
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../server/api'
import { LocalDataPlane, createBook, createChapterDraft, entityCardFileRel, openPinsWindow, readManifest, openDatabase, readProseChapter, proseChapterPath, runTraversal, sha256Hex } from '@mozhou/data-plane'
import { canonicalJson } from '@mozhou/context-compiler'
import { newFactId, newKnowledgeStateId } from '@mozhou/kernel'
import type { EntityRef } from '@mozhou/kernel'
import { ChapterProductionSession, recordUserEdit } from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
let bases: string[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots = []
  bases = []
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

describe('apps/web api 中间件 · T31/T32', () => {
  it('POST /api/book 建书：返回 root 与 bookId', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-api-'))
    roots.push(dir)
    const { status, data } = await post(base, '/api/book', { title: '测试之书', dir })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(typeof data.root).toBe('string')
    expect(typeof data.bookId).toBe('string')
  })

  it('POST /api/story-brain.entities：直出 scanEntityCards 的实体卡契约（PR #82 移植）', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-api-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { title: '实体书', dir })
    const root = created.data.root as string
    const ref = 'char:linzhou' as EntityRef
    const rel = entityCardFileRel(ref)
    const absolute = join(root, rel)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(
      absolute,
      '---\nref: char:linzhou\nname: 林舟\nbrief: 主角\n---\n# 林舟\n',
      'utf8',
    )

    const { status, data } = await post(base, '/api/story-brain.entities', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.cards).toEqual([
      expect.objectContaining({
        ref: 'char:linzhou',
        cardType: 'char',
        name: '林舟',
        brief: '主角',
        aiContext: 'detected',
      }),
    ])
  })

  it('POST /api/ledger：新建书的账本为空数组（无事件）', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-api-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { title: '账本书', dir })
    const root = created.data.root as string
    const { status, data } = await post(base, '/api/ledger', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.events).toEqual([])
  })

  it('缺 root 的 ledger 请求返回 400 显式错误（失败显式，UVSD §14）', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/ledger', {})
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
  })

  it('非 api 路径交给 next（404 由下游处理）', async () => {
    const base = await listen()
    const res = await fetch(base + '/index.html')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('nf')
  })
})

/* -------------------------------------------------------------------------
 * ADR-0025（质量门集成 · Task 9）：质量审查 API 契约
 * 会话推进在测试内用真实管线完成（session advance 是纯光标移动），
 * HTTP 层只消费 /api/chapter.* 端点——黑盒不变。
 * ------------------------------------------------------------------------- */

import { runReviewStep } from '@mozhou/pipeline'

/** 确定性规则策略：web 直连面无语义提供方，缺省全平台策略必 refused。 */
const DETERMINISTIC_POLICY = {
  schemaVersion: 1,
  projectId: 'web-test',
  rules: [
    { id: 'PARA-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '段落瀑布', evidenceRequired: true, enabled: true },
    { id: 'REV-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '锚点一致', evidenceRequired: true, enabled: true },
  ],
  maxAutomaticReworks: 2,
}

async function makeBookAtReview(title: string): Promise<string> {
  const base = await listen()
  bases.push(base)
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-quality-'))
  roots.push(dir)
  await post(base, '/api/book', { title, dir })
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 1, title: '第一章' })
  const session = ChapterProductionSession.start({ bus: new PublishBus(), root: dir, chapterIndex: 1, newTaskRef: () => 'tsk_web' })
  session.advance('compile')
  session.advance('draft')
  session.advance('review')
  return dir
}

async function writeWaterfallBody(root: string): Promise<void> {
  // 既有编辑路径铺入段落瀑布正文（PARA-001 必 fail）
  recordUserEdit({
    bus: new PublishBus(),
    bookRoot: root,
    taskRef: 'tsk_web',
    chapterIndex: 1,
    level: 'cursor',
    source: 'author',
    blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。' },
    ],
  })
}

describe('ADR-0025 质量审查 API 契约', () => {
  it('review pass 返回 current=true', async () => {
    await makeBookAtReview('通过之书')
    const { status, data } = await post(bases[bases.length - 1]!, '/api/chapter.review', { root: roots[roots.length - 1]!, chapterIndex: 1, policy: DETERMINISTIC_POLICY })
    expect(status).toBe(200)
    expect(data.verdict).toBe('pass')
    expect(data.current).toBe(true)
  })

  it('pass 之后编辑正文 → /quality 返回 current=false', async () => {
    const root = await makeBookAtReview('失效之书')
    const base = bases[bases.length - 1]!
    await post(base, '/api/chapter.review', { root, chapterIndex: 1, policy: DETERMINISTIC_POLICY })
    recordUserEdit({
      bus: new PublishBus(),
      bookRoot: root,
      taskRef: 'tsk_web',
      chapterIndex: 1,
      level: 'cursor',
      source: 'author',
      blocks: [{ op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '审查后的新段落。' }],
    })
    const { data } = await post(base, '/api/chapter.quality', { root, chapterIndex: 1 })
    expect(data.current).toBe(false)
  })

  it('blocking_fail 阻断前进：rework 两次可用，第三次 422 QualityReworkLimitExceeded', async () => {
    const root = await makeBookAtReview('回炉之书')
    const base = bases[bases.length - 1]!
    await writeWaterfallBody(root)

    const firstReview = await post(base, '/api/chapter.review', { root, chapterIndex: 1, policy: DETERMINISTIC_POLICY })
    expect(firstReview.data.verdict).toBe('blocking_fail')
    // 审查轮修订：PARA-001 为 blocking → 进 blockingFailures；advisories 空
    expect((firstReview.data.blockingFailures as unknown[]).length).toBe(1)
    expect(firstReview.data.advisories).toEqual([])
    expect(firstReview.data.semanticReviewer).toBe('unavailable')

    // 第一次与第二次回炉成功（回炉后回 draft，需再 review 才能再回炉）
    for (let round = 0; round < 2; round += 1) {
      const rework = await post(base, '/api/chapter.rework', { root, chapterIndex: 1 })
      expect(rework.status).toBe(200)
      // 回炉后前进：draft → review（跳过真正的 LLM 重写——直接以同正文再审）
      const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex: 1 })!
      session.advance('review')
      const again = await post(base, '/api/chapter.review', { root, chapterIndex: 1, policy: DETERMINISTIC_POLICY })
      expect(again.data.verdict).toBe('blocking_fail')
    }

    const third = await post(base, '/api/chapter.rework', { root, chapterIndex: 1 })
    expect(third.status).toBe(422)
    expect(third.data.code).toBe('QualityReworkLimitExceeded')
  })

  it('corrections 落账且不携带附注原文（隐私分层）', async () => {
    const root = await makeBookAtReview('纠错之书')
    const base = bases[bases.length - 1]!
    const { status, data } = await post(base, '/api/chapter.corrections', {
      root,
      chapterIndex: 1,
      reasons: ['outline_expansion'],
      note: '把大纲当正文写了',
    })
    if (status !== 200) console.log('corrections error body:', JSON.stringify(data))
    expect(status).toBe(200)
    expect(data.recorded).toBe(1)
    expect(typeof data.noteDigest).toBe('string')
    const jsonl = readFileSync(join(root, '质量', 'failure-memory.jsonl'), 'utf8')
    expect(jsonl).toContain('outline_expansion')
    expect(jsonl).toContain('把大纲当正文写了') // 附注只留书侧（P1），响应未携带
    expect(JSON.stringify(data)).not.toContain('把大纲当正文写了')
  })

  it('未知纠错原因 400 显式拒绝', async () => {
    const root = await makeBookAtReview('坏原因之书')
    const base = bases[bases.length - 1]!
    const { status } = await post(base, '/api/chapter.corrections', {
      root,
      chapterIndex: 1,
      reasons: ['not_a_reason'],
    })
    expect(status).toBe(400)
  })

  it('无会话的章 review 409 显式错误', async () => {
    const base = await listen()
    bases.push(base)
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-quality-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '无会话之书', dir })
    const { status, data } = await post(base, '/api/chapter.review', { root: dir, chapterIndex: 1 })
    expect(status).toBe(409)
    expect(data.ok).toBe(false)
  })
})

/* -------------------------------------------------------------------------
 * T41（#86）Story Brain 四读面 API 契约：
 * readCanonState（/api/book.state）+ queryActiveFacts / ADR-0026
 * suspects-believes 安全通道 / queryInvalidatedKnowledgeStates
 * （/api/story-brain.facts）。scanEntityCards 已在上方 PR #82 契约覆盖。
 * ------------------------------------------------------------------------- */

const T41_T0 = '2026-08-24T00:00:00.000Z'

function t41FactRow(
  bookId: string,
  options: { subject: string; predicate: string; value: string; riskClass?: string; status?: string },
): Record<string, unknown> {
  return {
    id: newFactId(),
    bookId,
    revision: 0,
    createdAt: T41_T0,
    updatedAt: T41_T0,
    subject: options.subject,
    predicate: options.predicate,
    value: options.value,
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: options.riskClass ?? 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: options.status ?? 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }
}

function t41KnstRow(
  bookId: string,
  factId: string,
  options: { holder?: string; level?: string; distortion?: string } = {},
): Record<string, unknown> {
  return {
    id: newKnowledgeStateId(),
    bookId,
    revision: 0,
    createdAt: T41_T0,
    updatedAt: T41_T0,
    factId,
    holder: options.holder ?? 'protagonist',
    knownSinceChapter: 1,
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.distortion === undefined ? {} : { distortion: options.distortion }),
  }
}

/** 建书 + 一章已提交 + 认知三级种子：
 *  A located=灰潮港（主角 knows）；B 秘密真名（主角 knows 授权）；C 秘密行踪
 *  （主角 suspects——值不得出通道）；A 的信念行（char:lin-wan believes+畸变）；
 *  D 已否决事实 + knows 认知行（⇒ invalidated）。 */
async function seedT41Book(title: string): Promise<{ base: string; root: string }> {
  const base = await listen()
  bases.push(base)
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t41-'))
  roots.push(dir)
  await post(base, '/api/book', { title, dir })
  const plane = LocalDataPlane.open(dir)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
    const factA = t41FactRow(plane.book.id, { subject: 'char:lin-wan', predicate: 'located', value: '灰潮港' })
    const factB = t41FactRow(plane.book.id, { subject: 'char:gu-chen', predicate: 'secret.true_name', value: '绝密真名值X', riskClass: 'high' })
    const factC = t41FactRow(plane.book.id, { subject: 'char:gu-chen', predicate: 'secret.whereabouts', value: '绝密行踪值Y', riskClass: 'high' })
    const factD = t41FactRow(plane.book.id, { subject: 'char:lin-wan', predicate: 'scar_origin', value: '旧疤来历Z', status: 'rejected' })
    plane.commitChapter({
      chapterIndex: 1,
      summary: '开篇',
      appends: {
        temporalFact: [factA, factB, factC, factD],
        knowledgeState: [
          t41KnstRow(plane.book.id, factA['id'] as string),
          t41KnstRow(plane.book.id, factB['id'] as string, { level: 'knows' }),
          t41KnstRow(plane.book.id, factC['id'] as string, { level: 'suspects' }),
          t41KnstRow(plane.book.id, factA['id'] as string, {
            holder: 'char:lin-wan',
            level: 'believes',
            distortion: '港务局控制钟楼',
          }),
          t41KnstRow(plane.book.id, factD['id'] as string, { level: 'knows' }),
        ],
      },
    })
  } finally {
    plane.close()
  }
  return { base, root: dir }
}

describe('T41 Story Brain 四读面 API 契约', () => {
  it('POST /api/book.state：readCanonState 直出（大纲两节点 + 五族追踪流）', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t41-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { title: '基底书', dir })
    const root = created.data.root as string
    const { status, data } = await post(base, '/api/book.state', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    const state = data.state as {
      book: { title: string }
      outlineNodes: { nodeType: string }[]
      trackingLines: Record<string, unknown[]>
      entityCards: unknown[]
    }
    expect(state.book.title).toBe('基底书')
    expect(state.outlineNodes.map((node) => node.nodeType)).toEqual(['book', 'volume'])
    expect(Object.keys(state.trackingLines)).toHaveLength(5)
    expect(state.entityCards).toEqual([])
  })

  it('POST /api/story-brain.facts：canon=knows 授权可见；suspects/believes 安全通道；invalidated 直出', async () => {
    const { base, root } = await seedT41Book('认知书')
    const { status, data } = await post(base, '/api/story-brain.facts', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.chapter).toBe(1)
    expect(data.currentChapterIndex).toBe(1)
    expect(data.chapters).toEqual([{ chapterIndex: 1, phase: 'committed' }])

    const canon = data.canon as { id: string; subject: string; predicate: string; value: string }[]
    // D 已 rejected 出局；C 秘密无 knows 授权 ⇒ 对主角不可见（与不存在不可区分）
    expect(canon.map((fact) => fact.predicate).sort()).toEqual(['located', 'secret.true_name'])
    // knows 授权的秘密事实：正典值对主角可见（ADR-0026 通道语义）
    expect(canon.find((fact) => fact.predicate === 'secret.true_name')?.value).toBe('绝密真名值X')

    const perspective = data.perspective as {
      factId: string
      level: string
      holder: string
      presentation: string
      subject: string | null
    }[]
    expect(perspective).toHaveLength(2)
    const suspect = perspective.find((entry) => entry.level === 'suspects')
    if (suspect === undefined) throw new Error('missing suspects entry')
    expect(suspect.holder).toBe('protagonist')
    expect(suspect.subject).toBe('char:gu-chen')
    expect(suspect.presentation).toContain('CHARACTER SUSPECTS:')
    expect(suspect.presentation).toContain('secret.whereabouts')
    const belief = perspective.find((entry) => entry.level === 'believes')
    if (belief === undefined) throw new Error('missing believes entry')
    expect(belief.holder).toBe('char:lin-wan')
    expect(belief.subject).toBe('char:lin-wan')
    expect(belief.presentation).toContain('CHARACTER BELIEVES:')
    expect(belief.presentation).toContain('港务局控制钟楼')

    // 防真相泄漏修订：C 的正典值永不进 suspects/believes 通道（逐字段审计）
    expect(JSON.stringify(data.perspective)).not.toContain('绝密行踪值Y')

    const invalidated = data.invalidated as { factId: string; level: string; subject: string | null }[]
    expect(invalidated).toHaveLength(1)
    expect(invalidated[0]?.level).toBe('knows')
    expect(invalidated[0]?.subject).toBe('char:lin-wan')
  })

  it('entityIds 限定断言主体（queryActiveFacts 过滤面）', async () => {
    const { base, root } = await seedT41Book('过滤书')
    const { data } = await post(base, '/api/story-brain.facts', { root, entityIds: ['char:gu-chen'] })
    const canon = data.canon as { predicate: string }[]
    expect(canon.map((fact) => fact.predicate)).toEqual(['secret.true_name'])
  })

  it('章节锚点取最新草稿章（draft 优先于 committed）', async () => {
    const { base, root } = await seedT41Book('锚书')
    const plane = LocalDataPlane.open(root)
    try {
      plane.createChapterDraft({ chapterIndex: 2, title: '潮生' })
    } finally {
      plane.close()
    }
    const { data } = await post(base, '/api/story-brain.facts', { root })
    expect(data.chapter).toBe(2)
    expect(data.currentChapterIndex).toBe(2)
    expect(data.chapters).toEqual([
      { chapterIndex: 1, phase: 'committed' },
      { chapterIndex: 2, phase: 'draft' },
    ])
  })

  it('无正文章之书：锚点回落 1、currentChapterIndex=null、canon 空', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t41-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '空书', dir })
    const { data } = await post(base, '/api/story-brain.facts', { root: dir })
    expect(data.chapter).toBe(1)
    expect(data.currentChapterIndex).toBeNull()
    expect(data.chapters).toEqual([])
    expect(data.canon).toEqual([])
  })

  it('缺 root 的 facts 请求返回 400 显式错误', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/story-brain.facts', {})
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
  })
})

/* ----------------------------------------------------------------------------
 * T42（#87）装配看板读面 API 契约：
 * /api/receipts（列表：id/章/tok/INV-R6 hash match）+ /api/receipt（详情：
 * loadReceiptForResume 直出 + 会话投影续跑判态）。零新增后端能力——纯读面。
 * seed：直接落盘 receipt 文件（one-file-one-receipt），hash 值按真实重算
 * 语义构造（canonicalJson(replayInputs) → sha256Hex）。
 * ------------------------------------------------------------------------- */

const T42_T0 = '2026-08-24T00:00:00.000Z'

interface T42ReceiptSeed {
  id: string
  chapterIndex?: number
  entries?: unknown[]
  replayInputs?: Record<string, unknown>
  totalTokens?: number
}

/** 构造可落盘的 Receipt JSON：inputsDigest 按 INV-R6 语义重算（真实校验路径）。 */
function t42ReceiptJson(seed: T42ReceiptSeed): Record<string, unknown> {
  const replayInputs = seed.replayInputs ?? { configVersion: 'v1', tokenizerVersion: 't1' }
  return {
    id: seed.id,
    bookId: 'book_01JB00000000000000000000',
    revision: 0,
    createdAt: T42_T0,
    updatedAt: T42_T0,
    taskType: 'CHAPTER_DRAFTING',
    ...(seed.chapterIndex === undefined ? {} : { chapterIndex: seed.chapterIndex }),
    entries: seed.entries ?? [],
    parseFailures: [],
    storyTextQuota: { reservedTokens: 1024, actualTokens: 2048 },
    totalTokens: seed.totalTokens ?? 4096,
    assembledBy: 'server',
    replayInputs,
    inputsDigest: sha256Hex(canonicalJson(replayInputs)),
    recomputationHash: 'h',
  }
}

/** 落盘一张 receipt（.mozhou/receipts/<id>.json）。 */
function t42SeedReceipt(root: string, json: Record<string, unknown>): void {
  const dir = join(root, '.mozhou', 'receipts')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, String(json.id) + '.json'), JSON.stringify(json), 'utf8')
}

describe('T42 装配看板读面 API 契约', () => {
  it('POST /api/receipts：列表直出 id/章/tok/hash match；空书 = 空数组', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t42-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '装配书', dir })
    t42SeedReceipt(dir, t42ReceiptJson({ id: 'rcpt_t4201', chapterIndex: 1, totalTokens: 5120 }))

    const { status, data } = await post(base, '/api/receipts', { root: dir })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(Array.isArray(data.receipts)).toBe(true)
    const receipts = data.receipts as { receiptId: string; chapterIndex: number | null; totalTokens: number; hashMatch: boolean }[]
    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.receiptId).toBe('rcpt_t4201')
    expect(receipts[0]?.chapterIndex).toBe(1)
    expect(receipts[0]?.totalTokens).toBe(5120)
    expect(receipts[0]?.hashMatch).toBe(true)
  })

  it('hash mismatch 显式暴露（INV-R6 重算不一致），不静默降级', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t42-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '失谐书', dir })
    const broken = t42ReceiptJson({ id: 'rcpt_t4202', chapterIndex: 2 })
    broken['inputsDigest'] = 'deadbeefdeadbeefdeadbeefdeadbeef'
    t42SeedReceipt(dir, broken)

    const { data } = await post(base, '/api/receipts', { root: dir })
    const receipts = data.receipts as { receiptId: string; hashMatch: boolean }[]
    expect(receipts[0]?.hashMatch).toBe(false)
  })

  it('POST /api/receipt：详情直出 ContextReceipt + 会话投影续跑判态（无会话显式呈现）', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t42-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '详情书', dir })
    t42SeedReceipt(dir, t42ReceiptJson({ id: 'rcpt_t4203', chapterIndex: 3, totalTokens: 3000 }))

    const { status, data } = await post(base, '/api/receipt', { root: dir, receiptId: 'rcpt_t4203' })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.receiptId).toBe('rcpt_t4203')
    expect(data.chapterIndex).toBe(3)
    expect(data.totalTokens).toBe(3000)
    expect(data.hashMatch).toBe(true)
    expect(data.receipt).toMatchObject({ id: 'rcpt_t4203', taskType: 'CHAPTER_DRAFTING', assembledBy: 'server' })
    // 无会话投影：新书没有 TaskStarted 开卷，sessionOpen=false 显式呈现
    expect(data.resume).toMatchObject({ sessionOpen: false, currentStep: null })
    expect((data.resume as { committed: boolean }).committed).toBe(false)
  })

  it('缺 root/receiptId 返回 400 显式错误；receipts 缺 root 同', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/receipt', {})
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
    const r2 = await post(base, '/api/receipts', {})
    expect(r2.status).toBe(400)
    expect(r2.data.ok).toBe(false)
  })
})

/* ----------------------------------------------------------------------------
 * T43（#88）变更矩阵读面 API 契约：
 * /api/change-matrix（assembleChangeMatrix 只读投影，行/列/单元格三态）+
 * /api/change-matrix.rerun（runTraversal 幂等覆盖重跑）。唯一新增后端能力 = 投影。
 * seed：建书 + 手工钉版事件 + runTraversal 落 impact 文件。
 * ------------------------------------------------------------------------- */

/** T43 seed：建书 + 2 章依赖 fact_a@1 的钉版 + 一次 fact_a@2 上游遍历。 */
async function seedT43Matrix(): Promise<{ base: string; root: string }> {
  const base = await listen()
  bases.push(base)
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t43-'))
  roots.push(dir)
  await post(base, '/api/book', { title: '矩阵书', dir })
  const eventsPath = join(dir, '.mozhou', 'events.jsonl')
  mkdirSync(dirname(eventsPath), { recursive: true })
  writeFileSync(
    eventsPath,
    [
      JSON.stringify({ type: 'ChapterCommitted', seq: 1, chapterIndex: 1, commitId: 'c1', dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 1 }] } }),
      JSON.stringify({ type: 'ChapterCommitted', seq: 2, chapterIndex: 2, commitId: 'c2', dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 1 }] } }),
    ].join('\n') + '\n',
    'utf8',
  )
  runTraversal({
    root: dir,
    taskRef: 'trav_1',
    traversalId: 't_1',
    trigger: { source: 'reconciliation', ref: 'rcln_x' },
    upstreamChanges: [{ kind: 'temporalFact', id: 'fact_a', revision: 2 }],
    recordedAt: '2026-08-28T00:00:00.000Z',
    window: openPinsWindow(dir),
  })
  return { base, root: dir }
}

describe('T43 变更矩阵读面 API 契约', () => {
  it('POST /api/change-matrix：行=Traversal、列=受影响章、单元格红态（需重写）', async () => {
    const { base, root } = await seedT43Matrix()
    const { status, data } = await post(base, '/api/change-matrix', { root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    const matrix = data.matrix as {
      columns: number[]
      rows: {
        traversalId: string
        taskRef: string
        staleCount: number
        cells: { chapterIndex: number; state: string }[]
      }[]
    }
    expect(matrix.columns).toEqual([1, 2])
    expect(matrix.rows).toHaveLength(1)
    expect(matrix.rows[0]?.traversalId).toBe('t_1')
    expect(matrix.rows[0]?.taskRef).toBe('trav_1')
    expect(matrix.rows[0]?.staleCount).toBe(2)
    expect(matrix.rows[0]?.cells).toEqual([
      { chapterIndex: 1, state: 'needs_rework' },
      { chapterIndex: 2, state: 'needs_rework' },
    ])
  })

  it('重跑后章重新钉版到新版本 → 单元转绿（resolved）并响应 rerunCount', async () => {
    const { base, root } = await seedT43Matrix()
    // 章 1 用新版本 fact_a@2 重新提交（消解）；章 2 仍旧
    const eventsPath = join(root, '.mozhou', 'events.jsonl')
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.length > 0)
    lines.push(JSON.stringify({
      type: 'ChapterCommitted',
      seq: 3,
      chapterIndex: 1,
      commitId: 'c1b',
      dependencyManifest: { entries: [{ kind: 'temporalFact', id: 'fact_a', revision: 2 }] },
    }))
    writeFileSync(eventsPath, lines.join('\n') + '\n')

    const { status, data } = await post(base, '/api/change-matrix.rerun', { root, traversalId: 't_1' })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.rerunCount).toBe(1)
    const matrix = data.matrix as { rows: { traversalId: string; staleCount: number; cells: { chapterIndex: number; state: string }[] }[] }
    expect(matrix.rows[0]?.staleCount).toBe(1)
    expect(matrix.rows[0]?.cells).toEqual([
      { chapterIndex: 1, state: 'resolved' },
      { chapterIndex: 2, state: 'needs_rework' },
    ])
  })

  it('未知 traversalId 重跑返回 404；缺 root 返回 400', async () => {
    const { base, root } = await seedT43Matrix()
    const missing = await post(base, '/api/change-matrix.rerun', { root, traversalId: 'nope' })
    expect(missing.status).toBe(404)
    expect(missing.data.ok).toBe(false)
    const noRoot = await post(base, '/api/change-matrix', {})
    expect(noRoot.status).toBe(400)
    expect(noRoot.data.ok).toBe(false)
  })

  it('无 impact 记录书：矩阵空（columns=[] rows=[]）', async () => {
    const base = await listen()
    bases.push(base)
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t43-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '空矩阵书', dir })
    const { data } = await post(base, '/api/change-matrix', { root: dir })
    const matrix = data.matrix as { columns: number[]; rows: unknown[] }
    expect(matrix.columns).toEqual([])
    expect(matrix.rows).toEqual([])
  })
})
