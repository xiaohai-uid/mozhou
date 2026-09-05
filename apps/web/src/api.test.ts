// @vitest-environment node
/**
 * T31 apps/web 同进程 API 中间件测试（Phase 6；t76 R1 修订形态）。
 * 黑盒：真实 HTTP 起服 → POST /api/* 断言 JSON 直出。
 * （vitest 默认环境为 jsdom——组件测试引入后的约定；真实 HTTP 套件固定 node。）
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../server/api'
import { LocalDataPlane, createBook, entityCardFileRel, openPinsWindow, readProseChapter, renderProseChapter, proseChapterPath, runTraversal, sha256Hex } from '@mozhou/data-plane'
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
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
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

  it('POST /api/book 不传 dir 时建书至 MOZHOU_LIBRARY_DIR 长期目录并包含首章', async () => {
    const base = await listen()
    const libDir = mkdtempSync(join(tmpdir(), 'mozhou-lib-test-'))
    roots.push(libDir)
    const before = process.env['MOZHOU_LIBRARY_DIR']
    process.env['MOZHOU_LIBRARY_DIR'] = libDir
    try {
      const { status, data } = await post(base, '/api/book', { title: '长期书库作品' })
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
      const root = data.root as string
      expect(root.startsWith(resolve(libDir))).toBe(true)
      expect(existsSync(join(root, 'book.json'))).toBe(true)
      expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
    } finally {
      if (before === undefined) delete process.env['MOZHOU_LIBRARY_DIR']
      else process.env['MOZHOU_LIBRARY_DIR'] = before
    }
  })

  it('POST /api/book 支持含中文与空格的路径创建与重开', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-chinese-'))
    roots.push(parent)
    const dir = join(parent, '我的 小说 目录（测试）')
    const { status, data } = await post(base, '/api/book', { dir, title: '中文空格书' })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    const root = data.root as string
    expect(existsSync(join(root, 'book.json'))).toBe(true)
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
    // 重新打开
    const openRes = await post(base, '/api/library.open', { root })
    expect(openRes.status).toBe(200)
    expect(openRes.data.ok).toBe(true)
    expect((openRes.data as { title: string }).title).toBe('中文空格书')
  })

  it('new HTTP book is immediately draftable', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-first-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { dir, title: '新书' })
    expect(created.status).toBe(200)
    const root = created.data.root as string
    expect(readProseChapter(root, proseChapterPath(1)).phase).toBe('draft')
    const overview = await post(base, '/api/works', { root })
    expect(overview.data.chapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ chapterIndex: 1 }),
    ]))
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
  const session = ChapterProductionSession.start({ bus: new PublishBus(), root: dir, chapterIndex: 1, newTaskRef: () => 'tsk_web' })
  session.advance('compile')
  session.advance('draft')
  session.advance('review')
  return dir
}

function writeWaterfallBody(root: string): void {
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
    writeWaterfallBody(root)

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
    createBook({ title: '空书', dir })
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

/* ----------------------------------------------------------------------------
 * T44（#89）中栏写作对话流 API 契约：
 * /api/capabilities（技能读面 + providerAvailable）、/api/draft.question（V1 mock 先问）、
 * /api/draft.stream（NDJSON 流式草稿；provider 未配 ⇒ 显式 PROVIDER_UNAVAILABLE，
 * Gate 3 纪律；mock provider 经 MOZHOU_DRAFT_PROVIDER=mock 显式开启）。
 * ------------------------------------------------------------------------- */

