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
import { LocalDataPlane, createChapterDraft, entityCardFileRel, readManifest, openDatabase, readProseChapter, proseChapterPath } from '@mozhou/data-plane'
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
