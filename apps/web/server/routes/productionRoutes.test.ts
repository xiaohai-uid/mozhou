// @vitest-environment node
/**
 * 十步生产会话与恢复 (T06 · 真实 HTTP 级端到端测试)。
 * 
 * 依照 reference/01-core.md T06 规格：
 * 1. 测无 session 发起 step 操作 → 409 拒绝；
 * 2. 每本书最多一个有效写会话：同书未关闭重复 open → 409 SESSION_ALREADY_ACTIVE；
 * 3. 对公开 session.advance 设防：禁止直接跳步到 commit，必须通过管线真实质量门；
 * 4. chapter.review 正常运行审查并生成锚定当前草稿版本的不可变报告；
 * 5. 跨书隔离与会话状态机幂等恢复。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import {
  createBook,
  LocalDataPlane,
  readNarrativeSnapshot,
  renderProseChapter,
  scanEntityCards,
} from '@mozhou/data-plane'
import { runCompileStep } from '@mozhou/pipeline'
import { newUlid } from '@mozhou/kernel'
import { defaultBookAccessManager } from '../bookAccess.js'

const charTok = { version: 'fake-char-v1', count: (text: string) => text.length }

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
})

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${addr.port}`)
    })
  })
}

describe('十步生产状态机与会话恢复 (T06)', () => {
  it('无 open session 时调用 session.advance 或 chapter.review → 409', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t06-nosess-'))
    tempDirs.push(dir)
    createBook({ dir, title: '测试书' })

    // 1. 无会话 advance → 409
    const resAdvance = await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resAdvance.status).toBe(409)
    const dataAdvance = (await resAdvance.json()) as { ok: boolean; error: string }
    expect(dataAdvance.ok).toBe(false)
    expect(dataAdvance.error).toContain('no open production session')

    // 2. 无会话 review → 409
    const resReview = await fetch(`${base}/api/chapter.review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resReview.status).toBe(409)
    const dataReview = (await resReview.json()) as { ok: boolean; error: string }
    expect(dataReview.ok).toBe(false)
    expect(dataReview.error).toContain('no open production session')
  })

  it('每书最多一个有效写会话：同书未关闭重复 open → 409', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t06-single-'))
    tempDirs.push(dir)
    createBook({ dir, title: '单写测试书' })

    // 首次 open 成功
    const res1 = await fetch(`${base}/api/session.open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(res1.status).toBe(200)
    const data1 = (await res1.json()) as { ok: boolean; taskRef: string; currentStep: string }
    expect(data1.ok).toBe(true)
    expect(data1.currentStep).toBe('prepare')

    // 同一章重复 open → 409 SESSION_ALREADY_ACTIVE
    const res2 = await fetch(`${base}/api/session.open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(res2.status).toBe(409)
    const data2 = (await res2.json()) as { ok: boolean; error: string }
    expect(data2.ok).toBe(false)
  })

  it('禁止通过 session.advance 直接跳步到 commit', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t06-nocommit-'))
    tempDirs.push(dir)
    createBook({ dir, title: '禁跳步书' })

    // 打开会话 (初始处于 prepare)
    await fetch(`${base}/api/session.open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })

    // 步进到 compile
    const resAdv1 = await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resAdv1.status).toBe(200)
    const dataAdv1 = (await resAdv1.json()) as { ok: boolean; currentStep: string }
    expect(dataAdv1.currentStep).toBe('compile')

    // 步进到 draft
    const resAdv2 = await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resAdv2.status).toBe(200)
    const dataAdv2 = (await resAdv2.json()) as { ok: boolean; currentStep: string }
    expect(dataAdv2.currentStep).toBe('draft')

    // 步进到 review
    const resAdv3 = await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resAdv3.status).toBe(200)

    // 试图从 review 盲推到 user_edit（未做文学审查）必须被 409 拒绝，无法跳向 commit
    const resAdv4 = await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resAdv4.status).toBe(409)
    const dataAdv4 = (await resAdv4.json()) as { ok: boolean; error: string }
    expect(dataAdv4.ok).toBe(false)
    expect(dataAdv4.error).toContain('literary review verdict')
  })

  it('chapter.review 真实执行并生成带哈希锚定的审查报告', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t06-review-'))
    tempDirs.push(dir)
    createBook({ dir, title: '审查书' })

    // 先落盘真实草稿
    const plane = LocalDataPlane.open(dir)
    const bookId = plane.book.id
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    const prose = renderProseChapter({
      mozhouId: plane.book.id,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: '夜幕低垂，狂风卷着黄沙掠过孤城。少年按剑伫立，眼神坚毅。',
    })
    writeFileSync(join(dir, 'chapter_0001.md'), prose, 'utf8')
    // 目录卡：编译的召回通道需要非空候选集，空集会按 T10a AC3 拒答（诚实降级）。
    plane.saveEntityCard('char:shaonian', {
      name: '少年',
      aiContext: 'detected',
      aliases: [{ text: '少年', kind: 'exact' }],
      brief: '按剑伫立孤城边的少年剑客',
    })
    plane.close()

    // 真编译一次：产平铺 ContextCompiled 指针 + receipt 文件。
    // 本用例考的是「审查产出带真锚点的报告」，锚点必须真的来自编译，
    // 旧实现此处取不到就编一个 rcpt_web_1 落进报告。
    await runCompileStep(
      { chapterIndex: 1, staleMarker: null },
      {
        bookRoot: dir,
        bookId: bookId,
        draftText: '夜幕低垂，狂风卷着黄沙掠过孤城。少年按剑伫立，眼神坚毅。',
        cards: scanEntityCards(dir),
        snapshot: readNarrativeSnapshot(dir),
        scope: { chapterIndex: 1, pov: 'protagonist' },
        modelProfile: { id: 't06-review-test', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId: ('rcpt_' + newUlid()) as never,
        nowIso: '2026-09-27T00:00:00.000Z',
      },
    )

    // 打开会话并步进到 compile → draft
    await fetch(`${base}/api/session.open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })

    // 发起审查
    const resReview = await fetch(`${base}/api/chapter.review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resReview.status).toBe(200)
    const dataReview = (await resReview.json()) as {
      ok: boolean
      verdict: string
      reportId: string
      reportPath: string
      draftRevision: number
      draftContentHash: string
      mechanicalGate: unknown
    }
    expect(dataReview.ok).toBe(true)
    expect(typeof dataReview.verdict).toBe('string')
    expect(typeof dataReview.reportId).toBe('string')
    expect(typeof dataReview.draftRevision).toBe('number')
    expect(typeof dataReview.draftContentHash).toBe('string')
    expect(dataReview.draftContentHash.length).toBe(64)

    // 锚点必须是真编译凭证，不是编出来的
    const reportPath = join(dir, dataReview.reportPath.replace(/\\/g, '/'))
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { anchor: { receiptId: string } }
    expect(report.anchor.receiptId).not.toBe('rcpt_web_1')
  })

  it('D10：该章无编译凭证时 chapter.review → 409 NO_COMPILED_RECEIPT 且不产报告', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t06-noanchor-'))
    tempDirs.push(dir)
    createBook({ dir, title: '无锚书' })

    const plane = LocalDataPlane.open(dir)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    const prose = renderProseChapter({
      mozhouId: plane.book.id,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: '夜幕低垂，狂风卷着黄沙掠过孤城。',
    })
    writeFileSync(join(dir, 'chapter_0001.md'), prose, 'utf8')
    plane.close()

    // 打开会话并步进到 review，但**不**跑编译 ⇒ 真的没有编译凭证
    await fetch(`${base}/api/session.open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    await fetch(`${base}/api/session.advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })

    const res = await fetch(`${base}/api/chapter.review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })

    expect(res.status).toBe(409)
    const data = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('NO_COMPILED_RECEIPT')
    expect(data.error).toContain('编译凭证')

    // 不得有任何报告被写出来
    expect(existsSync(join(dir, '.mozhou', 'quality-reviews', 'chapter_1'))).toBe(false)
  })
});