describe('T44 中栏对话流 API 契约', () => {
  it('POST /api/capabilities：技能词表 + providerAvailable=false（未配置负路径）', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/capabilities', {})
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.providerAvailable).toBe(false)
    const capabilities = data.capabilities as { id: string; label: string }[]
    expect(capabilities.map((cap) => cap.label)).toContain('续写')
    expect(capabilities.map((cap) => cap.id)).toEqual(
      expect.arrayContaining(['sepia-write', 'sepia-review', 'sepia-refactor', 'sepia-recreate']),
    )
    expect(capabilities.length).toBeGreaterThanOrEqual(8)
  })

  it('POST /api/capabilities：配置 MOZHOU_API_KEY 时 providerAvailable=true', async () => {
    const before = process.env['MOZHOU_API_KEY']
    try {
      process.env['MOZHOU_API_KEY'] = 'sk-real-test-key'
      const base = await listen()
      const { status, data } = await post(base, '/api/capabilities', {})
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.providerAvailable).toBe(true)
    } finally {
      if (before === undefined) delete process.env['MOZHOU_API_KEY']
      else process.env['MOZHOU_API_KEY'] = before
    }
  })

  it('POST /api/draft.question：mock 先问直出（问题 + choices）', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/draft.question', {})
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(typeof data.question).toBe('string')
    expect((data.question as string).length).toBeGreaterThan(0)
    expect(Array.isArray(data.choices)).toBe(true)
    expect((data.choices as string[]).length).toBeGreaterThanOrEqual(3)
  })

  it('POST /api/draft.stream：provider 未配 ⇒ 200 JSON PROVIDER_UNAVAILABLE（非流式）', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t44-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { title: '对话书', dir })
    const root = created.data.root as string
    const res = await fetch(base + '/api/draft.stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, prompt: '开场' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('Content-Type')).not.toContain('ndjson')
    const data = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('PROVIDER_UNAVAILABLE')
    expect(data.error).toContain('provider')
  })

  it('POST /api/draft.stream：mock provider 正路径 ⇒ NDJSON start/delta/done 全帧 + 落盘即真', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-t44-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '流式书', dir })
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    try {
      const res = await fetch(base + '/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: dir, chapterIndex: 1, prompt: '夜雨敲窗，灯焰摇了三摇。他推门而入。', activeSkills: ['continuation'] }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('ndjson')
      const text = await res.text()
      const frames = text.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as { ok: boolean; event: string; text?: string; outcome?: string; partial?: boolean })
      expect(frames[0]?.event).toBe('start')
      expect(frames.at(-1)?.event).toBe('done')
      expect(frames.at(-1)?.outcome).toBe('succeeded')
      expect(frames.at(-1)?.partial).toBe(false)
      const deltas = frames.filter((frame) => frame.event === 'delta').map((frame) => frame.text ?? '').join('')
      expect(deltas).toContain('夜雨敲窗')
      expect(deltas).toContain('他推门而入')
      // 落盘即真：正文 draft 文件含流式产物
      const scan = readProseChapter(dir, proseChapterPath(1))
      expect(scan.phase).toBe('draft')
      expect(scan.body).toContain('夜雨敲窗')
    } finally {
      delete process.env['MOZHOU_DRAFT_PROVIDER']
    }
  })

  it('POST /api/draft.stream：续写模式（continuation）保留既有正文并追加', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-continue-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '续写书', dir })
    // 预置第 1 章正文为“前情提要”
    const ch1Rel = proseChapterPath(1)
    const scan = readProseChapter(dir, ch1Rel)
    const preset = renderProseChapter({
      mozhouId: scan.mozhouId,
      revision: scan.revision,
      chapterIndex: 1,
      phase: 'draft',
      body: '前情提要\n',
    })
    writeFileSync(join(dir, ch1Rel), preset, 'utf8')

    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    try {
      const res = await fetch(base + '/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: dir,
          chapterIndex: 1,
          prompt: '后续发展',
          activeSkills: ['continuation'],
        }),
      })
      expect(res.status).toBe(200)
      await res.text()
      const afterScan = readProseChapter(dir, ch1Rel)
      expect(afterScan.body).toContain('前情提要')
      expect(afterScan.body).toContain('后续发展')
      expect(afterScan.body.indexOf('前情提要')).toBeLessThan(afterScan.body.indexOf('后续发展'))
    } finally {
      delete process.env['MOZHOU_DRAFT_PROVIDER']
    }
  })

  it('POST /api/draft.stream：同一章并发写入互斥，后发者返回 409 WRITE_IN_PROGRESS', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-lock-'))
    roots.push(dir)
    await post(base, '/api/book', { title: '并发锁书', dir })
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    try {
      const p1 = fetch(base + '/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: dir, chapterIndex: 1, prompt: '流一' }),
      })
      const p2 = fetch(base + '/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: dir, chapterIndex: 1, prompt: '流二' }),
      })
      const [res1, res2] = await Promise.all([p1, p2])
      const statuses = [res1.status, res2.status].sort()
      expect(statuses).toEqual([200, 409])
      const conflictRes = res1.status === 409 ? res1 : res2
      const conflictData = (await conflictRes.json()) as { ok: boolean; code: string }
      expect(conflictData.ok).toBe(false)
      expect(conflictData.code).toBe('WRITE_IN_PROGRESS')
      // 读完 200 的流
      const okRes = res1.status === 200 ? res1 : res2
      await okRes.text()
    } finally {
      delete process.env['MOZHOU_DRAFT_PROVIDER']
    }
  })

  it('POST /api/draft.stream：缺 root/chapterIndex 返回 400 显式错误', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/draft.stream', { prompt: 'x' })
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
  })
})

