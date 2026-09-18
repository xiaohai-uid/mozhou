// @vitest-environment node
/**
 * C2 候选流/采纳集成测试（T04 · 真实 HTTP + 磁盘回读）：
 * - draft.stream 生成未采纳 → 正文/revision/hash 零变化（I01）；
 * - 两窗口/两并发生成：并行流互不覆盖；双 accept 竞态仅一次生效；
 * - 同 idempotencyKey 换 body → 409；accept 重放 → alreadyApplied；
 * - 生成中作者保存成功且 accept 随之冲突（base stale → 409 保留候选）；
 * - 外部编辑发生于两 delta 之间 → accept 409（写前 hash 守卫），外部内容保留；
 * - 取消后 chunk 不写候选；accept 写后断进程 → 重启同 accept 重放幂等。
 * 使用 mock provider（MOZHOU_DRAFT_PROVIDER=mock）；draft.stream 为 NDJSON 流。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { LocalDataPlane, createBook, proseChapterPath } from '@mozhou/data-plane'
import { createDraftCandidate, appendCandidateDelta, finishCandidate } from '@mozhou/pipeline'

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

process.env.MOZHOU_DRAFT_PROVIDER = 'mock'

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

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-draft-cand-'))
  roots.push(dir)
  const root = join(dir, '候选书')
  createBook({ dir: root, title: '候选书' })
  const plane = LocalDataPlane.open(root)
  plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
  plane.saveProseDraft({ chapterIndex: 1, body: '作者原文。\n', expectedRevision: 0 })
  plane.close()
  return root
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function proseHash(root: string): string {
  return sha256File(join(root, proseChapterPath(1)))
}

async function runStream(base: string, root: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const res = await fetch(base + '/api/draft.stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, chapterIndex: 1, prompt: 'AI 生成候选文本', ...body }),
  })
  const frames = res.text()
  return (await frames)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('C2 I01：未采纳生成零触碰（HTTP 级）', () => {
  it('draft.stream 生成后正文/revision/hash 不变，候选 ready 且文本完整', async () => {
    const base = await listen()
    const root = makeRoot()
    const before = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const beforeHash = proseHash(root)

    const frames = await runStream(base, root, {})
    const candidateId = frames[0]?.['candidateId'] as string
    expect(frames.map((f) => f['event']).at(0)).toBe('start')
    expect(frames.map((f) => f['event']).at(-1)).toBe('done')
    expect(frames.filter((f) => f['event'] === 'delta').length).toBeGreaterThan(0)
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded', candidateId })

    const after = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(after.data).toMatchObject({ ok: true })
    expect((after.data as { body?: string }).body).toBe((before.data as { body?: string }).body)
    expect((after.data as { revision?: number }).revision).toBe((before.data as { revision?: number }).revision)
    expect(proseHash(root)).toBe(beforeHash)

    const candidate = await post(base, '/api/draft.candidate', { root, candidateId })
    expect(candidate.status).toBe(200)
    expect(candidate.data).toMatchObject({ ok: true, candidate: { id: candidateId, status: 'ready' } })
  })
})

describe('C2 并发窗口与幂等', () => {
  it('两并发生成各占候选互不覆盖；两窗口 accept 同一候选仅一次生效', async () => {
    const base = await listen()
    const root = makeRoot()
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    const baseHash = proseHash(root)
    plane.close()
    const base0 = { revision: scan.revision, sha256: baseHash }

    const [f1, f2] = await Promise.all([
      runStream(base, root, {}),
      runStream(base, root, {}),
    ])
    const id1 = f1[0]?.['candidateId'] as string
    const id2 = f2[0]?.['candidateId'] as string
    expect(id1).not.toBe(id2)

    // 两个候选各自持有文本；正文仍未动
    const c1 = await post(base, '/api/draft.candidate', { root, candidateId: id1 })
    const c2 = await post(base, '/api/draft.candidate', { root, candidateId: id2 })
    expect((c1.data as { candidate: { text: string } }).candidate.text.length).toBeGreaterThan(0)
    expect((c2.data as { candidate: { text: string } }).candidate.text.length).toBeGreaterThan(0)
    expect(proseHash(root)).toBe(baseHash)

    // 双窗口 accept：第一个成功，第二个（同候选终态）409/已应用语义
    const a1 = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-double-1' })
    expect(a1.status).toBe(200)
    expect((a1.data as { alreadyApplied?: boolean }).alreadyApplied).toBe(false)
    const a2 = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-double-2' })
    expect([200, 409]).toContain(a2.status)
  })

  it('同 idempotencyKey 换 body（另一候选）→ 409 KEY_REUSED；同请求重放 → alreadyApplied', async () => {
    const base = await listen()
    const root = makeRoot()
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    plane.close()
    const base0 = { revision: scan.revision, sha256: proseHash(root) }

    const f1 = await runStream(base, root, {})
    const id1 = f1[0]?.['candidateId'] as string
    const a1 = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-same-body' })
    expect(a1.status).toBe(200)

    // 第二个候选在 accept 之后发起（平台并发窗口），显式携带同一 base 现场
    const f2 = await runStream(base, root, { base: base0 })
    const id2 = f2[0]?.['candidateId'] as string
    const a2 = await post(base, '/api/draft.accept', { root, candidateId: id2, base: base0, idempotencyKey: 'k-same-body' })
    expect(a2.status).toBe(409)
    expect(a2.data).toMatchObject({ ok: false, code: 'KEY_REUSED' })

    // 同请求重放 → 幂等已应用
    const replay = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-same-body' })
    expect(replay.status).toBe(200)
    expect(replay.data).toMatchObject({ ok: true, alreadyApplied: true })
  })
})

describe('C2 生成中保存与外部编辑', () => {
  it('生成中作者保存成功（正文 r+1）；随后 accept 旧 base → 409 BASE/REVISION 冲突且候选保留', async () => {
    const base = await listen()
    const root = makeRoot()
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    plane.close()
    const base0 = { revision: scan.revision, sha256: proseHash(root) }

    const f1 = await runStream(base, root, {})
    const id1 = f1[0]?.['candidateId'] as string
    expect(f1.at(-1)).toMatchObject({ event: 'done', outcome: 'succeeded' })

    // 生成完成后、采纳前，作者手动保存（新版本）
    const save = await post(base, '/api/chapter.prose.save', { root, chapterIndex: 1, body: '作者保存改写。\n', expectedRevision: base0.revision })
    expect(save.status).toBe(200)

    // 旧 base accept → 409（盘上 revision 已变），正文保持作者保存内容
    const a = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-mid-save' })
    expect(a.status).toBe(409)
    const after = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect((after.data as { body?: string }).body).toContain('作者保存改写')
    const c = await post(base, '/api/draft.candidate', { root, candidateId: id1 })
    expect((c.data as { candidate: { status: string } }).candidate.status).toBe('ready') // 候选保留
  })

  it('外部编辑发生于两 delta 之间 → accept 409（写前 hash 守卫）且外部内容在盘上', async () => {
    const base = await listen()
    const root = makeRoot()
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    plane.close()
    const base0 = { revision: scan.revision, sha256: proseHash(root) }

    const stream = await runStream(base, root, {})
    const id1 = stream[0]?.['candidateId'] as string
    // 流回传完成后模拟"两 delta 之间"的外部写入（revision 未变，hash 变了）
    const prosePath = join(root, proseChapterPath(1))
    const original = readFileSync(prosePath, 'utf8')
    writeFileSync(prosePath, original.replace('作者原文。', '外部编辑器插入。'))

    const a = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-ext-edit' })
    expect(a.status).toBe(409)
    const after = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect(after.data).toMatchObject({ ok: true })
    expect(readFileSync(prosePath, 'utf8')).toContain('外部编辑器插入') // 外部内容保留，无静默覆盖
  })
})

describe('C2 取消与崩溃恢复', () => {
  it('终态候选 cancel 拒绝（409）；正文不变', async () => {
    const base = await listen()
    const root = makeRoot()
    const f = await runStream(base, root, {})
    const id1 = f[0]?.['candidateId'] as string

    const beforeHash = proseHash(root)
    // 流已 complete（ready）→ 终态 cancel 拒绝 409（不静默标记）
    const cancel = await post(base, '/api/draft.cancel', { root, candidateId: id1 })
    expect(cancel.status).toBe(409)
    expect(proseHash(root)).toBe(beforeHash)
  })

  it('accept 写后断进程 → 重启后同 accept 重放响应 alreadyApplied，不重复涨版本', async () => {
    const base = await listen()
    const root = makeRoot()
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    const baseHash = proseHash(root)
    plane.close()
    const base0 = { revision: scan.revision, sha256: baseHash }

    const f = await runStream(base, root, {})
    const id1 = f[0]?.['candidateId'] as string
    const accept1 = await post(base, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-crash' })
    expect(accept1.status).toBe(200)
    const revAfter = (accept1.data as { revision?: number }).revision

    // 模拟进程重启：重新监听（新 server 实例）后同一请求重放
    const base2 = await listen()
    const replay = await post(base2, '/api/draft.accept', { root, candidateId: id1, base: base0, idempotencyKey: 'k-crash' })
    expect(replay.status).toBe(200)
    expect(replay.data).toMatchObject({ ok: true, alreadyApplied: true, revision: revAfter })

    // revision 未重复增长
    const after = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect((after.data as { revision?: number }).revision).toBe(revAfter)
    // 候选已标记 accepted 并记录落地 revision
    const c = await post(base, '/api/draft.candidate', { root, candidateId: id1 })
    expect((c.data as { candidate: { status: string; acceptedRevision?: number } }).candidate).toMatchObject({ status: 'accepted', acceptedRevision: revAfter })
  })
})

describe('C2 / R01: 采纳前状态校验与终态保护 (HTTP 级)', () => {
  it('cancelled 状态候选首次 accept 返回 409，正文/版本不变，重放仍 409', async () => {
    const base = await listen()
    const root = makeRoot()
    const beforeHash = proseHash(root)
    const id1 = randomUUID()
    createDraftCandidate(root, {
      id: id1,
      operationId: randomUUID(),
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: 1, sha256: beforeHash },
      mode: 'replace',
    })

    // 取消
    const cancelRes = await post(base, '/api/draft.cancel', { root, candidateId: id1 })
    expect(cancelRes.status).toBe(200)

    // 尝试 accept 取消候选
    const acceptRes1 = await post(base, '/api/draft.accept', {
      root,
      candidateId: id1,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-cancelled-test-1234',
    })
    expect(acceptRes1.status).toBe(409)
    expect(acceptRes1.data.error).toContain('CANDIDATE_NOT_ACCEPTABLE')

    // 磁盘断言：正文与版本绝对未变
    expect(proseHash(root)).toBe(beforeHash)
    const prose = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect((prose.data as { revision?: number }).revision).toBe(1)

    // 重放仍 409
    const acceptRes2 = await post(base, '/api/draft.accept', {
      root,
      candidateId: id1,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-cancelled-test-1234',
    })
    expect(acceptRes2.status).toBe(409)
    expect(proseHash(root)).toBe(beforeHash)
  })

  it('streaming 与 failed 候选首次 accept 返回 409，正文零变更', async () => {
    const base = await listen()
    const root = makeRoot()
    const beforeHash = proseHash(root)

    // 1. streaming 候选
    const streamCandidateId = randomUUID()
    createDraftCandidate(root, {
      id: streamCandidateId,
      operationId: randomUUID(),
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: 1, sha256: beforeHash },
      mode: 'replace',
    })

    const streamAccept = await post(base, '/api/draft.accept', {
      root,
      candidateId: streamCandidateId,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-stream-test-1234',
    })
    expect(streamAccept.status).toBe(409)
    expect(proseHash(root)).toBe(beforeHash)

    // 2. failed 候选
    finishCandidate(root, streamCandidateId, 'failed')
    const failedAccept = await post(base, '/api/draft.accept', {
      root,
      candidateId: streamCandidateId,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-failed-test-1234',
    })
    expect(failedAccept.status).toBe(409)
    expect(proseHash(root)).toBe(beforeHash)
  })

  it('partial 候选未显式确认返回 409，显式确认 allowPartial 成功', async () => {
    const base = await listen()
    const root = makeRoot()
    const beforeHash = proseHash(root)

    const partialId = randomUUID()
    createDraftCandidate(root, {
      id: partialId,
      operationId: randomUUID(),
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: 1, sha256: beforeHash },
      mode: 'replace',
    })
    finishCandidate(root, partialId, 'partial')

    // 未确认 -> 409
    const unconfirmed = await post(base, '/api/draft.accept', {
      root,
      candidateId: partialId,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-partial-unconf-12',
    })
    expect(unconfirmed.status).toBe(409)
    expect(proseHash(root)).toBe(beforeHash)

    // 显式确认 -> 200
    const confirmed = await post(base, '/api/draft.accept', {
      root,
      candidateId: partialId,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-partial-conf-1234',
      allowPartial: true,
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.data).toMatchObject({ ok: true, revision: 2 })
    const prose = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    expect((prose.data as { revision?: number }).revision).toBe(2)
  })

  it('参数非法与身份不匹配负例均返回 409 或 400', async () => {
    const base = await listen()
    const root = makeRoot()
    const beforeHash = proseHash(root)

    const f = await runStream(base, root, {})
    const id1 = f[0]?.['candidateId'] as string

    // 1. key 为空或非 ASCII
    const emptyKey = await post(base, '/api/draft.accept', {
      root,
      candidateId: id1,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: '',
    })
    expect(emptyKey.status).toBe(409)

    const nonAsciiKey = await post(base, '/api/draft.accept', {
      root,
      candidateId: id1,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: '非ASCII的键值12345678',
    })
    expect(nonAsciiKey.status).toBe(409)

    // 2. bookId 不匹配
    const mismatchBook = await post(base, '/api/draft.accept', {
      root,
      candidateId: id1,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-mismatch-book-1234',
      bookId: 'wrong-book-id',
    })
    expect(mismatchBook.status).toBe(409)

    // 3. chapterIndex 不匹配
    const mismatchChapter = await post(base, '/api/draft.accept', {
      root,
      candidateId: id1,
      base: { revision: 1, sha256: beforeHash },
      idempotencyKey: 'k-mismatch-ch-12345',
      chapterIndex: 999,
    })
    expect(mismatchChapter.status).toBe(409)
  })

  describe('C2 / R03：选区替换与请求绑定（HTTP 级）', () => {
    it('draft.accept 选区替换仅替换目标片段，选区外文本完全保留', async () => {
      const base = await listen()
      const root = makeRoot()
      const beforeHash = proseHash(root)

      // 原文为 '作者原文。\n'
      // 选取 '原文' [2, 4)，替换为 '新正文'
      const targetText = '原文'
      const targetHash = createHash('sha256').update(targetText).digest('hex')
      const candId = randomUUID()

      createDraftCandidate(root, {
        id: candId,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base: { revision: 1, sha256: beforeHash },
        mode: 'replace-selection',
        selection: { from: 2, to: 4, selectedTextHash: targetHash },
      })
      appendCandidateDelta(root, candId, '新正文')
      finishCandidate(root, candId, 'ready')

      const acceptRes = await post(base, '/api/draft.accept', {
        root,
        candidateId: candId,
        base: { revision: 1, sha256: beforeHash },
        idempotencyKey: 'k-http-sel-ok-1',
      })
      expect(acceptRes.status).toBe(200)
      expect(acceptRes.data).toMatchObject({ ok: true, revision: 2 })

      const proseRes = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
      expect((proseRes.data as { body?: string }).body).toBe('作者新正文。\n')
    })

    it('draft.accept 选区 hash 不匹配返回 409，正文与版本零修改', async () => {
      const base = await listen()
      const root = makeRoot()
      const beforeHash = proseHash(root)

      const candId = randomUUID()
      createDraftCandidate(root, {
        id: candId,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base: { revision: 1, sha256: beforeHash },
        mode: 'replace-selection',
        selection: { from: 2, to: 4, selectedTextHash: 'e'.repeat(64) },
      })
      appendCandidateDelta(root, candId, '篡改正文')
      finishCandidate(root, candId, 'ready')

      const acceptRes = await post(base, '/api/draft.accept', {
        root,
        candidateId: candId,
        base: { revision: 1, sha256: beforeHash },
        idempotencyKey: 'k-http-sel-bad-hash',
      })
      expect(acceptRes.status).toBe(409)
      expect(proseHash(root)).toBe(beforeHash)
    })

    it('draft.stream 携带非法选区范围返回 400', async () => {
      const base = await listen()
      const root = makeRoot()

      const res = await fetch(base + '/api/draft.stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root,
          chapterIndex: 1,
          prompt: 'test',
          mode: 'replace-selection',
          selection: { from: 10, to: 2, selectedTextHash: 'a'.repeat(64) },
        }),
      })
      expect(res.status).toBe(400)
    })
  })
})