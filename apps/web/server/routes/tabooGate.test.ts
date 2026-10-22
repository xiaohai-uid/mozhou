// @vitest-environment node
/**
 * 生效文风档案禁用词的确定性阻断（回归：tabooWords 此前只有存储与 prompt 注入，
 * 没有任何消费方，故「按生效规则阻断」不成立）。
 *
 * 缝：POST /api/chapter.review 的既有机械门（evaluateMechanicalGates 的 AI 红线项）。
 * 判据：命中禁用词 ⇒ mechanicalGate.passed=false ⇒ effectiveVerdict=blocking_fail
 *       ⇒ session.advance 409（拒收）。
 * 回炉（/api/chapter.rework）只接受文学 verdict=blocking_fail（session.ts 的
 * QualityReworkNotDrivenError）；纯禁用词命中时文学 verdict 仍是 pass，因此作者
 * 的处理路径是改文后重审，仅当文学 verdict 同为 blocking_fail 时才可走回炉。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import {
  LocalDataPlane,
  createBook,
  proseChapterPath,
  readNarrativeSnapshot,
  readStyleProfiles,
  renderProseChapter,
  scanEntityCards,
  serializeStyleProfiles,
} from '@mozhou/data-plane'
import { runCompileStep } from '@mozhou/pipeline'
import { newUlid } from '@mozhou/kernel'
import type { ContextReceiptId } from '@mozhou/kernel'
import { defaultBookAccessManager } from '../bookAccess.js'

const charTok = { version: 'fake-char-v1', count: (text: string) => text.length }

/** 确定性空规则策略：隔离文学语义层，只看机械门。 */
const DETERMINISTIC_ONLY_POLICY = {
  schemaVersion: 1 as const,
  projectId: 'taboo-gate-test',
  rules: [],
  maxAutomaticReworks: 2 as const,
}

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []
let originalDraftProvider: string | undefined

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  originalDraftProvider = process.env['MOZHOU_DRAFT_PROVIDER']
  process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
})

afterEach(() => {
  if (originalDraftProvider === undefined) {
    delete process.env['MOZHOU_DRAFT_PROVIDER']
  } else {
    process.env['MOZHOU_DRAFT_PROVIDER'] = originalDraftProvider
  }
  for (const server of servers) server.close()
  servers = []
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
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

async function post(base: string, path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

/** 按 T23 存储格式把 action 场景型的禁用词写回文风.md（唯一真源）。 */
function seedTabooWords(dir: string, words: readonly string[]): void {
  const raw = readFileSync(join(dir, '文风.md'), 'utf8')
  const rows = readStyleProfiles(dir)
  const next = { ...rows, action: { ...rows.action, tabooWords: words } }
  writeFileSync(join(dir, '文风.md'), serializeStyleProfiles(raw, next), 'utf8')
}

function writeDraft(dir: string, bookId: string, body: string): void {
  writeFileSync(
    join(dir, proseChapterPath(1)),
    renderProseChapter({ mozhouId: bookId, revision: 1, chapterIndex: 1, phase: 'draft', body }),
    'utf8',
  )
}

/** 建书 → 建章 → 写草稿 → 真编译（产锚点）→ 会话推进到 review。 */
async function prepareReviewableChapter(base: string, dir: string, body: string): Promise<string> {
  createBook({ dir, title: '禁用词测试书' })

  const plane = LocalDataPlane.open(dir)
  const bookId = plane.book.id
  plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
  plane.saveEntityCard('char:shaonian', {
    name: '少年',
    aiContext: 'detected',
    aliases: [{ text: '少年', kind: 'exact' }],
    brief: '按剑伫立孤城边的少年剑客',
  })
  plane.close()

  writeDraft(dir, bookId, body)

  await runCompileStep(
    { chapterIndex: 1, staleMarker: null },
    {
      bookRoot: dir,
      bookId,
      draftText: body,
      cards: scanEntityCards(dir),
      snapshot: readNarrativeSnapshot(dir),
      scope: { chapterIndex: 1, pov: 'protagonist' },
      modelProfile: { id: 'taboo-gate-test', contextWindow: 4096 },
      tokenizer: charTok,
      receiptId: ('rcpt_' + newUlid()) as ContextReceiptId,
      nowIso: '2026-10-21T00:00:00.000Z',
    },
  )

  await post(base, '/api/session.open', { root: dir, chapterIndex: 1 })
  await post(base, '/api/session.advance', { root: dir, chapterIndex: 1 })
  await post(base, '/api/session.advance', { root: dir, chapterIndex: 1 })
  return bookId
}

function review(base: string, dir: string) {
  return post(base, '/api/chapter.review', {
    root: dir,
    chapterIndex: 1,
    policy: DETERMINISTIC_ONLY_POLICY,
    mechanicalOptions: { minWords: 0 },
  })
}

describe('生效文风档案禁用词的确定性阻断', () => {
  it('命中禁用词 ⇒ 机械门失败 ⇒ blocking_fail，前进被拒（D1），改文后重审通过', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-taboo-block-'))
    tempDirs.push(dir)
    const bookId = await prepareReviewableChapter(base, dir, '少年被称作废柴，却仍旧握紧了剑。')
    seedTabooWords(dir, ['废柴'])

    const { status, data } = await review(base, dir)
    expect(status).toBe(200)
    expect(data['verdict']).toBe('blocking_fail')
    expect((data['mechanicalGate'] as { passed: boolean }).passed).toBe(false)
    const failures = data['mechanicalFailures'] as string[]
    expect(failures.some((failure) => failure.includes('废柴'))).toBe(true)

    // 既有拒收路径（D1）：机械门失败时前进出口关闭，未过门不得推进到 user_edit。
    // 机械门失败的返工语义是「作者改文后重审」（MechanicalGateNotPassedError 的
    // 契约），不是 /api/chapter.rework（那条路只接受文学 verdict=blocking_fail）。
    const advance = await post(base, '/api/session.advance', { root: dir, chapterIndex: 1 })
    expect(advance.status).toBe(409)

    // 对照：改写掉禁用词后同一章重审必须通过（阻断是内容驱动，不是粘滞状态）
    writeDraft(dir, bookId, '少年握紧了剑，目光沉稳。')
    const clean = await review(base, dir)
    expect(clean.status).toBe(200)
    expect(clean.data['verdict']).toBe('pass')
    expect((clean.data['mechanicalGate'] as { passed: boolean }).passed).toBe(true)
  })

  it('禁用词按字面量匹配：含正则元字符的词不误伤其它文本', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-taboo-literal-'))
    tempDirs.push(dir)
    const bookId = await prepareReviewableChapter(base, dir, '少年喊出 AAAB 这个暗号。')
    seedTabooWords(dir, ['A+B'])

    // A+B 是字面量禁用词，不是正则源：AAAB 不得被误判命中
    const noHit = await review(base, dir)
    expect(noHit.status).toBe(200)
    expect(noHit.data['verdict']).toBe('pass')

    writeDraft(dir, bookId, '少年喊出 A+B 这个暗号。')
    const hit = await review(base, dir)
    expect(hit.status).toBe(200)
    expect(hit.data['verdict']).toBe('blocking_fail')
    expect((hit.data['mechanicalFailures'] as string[]).some((failure) => failure.includes('自定义反例'))).toBe(true)
  })
})