/* ----------------------------------------------------------------------------
 * 书架（本地书库）API 契约：/api/library（scanLibrary 读面）+
 * /api/library.open（校验书根切书）+ /api/library.import（书源导入建书）。
 * 纯本地数据面（零外部抓取/认证）。seed：同父目录建多书。
 * ------------------------------------------------------------------------- */

describe('书架（本地书库）API 契约', () => {
  it('POST /api/library：父目录扫描多书（含章计数）；空目录空书库', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-web-lib-'))
    roots.push(parent)
    const bookA = createBook({ dir: join(parent, '甲书'), title: '甲书' })
    createBook({ dir: join(parent, '乙书'), title: '乙书' })
    const plane = LocalDataPlane.open(bookA.root)
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    } finally {
      plane.close()
    }

    const { status, data } = await post(base, '/api/library', { parentDir: parent })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.skipped).toBe(0)
    const books = data.books as { root: string; bookId: string; title: string; chapterCount: number }[]
    expect(books).toHaveLength(2)
    // 码点序（跨平台确定）：乙(U+4E59) < 甲(U+7532) → 乙书在前
    expect(books[0]?.title).toBe('乙书')
    expect(books[0]?.chapterCount).toBe(0)
    expect(books[1]?.title).toBe('甲书')
    expect(books[1]?.chapterCount).toBe(1)
  })

  it('POST /api/library.open：有效书根返回 BookInfo；坏根 404 显式错误', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-web-lib-'))
    roots.push(parent)
    const book = createBook({ dir: join(parent, '可开之书'), title: '可开之书' })
    const ok = await post(base, '/api/library.open', { root: book.root })
    expect(ok.status).toBe(200)
    expect(ok.data.ok).toBe(true)
    expect(ok.data.bookId).toBe(book.book.id)
    expect(ok.data.title).toBe('可开之书')

    const bad = await post(base, '/api/library.open', { root: join(parent, '不存在') })
    expect(bad.status).toBe(404)
    expect(bad.data.ok).toBe(false)
    expect(typeof bad.data.error).toBe('string')
  })

  it('POST /api/library.import：书源导入建书落地；重名冲突 409；缺参 400', async () => {
    const base = await listen()
    const parent = mkdtempSync(join(tmpdir(), 'mozhou-web-lib-'))
    roots.push(parent)
    const ok = await post(base, '/api/library.import', { parentDir: parent, title: '导入之书' })
    expect(ok.status).toBe(200)
    expect(ok.data.ok).toBe(true)
    expect(typeof ok.data.root).toBe('string')
    expect(typeof ok.data.bookId).toBe('string')
    expect(ok.data.title).toBe('导入之书')
    // 落地即真：书库扫描可见
    const scan = await post(base, '/api/library', { parentDir: parent })
    const books = scan.data.books as { title: string }[]
    expect(books.map((b) => b.title)).toContain('导入之书')
    // 携 initialBody 导入：第 1 章草稿直接落盘包含抓取正文
    const withContent = await post(base, '/api/library.import', {
      parentDir: parent,
      title: '带正文导入书',
      initialBody: '从外部抓取的章节正文第一段。',
    })
    expect(withContent.status).toBe(200)
    const contentRoot = withContent.data.root as string
    const chapterScan = readProseChapter(contentRoot, proseChapterPath(1))
    expect(chapterScan.phase).toBe('draft')
    expect(chapterScan.body).toContain('从外部抓取的章节正文第一段')

    // 重名导入（目录已存在）→ 409
    const dup = await post(base, '/api/library.import', { parentDir: parent, title: '导入之书' })
    expect(dup.status).toBe(409)
    expect(dup.data.ok).toBe(false)
    // 缺 title → 400
    const missing = await post(base, '/api/library.import', { parentDir: parent })
    expect(missing.status).toBe(400)
    expect(missing.data.ok).toBe(false)
  })
})

/* ----------------------------------------------------------------------------
 * 技能广场（能力注册表）API 契约：/api/capability-square（T46）。
 * 纯静态读面：5 组 17 项航道诚实状态 + evidence；providerAvailable 随
 * MOZHOU_DRAFT_PROVIDER 动态翻转（负路径默认 false，mock 显式开 true）。
 * ------------------------------------------------------------------------- */
describe('技能广场（能力注册表）API 契约', () => {
  it('POST /api/capability-square：5 组 17 项、id 唯一；占位航道不得标记原生可用；证据非空', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/capability-square', {})
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.providerAvailable).toBe(false)
    const groups = data.groups as { group: string; entries: { id: string; status: string; evidence: string }[] }[]
    expect(groups).toHaveLength(5)
    const entries = groups.flatMap((g) => g.entries)
    expect(entries).toHaveLength(17)
    expect(new Set(entries.map((e) => e.id)).size).toBe(17)
    // 航道词表与 views.ts 同源：抽查关键 id 存在
    expect(entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(['workbench', 'dialogue', 'story-brain', 'quality-gate', 'rank-scan', 'cloud-sync', 'membership']),
    )
    // 诚实状态：缺前提的航道显式声明，不假装可用
    const rank = entries.find((e) => e.id === 'rank-scan')
    expect(rank?.status).toBe('external_source_required')
    const dialogue = entries.find((e) => e.id === 'dialogue')
    expect(dialogue?.status).toBe('provider_required')
    const shelf = entries.find((e) => e.id === 'book-shelf')
    expect(shelf?.status).toBe('native')
    // 证据非空（能力不因名字存在而显示可用）
    for (const entry of entries) {
      expect(entry.evidence.length).toBeGreaterThan(0)
    }
  })

  it('POST /api/capability-square：MOZHOU_DRAFT_PROVIDER=mock 时 providerAvailable=true', async () => {
    const before = process.env['MOZHOU_DRAFT_PROVIDER']
    try {
      process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
      const base = await listen()
      const { status, data } = await post(base, '/api/capability-square', {})
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.providerAvailable).toBe(true)
    } finally {
      if (before === undefined) delete process.env['MOZHOU_DRAFT_PROVIDER']
      else process.env['MOZHOU_DRAFT_PROVIDER'] = before
    }
  })
})

/* ----------------------------------------------------------------------------
 * 我的作品（作品概览与章节目录）API 契约：/api/works（T47）。
 * ------------------------------------------------------------------------- */
describe('我的作品（作品概览与章节目录）API 契约', () => {
  it('POST /api/works：返回作品元数据、统计指标、章节列表与大纲骨架', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-works-api-'))
    roots.push(dir)
    const book = createBook({ dir: join(dir, '作品测试书'), title: '作品测试书' })
    const plane = LocalDataPlane.open(book.root)
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章 启程' })
    } finally {
      plane.close()
    }

    const { status, data } = await post(base, '/api/works', { root: book.root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect((data.book as { title: string }).title).toBe('作品测试书')
    const stats = data.stats as { totalChapters: number; totalWords: number; draftChapters: number }
    expect(stats.totalChapters).toBe(1)
    expect(stats.draftChapters).toBe(1)
    const chapters = data.chapters as { chapterIndex: number; title: string; phase: string }[]
    expect(chapters).toHaveLength(1)
    expect(chapters[0]?.chapterIndex).toBe(1)
    expect(chapters[0]?.phase).toBe('draft')
  })

  it('POST /api/works：缺 root 返回 400 显式错误', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/works', {})
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
  })

  it('POST /api/chapter.create：新建章节草稿、防重复与非法参数拦截', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-chapter-create-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { dir, title: '连载书' })
    const root = created.data.root as string

    // 成功创建第 2 章
    const res = await post(base, '/api/chapter.create', { root, chapterIndex: 2, title: '第二章 逆境' })
    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)
    expect(res.data.chapterIndex).toBe(2)
    expect(readProseChapter(root, proseChapterPath(2)).phase).toBe('draft')

    // 重复章号返回 409 CHAPTER_EXISTS
    const conflict = await post(base, '/api/chapter.create', { root, chapterIndex: 2, title: '重复章' })
    expect(conflict.status).toBe(409)
    expect(conflict.data.ok).toBe(false)
    expect(conflict.data.code).toBe('CHAPTER_EXISTS')

    // 非法章号 0、-1、1.5 返回 400
    for (const badIndex of [0, -1, 1.5]) {
      const bad = await post(base, '/api/chapter.create', { root, chapterIndex: badIndex, title: '错误章' })
      expect(bad.status).toBe(400)
      expect(bad.data.ok).toBe(false)
    }

    // 标题空白或超长（>200）返回 400
    const emptyTitle = await post(base, '/api/chapter.create', { root, chapterIndex: 3, title: '   ' })
    expect(emptyTitle.status).toBe(400)
    expect(emptyTitle.data.ok).toBe(false)

    const longTitle = await post(base, '/api/chapter.create', { root, chapterIndex: 3, title: '字'.repeat(201) })
    expect(longTitle.status).toBe(400)
    expect(longTitle.data.ok).toBe(false)

    // 缺 root 返回 400
    const noRoot = await post(base, '/api/chapter.create', { chapterIndex: 3, title: '无根' })
    expect(noRoot.status).toBe(400)
    expect(noRoot.data.ok).toBe(false)
  })

  it('POST /api/chapter.read 与 /api/chapter.save：正文读取、编辑安全保存与哈希冲突拦截', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-chapter-rw-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { dir, title: '编辑测试书' })
    const root = created.data.root as string

    // 1. 读取初始第 1 章
    const read1 = await post(base, '/api/chapter.read', { root, chapterIndex: 1 })
    expect(read1.status).toBe(200)
    expect(read1.data.ok).toBe(true)
    expect(read1.data.chapterIndex).toBe(1)
    expect(typeof read1.data.hash).toBe('string')
    const hash1 = read1.data.hash as string

    // 2. 用该 hash 保存新正文
    const save1 = await post(base, '/api/chapter.save', {
      root,
      chapterIndex: 1,
      body: '手动修改稿·第一版',
      baseHash: hash1,
    })
    expect(save1.status).toBe(200)
    expect(save1.data.ok).toBe(true)
    const hash2 = save1.data.hash as string
    expect(hash2).not.toBe(hash1)

    // 再次读取确认内容逐字一致
    const read2 = await post(base, '/api/chapter.read', { root, chapterIndex: 1 })
    expect(read2.status).toBe(200)
    expect((read2.data.body as string).trim()).toBe('手动修改稿·第一版')
    expect(read2.data.hash).toBe(hash2)

    // 3. 产生第三方中间修改
    const saveInterim = await post(base, '/api/chapter.save', {
      root,
      chapterIndex: 1,
      body: '第三方并发提交的正文',
      baseHash: hash2,
    })
    expect(saveInterim.status).toBe(200)

    // 4. 再次拿旧 hash2 保存，必须被 409 HASH_MISMATCH 拦截
    const conflict = await post(base, '/api/chapter.save', {
      root,
      chapterIndex: 1,
      body: '企图覆盖第三方的过期内容',
      baseHash: hash2,
    })
    expect(conflict.status).toBe(409)
    expect(conflict.data.ok).toBe(false)
    expect(conflict.data.code).toBe('HASH_MISMATCH')

    // 确认正文依然是第三方提交的内容，未被覆盖
    const readFinal = await post(base, '/api/chapter.read', { root, chapterIndex: 1 })
    expect((readFinal.data.body as string).trim()).toBe('第三方并发提交的正文')
  })

  it('POST /api/author-intent.update：五步向导资料落盘至 设定/作者意图.md 并刷新基线', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-intent-test-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { dir, title: '向导意图书' })
    const root = created.data.root as string

    const res = await post(base, '/api/author-intent.update', {
      root,
      worldRule: 'WORLD_RULE_TAG_0905',
      volumePromise: 'VOLUME_PROMISE_TAG_0905',
      opening: 'OPENING_TAG_0905',
      firstChapterGoal: 'FIRST_CHAPTER_GOAL_TAG_0905',
    })
    expect(res.status).toBe(200)
    expect(res.data.ok).toBe(true)

    const intentFile = join(root, '设定', '作者意图.md')
    const content = readFileSync(intentFile, 'utf8')
    expect(content).toContain('WORLD_RULE_TAG_0905')
    expect(content).toContain('VOLUME_PROMISE_TAG_0905')
    expect(content).toContain('OPENING_TAG_0905')
    expect(content).toContain('FIRST_CHAPTER_GOAL_TAG_0905')
  })

  it('POST /api/draft.stream：start 帧的 prompt 必须包含向导或设定中的世界规则与承诺', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-prompt-intent-'))
    roots.push(dir)
    const created = await post(base, '/api/book', { dir, title: '意图提示词书' })
    const root = created.data.root as string

    // 写入特异意图
    await post(base, '/api/author-intent.update', {
      root,
      worldRule: 'RULE_MUST_INCLUDE_IN_PROMPT_111',
      volumePromise: 'PROMISE_MUST_INCLUDE_IN_PROMPT_222',
      opening: 'OPENING_SCENE_IN_PROMPT_333',
      firstChapterGoal: 'GOAL_FIRST_CHAPTER_IN_PROMPT_444',
    })

    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    try {
      const res = await fetch(base + '/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, chapterIndex: 1, prompt: '动笔写第一段' }),
      })
      expect(res.status).toBe(200)
      const text = await res.text()
      const lines = text.split('\n').filter((l) => l.trim().length > 0)
      const startFrame = JSON.parse(lines[0] ?? '{}') as { ok: boolean; event: string; prompt: string }
      expect(startFrame.event).toBe('start')
      expect(startFrame.prompt).toContain('RULE_MUST_INCLUDE_IN_PROMPT_111')
      expect(startFrame.prompt).toContain('PROMISE_MUST_INCLUDE_IN_PROMPT_222')
    } finally {
      delete process.env['MOZHOU_DRAFT_PROVIDER']
    }
  })
})

/* ----------------------------------------------------------------------------
 * 任务中心（流水审计与 Traversal 历史）API 契约：/api/tasks（T48）。
 * ------------------------------------------------------------------------- */
describe('任务中心（流水审计与 Traversal 历史）API 契约', () => {
  it('POST /api/tasks：返回账本事件流水与 Traversal 记录', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-tasks-api-'))
    roots.push(dir)
    const book = createBook({ dir: join(dir, '任务测试书'), title: '任务测试书' })

    const { status, data } = await post(base, '/api/tasks', { root: book.root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(typeof data.totalEvents).toBe('number')
    expect(typeof data.totalTraversals).toBe('number')
    expect(Array.isArray(data.events)).toBe(true)
    expect(Array.isArray(data.traversals)).toBe(true)
  })

  it('POST /api/tasks：缺 root 返回 400 显式错误', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/tasks', {})
    expect(status).toBe(400)
    expect(data.ok).toBe(false)
    expect(typeof data.error).toBe('string')
  })
})

/* ----------------------------------------------------------------------------
 * 风格蒸馏 API 契约：/api/style 与 /api/style.distill（T50）。
 * ------------------------------------------------------------------------- */
describe('风格蒸馏 API 契约', () => {
  it('POST /api/style：读取当前书文风画像', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-style-api-'))
    roots.push(dir)
    const book = createBook({ dir: join(dir, '风格测试书'), title: '风格测试书' })

    const { status, data } = await post(base, '/api/style', { root: book.root })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.currentProfiles).not.toBeNull()
  })

  it('POST /api/style.distill：样本分析输出字数、对白比例、感官与动作密度', async () => {
    const base = await listen()
    const sample = '“拔剑！”少年厉喝一声，身形如电，长剑破空斩落。寒风呼啸，暗夜里火星迸溅。'
    const { status, data } = await post(base, '/api/style.distill', { text: sample })
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    const metrics = data.sampleMetrics as {
      charCount: number
      dialogueRatio: number
      actionPacing: number
      sepiaNarrativeScore: {
        pass1NarrativeArchitecture: number
        pass2DiscourseFlow: number
        pass3SurfacePurity: number
      }
    }
    expect(metrics.charCount).toBeGreaterThan(20)
    expect(metrics.dialogueRatio).toBeGreaterThan(0)
    expect(metrics.actionPacing).toBeGreaterThan(0)
    expect(metrics.sepiaNarrativeScore.pass1NarrativeArchitecture).toBeGreaterThan(0)
    expect(metrics.sepiaNarrativeScore.pass2DiscourseFlow).toBeGreaterThan(0)
    expect(metrics.sepiaNarrativeScore.pass3SurfacePurity).toBeGreaterThan(0)
  })
})

/* ----------------------------------------------------------------------------
 * 小说拆解 API 契约：/api/novel-breakdown（T51）。
 * ------------------------------------------------------------------------- */
describe('小说拆解 API 契约', () => {
  it('POST /api/novel-breakdown：真实分析 provider 未接入时显式 501', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/novel-breakdown', { sampleText: '凡人修仙故事梗概' })
    expect(status).toBe(501)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('NOVEL_BREAKDOWN_NOT_IMPLEMENTED')
    expect(data.result).toBeUndefined()
  })
})

/* ----------------------------------------------------------------------------
 * 端侧多源书源检索 API 契约：/api/book-source.search
 * ------------------------------------------------------------------------- */
describe('端侧多源书源检索 API 契约', () => {
  it('POST /api/book-source.search：检索空关键词返回空列表；非空时聚合结构完整', async () => {
    const base = await listen()
    const empty = await post(base, '/api/book-source.search', { query: '' })
    expect(empty.status).toBe(200)
    expect(empty.data.ok).toBe(true)
    expect(empty.data.total).toBe(0)

    const nonNull = await post(base, '/api/book-source.search', { query: '凡人' })
    expect(nonNull.status).toBe(200)
    expect(nonNull.data.ok).toBe(true)
    expect(Array.isArray(nonNull.data.books)).toBe(true)
    expect(typeof nonNull.data.degraded).toBe('boolean')
  })

  it('POST /api/crawler.extract：缺 URL 返回 400；私网/IPv6/非安全地址被安全策略拦截', async () => {
    const base = await listen()
    const missing = await post(base, '/api/crawler.extract', {})
    expect(missing.status).toBe(400)
    expect(missing.data.ok).toBe(false)

    // 私网 IPv4 拦截测试
    const ssrf = await post(base, '/api/crawler.extract', { url: 'http://127.0.0.1:8080/admin' })
    expect(ssrf.status).toBe(200)
    expect(ssrf.data.ok).toBe(false)
    expect(ssrf.data.error).toContain('SECURITY_REJECT')

    // IPv6 括号表示法 [::1] 拦截测试
    const ipv6Ssrf = await post(base, '/api/crawler.extract', { url: 'http://[::1]:8080/admin' })
    expect(ipv6Ssrf.status).toBe(200)
    expect(ipv6Ssrf.data.ok).toBe(false)
    expect(ipv6Ssrf.data.error).toContain('SECURITY_REJECT')

    // 云元数据 IP 拦截测试 (169.254.169.254)
    const metaSsrf = await post(base, '/api/crawler.extract', { url: 'http://169.254.169.254/latest/meta-data' })
    expect(metaSsrf.status).toBe(200)
    expect(metaSsrf.data.ok).toBe(false)
    expect(metaSsrf.data.error).toContain('SECURITY_REJECT')
  })
})

/* ----------------------------------------------------------------------------
 * 网文扫榜 API 契约：/api/rank-scan（T52）。
 * ------------------------------------------------------------------------- */
describe('网文扫榜 API 契约', () => {
  it('POST /api/rank-scan：无可验证实时榜单源时显式 501', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/rank-scan', {})
    expect(status).toBe(501)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('RANK_SOURCE_NOT_CONFIGURED')
    expect(data.boards).toBeUndefined()
    expect(data.trendingKeywords).toBeUndefined()
  })
})

/* ----------------------------------------------------------------------------
 * 联网搜索 API 契约：/api/web-search（T53）。
 * ------------------------------------------------------------------------- */
describe('联网搜索 API 契约', () => {
  it('POST /api/web-search：真实外部搜索源未接入时显式 501', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/web-search', { query: '唐代' })
    expect(status).toBe(501)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('WEB_SEARCH_NOT_CONFIGURED')
    expect(data.results).toBeUndefined()
  })
})

/* ----------------------------------------------------------------------------
 * 云同步与备份 API 契约：Technical Preview 明确区分本地状态与未实现备份。
 * ------------------------------------------------------------------------- */
describe('云同步与备份 API 契约', () => {
  it('POST /api/cloud-sync：返回本地离线优先状态与真实存储面', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/cloud-sync', {})
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.localReady).toBe(true)
    expect(data.syncStatus).toBe('offline_ready')
    expect((data.storageUsage as { databaseBytes: number }).databaseBytes).toBe(0)
  })

  it('POST /api/cloud-sync.backup：未实现时 501，绝不伪造归档路径或摘要', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-sync-api-'))
    roots.push(dir)
    const book = createBook({ dir: join(dir, '快照测试书'), title: '快照测试书' })

    const { status, data } = await post(base, '/api/cloud-sync.backup', { root: book.root })
    expect(status).toBe(501)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('BACKUP_NOT_IMPLEMENTED')
    expect(JSON.stringify(data)).not.toContain('sha256_mock_snapshot_digest')
    expect(data.backupPath).toBeUndefined()
  })
})

/* ----------------------------------------------------------------------------
 * 会员中心 API 契约：Technical Preview 仅社区免费版；支付/激活尚未上线。
 * ------------------------------------------------------------------------- */
describe('会员中心 API 契约', () => {
  it('POST /api/membership：社区免费版为当前版本，不伪造付费许可证', async () => {
    const base = await listen()
    const { status, data } = await post(base, '/api/membership', {})
    expect(status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.license).toBeNull()
    const plans = data.plans as { id: string; current: boolean; price: string }[]
    expect(plans.find((plan) => plan.id === 'free_community')?.current).toBe(true)
    expect(plans.find((plan) => plan.id === 'pro_lifetime')?.current).toBe(false)
  })

  it('GET /api/membership：支持运维健康检查与 CLI 探针直接获取社区版信息', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/membership`, { method: 'GET', headers: { Host: new URL(base).host } })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('free_community')
  })

  it('POST /api/membership.activate：服务未上线时一律 501，不做格式即授权', async () => {
    const base = await listen()
    const goodFormat = await post(base, '/api/membership.activate', { key: 'MOZHOU-PRO-LIFETIME-TEST' })
    expect(goodFormat.status).toBe(501)
    expect(goodFormat.data.ok).toBe(false)
    expect(goodFormat.data.code).toBe('LICENSE_ACTIVATION_NOT_IMPLEMENTED')

    const badFormat = await post(base, '/api/membership.activate', { key: 'invalid_raw_string' })
    expect(badFormat.status).toBe(501)
    expect(badFormat.data.code).toBe('LICENSE_ACTIVATION_NOT_IMPLEMENTED')
  })
})
