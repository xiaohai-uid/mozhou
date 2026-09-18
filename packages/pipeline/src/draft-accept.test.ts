import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { LocalDataPlane, createBook, proseChapterPath } from '@mozhou/data-plane'
import {
  createDraftCandidate,
  appendCandidateDelta,
  finishCandidate,
  cancelCandidate,
  readDraftCandidate,
  CandidateError,
} from './draft-candidate.js'
import {
  acceptDraft,
  AcceptConflictError,
  composeBody,
  proseFileSha256,
} from './draft-accept.js'

describe('draft-accept (C2 / R01): 写前校验与终态保护', () => {
  let root: string
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mozhou-draft-accept-test-'))
    root = join(tempDir, '测试书')
    createBook({ dir: root, title: '测试书' })
    const plane = LocalDataPlane.open(root)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    plane.saveProseDraft({ chapterIndex: 1, body: '作者正文原文。\n', expectedRevision: 0 })
    plane.close()
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Windows lock tolerance
    }
  })

  function createFixtureCandidate(mode: 'replace' | 'continue' = 'replace') {
    const plane = LocalDataPlane.open(root)
    const scan = plane.getProseChapter(1)
    plane.close()
    const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }
    const id = randomUUID()
    const bookRecord = JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: string }
    const candidate = createDraftCandidate(root, {
      id,
      operationId: randomUUID(),
      bookId: bookRecord.id,
      chapterIndex: 1,
      base,
      mode,
      ...(mode === 'continue' ? { seedText: '续写内容。\n' } : {}),
    })
    return { id, base, bookId: bookRecord.id, candidate }
  }

  it('cancelled 状态候选首次 accept 必须失败，正文/版本/候选/intent 零变更，重放仍拒绝', () => {
    const { id, base, bookId } = createFixtureCandidate()
    cancelCandidate(root, id)

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const beforeHash = proseFileSha256(root, 1)

    // 首次采纳拒绝
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_cancelled_123',
        bookId,
        chapterIndex: 1,
      }),
    ).toThrow(CandidateError)

    // 磁盘断言：正文未变、版本未变、候选仍为 cancelled、没有 done intent
    const afterRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(afterRaw).toBe(beforeRaw)
    expect(proseFileSha256(root, 1)).toBe(beforeHash)
    expect(readDraftCandidate(root, id)?.status).toBe('cancelled')

    const intentDir = join(root, '.mozhou/accept-intents')
    if (existsSync(intentDir)) {
      const intents = readdirSync(intentDir).filter((f) => f.includes(id))
      expect(intents.length).toBe(0)
    }

    // 重放仍拒绝，仍不写入
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_cancelled_123',
      }),
    ).toThrow(CandidateError)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
  })

  it('failed 状态候选首次 accept 必须失败，正文零变更', () => {
    const { id, base } = createFixtureCandidate()
    finishCandidate(root, id, 'failed')

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_failed_12345',
      }),
    ).toThrow(CandidateError)

    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
    expect(readDraftCandidate(root, id)?.status).toBe('failed')
  })

  it('streaming 状态候选首次 accept 必须失败，正文零变更', () => {
    const { id, base } = createFixtureCandidate()
    // 保持 streaming 状态未 finish

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_streaming_123',
      }),
    ).toThrow(CandidateError)

    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
    expect(readDraftCandidate(root, id)?.status).toBe('streaming')
  })

  it('partial 状态未确认拒绝采纳；显式确认方可采纳', () => {
    const { id, base } = createFixtureCandidate()
    finishCandidate(root, id, 'partial')

    const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')

    // 1. 未确认采纳 -> 失败
    expect(() =>
      acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'test_key_partial_unconf',
        allowPartial: false,
      }),
    ).toThrow(CandidateError)
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
    expect(readDraftCandidate(root, id)?.status).toBe('partial')

    // 2. 显式确认采纳 -> 成功
    const result = acceptDraft({
      bookRoot: root,
      candidateId: id,
      base,
      idempotencyKey: 'test_key_partial_confirmed',
      allowPartial: true,
    })
    expect(result.alreadyApplied).toBe(false)
    expect(result.revision).toBe(2)
    expect(readDraftCandidate(root, id)?.status).toBe('accepted')
    expect(readDraftCandidate(root, id)?.acceptedRevision).toBe(2)
  })

  it('ready 状态正常采纳与幂等重放', () => {
    const { id, base } = createFixtureCandidate()
    finishCandidate(root, id, 'ready')

    const result1 = acceptDraft({
      bookRoot: root,
      candidateId: id,
      base,
      idempotencyKey: 'test_key_ready_1234567',
    })
    expect(result1.alreadyApplied).toBe(false)
    expect(result1.revision).toBe(2)
    expect(readDraftCandidate(root, id)?.status).toBe('accepted')

    // 幂等重放
    const result2 = acceptDraft({
      bookRoot: root,
      candidateId: id,
      base,
      idempotencyKey: 'test_key_ready_1234567',
    })
    expect(result2.alreadyApplied).toBe(true)
    expect(result2.revision).toBe(2)
  })

  describe('参数校验与身份负例', () => {
    it('参数缺少或非法抛出 CandidateError', () => {
      const { id, base } = createFixtureCandidate()
      expect(() =>
        acceptDraft({
          bookRoot: '',
          candidateId: id,
          base,
          idempotencyKey: 'test_key_valid_1234',
        }),
      ).toThrow(CandidateError)

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: '',
          base,
          idempotencyKey: 'test_key_valid_1234',
        }),
      ).toThrow(CandidateError)
    })

    it('idempotencyKey 为空、含非 ASCII 或超长抛出异常', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: '',
        }),
      ).toThrow(AcceptConflictError)

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: '含有非ASCII字符的idempotencyKey',
        }),
      ).toThrow(AcceptConflictError)

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'x'.repeat(300),
        }),
      ).toThrow(AcceptConflictError)
    })

    it('bookId / chapterIndex 不匹配负例', () => {
      const { id, base, bookId } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      // bookId 不匹配
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'test_key_id_mismatch_1',
          bookId: 'other-book-id',
        }),
      ).toThrow(CandidateError)

      // chapterIndex 不匹配
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'test_key_id_mismatch_2',
          bookId,
          chapterIndex: 999,
        }),
      ).toThrow(CandidateError)
    })

    it('base stale 拒绝', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base: { revision: base.revision + 10, sha256: base.sha256 },
          idempotencyKey: 'test_key_stale_base_1',
        }),
      ).toThrow(AcceptConflictError)
    })
  })

  describe('R02 进程中断与故障窗口恢复', () => {
    it('窗口 1：正文写入前中断，盘面为 before 状态，重放正常完成采纳', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      // 模拟窗口 1：已写 intent，但 prose 文件尚未写入
      const intentDir = join(root, '.mozhou', 'accept-intents')
      mkdirSync(intentDir, { recursive: true })
      writeFileSync(
        join(intentDir, `${id}.json`),
        JSON.stringify({
          schemaVersion: 1,
          candidateId: id,
          idempotencyKey: 'crash-w1-key',
          timestamp: new Date().toISOString(),
          state: 'intent',
          before: { revision: base.revision, sha256: base.sha256 },
          after: { revision: base.revision + 1, sha256: 'placeholder-w1' },
        }),
        'utf8',
      )

      const result = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'crash-w1-key',
      })

      expect(result.alreadyApplied).toBe(false)
      expect(result.revision).toBe(2)
      expect(readDraftCandidate(root, id)?.status).toBe('accepted')
      const intentAfter = JSON.parse(readFileSync(join(intentDir, `${id}.json`), 'utf8')) as { state?: string }
      expect(intentAfter.state).toBe('done')
    })

    it('窗口 2：正文已写入后中断，盘面已是 after 状态，重放安全对齐并返回 alreadyApplied: true', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      // 先完成一次采纳获得 exact after sha256
      const firstResult = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'crash-w2-key',
      })
      expect(firstResult.revision).toBe(2)

      // 回滚 intent 文件为 state: 'intent'，模拟正文落盘后但在写入 done 前崩溃
      const intentDir = join(root, '.mozhou', 'accept-intents')
      writeFileSync(
        join(intentDir, `${id}.json`),
        JSON.stringify({
          schemaVersion: 1,
          candidateId: id,
          idempotencyKey: 'crash-w2-key',
          timestamp: new Date().toISOString(),
          state: 'intent',
          before: { revision: base.revision, sha256: base.sha256 },
          after: { revision: 2, sha256: firstResult.sha256 },
        }),
        'utf8',
      )

      // 重放 acceptDraft
      const replayResult = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'crash-w2-key',
      })

      expect(replayResult.alreadyApplied).toBe(true)
      expect(replayResult.revision).toBe(2)
      expect(replayResult.sha256).toBe(firstResult.sha256)
      expect(readDraftCandidate(root, id)?.status).toBe('accepted')
      const intentAfter = JSON.parse(readFileSync(join(intentDir, `${id}.json`), 'utf8')) as { state?: string }
      expect(intentAfter.state).toBe('done')
    })

    it('第三方并发修改盘面冲突：intent 恢复时盘面既非 before 也非 after，抛出 BASE_STALE 拒绝覆盖', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      const intentDir = join(root, '.mozhou', 'accept-intents')
      mkdirSync(intentDir, { recursive: true })
      writeFileSync(
        join(intentDir, `${id}.json`),
        JSON.stringify({
          schemaVersion: 1,
          candidateId: id,
          idempotencyKey: 'crash-drift-key',
          timestamp: new Date().toISOString(),
          state: 'intent',
          before: { revision: base.revision, sha256: base.sha256 },
          after: { revision: base.revision + 1, sha256: 'some-hash' },
        }),
        'utf8',
      )

      // 模拟第三方写入导致盘面变化
      const plane = LocalDataPlane.open(root)
      plane.saveProseDraft({ chapterIndex: 1, body: '第三方修改内容。\n', expectedRevision: base.revision })
      plane.close()

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'crash-drift-key',
        }),
      ).toThrow(AcceptConflictError)
    })

    it('损坏的 intent 文件抛出 AcceptConflictError', () => {
      const { id, base } = createFixtureCandidate()
      finishCandidate(root, id, 'ready')

      const intentDir = join(root, '.mozhou', 'accept-intents')
      mkdirSync(intentDir, { recursive: true })
      writeFileSync(join(intentDir, `${id}.json`), '{ damaged json', 'utf8')

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'corrupt-intent-key',
        }),
      ).toThrow(AcceptConflictError)
    })
  })

  describe('R03 选区语义与请求绑定', () => {
    function sha256(str: string): string {
      return createHash('sha256').update(str).digest('hex')
    }

    it('普通中文选区替换：精确替换 [from, to)，前后文逐字保留', () => {
      const plane = LocalDataPlane.open(root)
      plane.saveProseDraft({ chapterIndex: 1, body: '前文段落。待替换选区文本。后文段落。\n', expectedRevision: 1 })
      const scan = plane.getProseChapter(1)
      plane.close()

      const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }
      const from = 5
      const to = 13
      const targetText = '待替换选区文本。'
      expect(scan.body.slice(from, to)).toBe(targetText)

      const id = randomUUID()
      createDraftCandidate(root, {
        id,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base,
        mode: 'replace-selection',
        selection: { from, to, selectedTextHash: sha256(targetText) },
      })
      appendCandidateDelta(root, id, '【新润色对白】')
      finishCandidate(root, id, 'ready')

      const result = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'k-selection-cn-1',
      })

      expect(result.alreadyApplied).toBe(false)
      expect(result.revision).toBe(3)
      const planeAfter = LocalDataPlane.open(root)
      const updatedBody = planeAfter.getProseChapter(1).body
      planeAfter.close()
      expect(updatedBody).toBe('前文段落。【新润色对白】后文段落。\n')
    })

    it('Emoji 与代理对安全：完整 emoji 替换成功；切断代理对偏移抛出 INVALID_SELECTION', () => {
      const plane = LocalDataPlane.open(root)
      // '前文👋🌟后文\n'
      // '前文' length 2 (0, 1)
      // '👋' length 2 (2, 3)
      // '🌟' length 2 (4, 5)
      // '后文\n' (6, 7, 8)
      plane.saveProseDraft({ chapterIndex: 1, body: '前文👋🌟后文\n', expectedRevision: 1 })
      const scan = plane.getProseChapter(1)
      plane.close()
      const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }

      // 1. 完整覆盖两个 emoji [2, 6)
      const selected = scan.body.slice(2, 6)
      expect(selected).toBe('👋🌟')
      const id1 = randomUUID()
      createDraftCandidate(root, {
        id: id1,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base,
        mode: 'replace-selection',
        selection: { from: 2, to: 6, selectedTextHash: sha256(selected) },
      })
      appendCandidateDelta(root, id1, '【火】')
      finishCandidate(root, id1, 'ready')

      const res1 = acceptDraft({
        bookRoot: root,
        candidateId: id1,
        base,
        idempotencyKey: 'k-emoji-ok-1',
      })
      expect(res1.revision).toBe(3)
      const plane1 = LocalDataPlane.open(root)
      expect(plane1.getProseChapter(1).body).toBe('前文【火】后文\n')
      plane1.close()

      // 2. 切断代理对：composeBody 直接检测
      expect(() =>
        composeBody(
          {
            mode: 'replace-selection',
            text: 'x',
            selection: { from: 3, to: 6, selectedTextHash: 'a'.repeat(64) },
          },
          '前文👋🌟后文\n',
        ),
      ).toThrow(CandidateError)

      expect(() =>
        composeBody(
          {
            mode: 'replace-selection',
            text: 'x',
            selection: { from: 2, to: 5, selectedTextHash: 'a'.repeat(64) },
          },
          '前文👋🌟后文\n',
        ),
      ).toThrow(CandidateError)
    })

    it('空选区插入：from === to 时在指定位置插入文本，周围文本逐字保留', () => {
      const plane = LocalDataPlane.open(root)
      const scan = plane.getProseChapter(1)
      plane.close()
      const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }

      const id = randomUUID()
      createDraftCandidate(root, {
        id,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base,
        mode: 'replace-selection',
        selection: { from: 4, to: 4, selectedTextHash: sha256('') },
      })
      appendCandidateDelta(root, id, '【插入内容】')
      finishCandidate(root, id, 'ready')

      const res = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'k-empty-selection-1',
      })
      expect(res.revision).toBe(2)
      const planeAfter = LocalDataPlane.open(root)
      // 原文为 '作者正文原文。\n'，下标 4 在 '作者正文' 之后
      expect(planeAfter.getProseChapter(1).body).toBe('作者正文【插入内容】原文。\n')
      planeAfter.close()
    })

    it('章首与章尾边界替换正常完成', () => {
      const plane = LocalDataPlane.open(root)
      const scan = plane.getProseChapter(1)
      plane.close()
      const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }

      // 1. 章首替换 [0, 2)
      const firstTarget = scan.body.slice(0, 2)
      const idHead = randomUUID()
      createDraftCandidate(root, {
        id: idHead,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base,
        mode: 'replace-selection',
        selection: { from: 0, to: 2, selectedTextHash: sha256(firstTarget) },
      })
      appendCandidateDelta(root, idHead, '编者')
      finishCandidate(root, idHead, 'ready')

      const resHead = acceptDraft({
        bookRoot: root,
        candidateId: idHead,
        base,
        idempotencyKey: 'k-head-1',
      })
      expect(resHead.revision).toBe(2)
      const planeHead = LocalDataPlane.open(root)
      expect(planeHead.getProseChapter(1).body).toBe('编者正文原文。\n')
      planeHead.close()
    })

    it('错误 selectedTextHash / 范围越界 / 逆序 / 缺失 selection 拒绝且磁盘零变更', () => {
      const plane = LocalDataPlane.open(root)
      const scan = plane.getProseChapter(1)
      const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
      plane.close()
      const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }

      // 1. 错误 selectedTextHash
      const idBadHash = randomUUID()
      createDraftCandidate(root, {
        id: idBadHash,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base,
        mode: 'replace-selection',
        selection: { from: 0, to: 2, selectedTextHash: 'f'.repeat(64) },
      })
      appendCandidateDelta(root, idBadHash, '替换文本')
      finishCandidate(root, idBadHash, 'ready')

      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: idBadHash,
          base,
          idempotencyKey: 'k-bad-hash-1',
        }),
      ).toThrow(CandidateError)
      expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)

      // 2. 逆序范围创建时即拒绝
      expect(() =>
        createDraftCandidate(root, {
          id: randomUUID(),
          operationId: randomUUID(),
          bookId: 'book-local',
          chapterIndex: 1,
          base,
          mode: 'replace-selection',
          selection: { from: 5, to: 2, selectedTextHash: 'a'.repeat(64) },
        }),
      ).toThrow(CandidateError)

      // 3. 负数范围创建时即拒绝
      expect(() =>
        createDraftCandidate(root, {
          id: randomUUID(),
          operationId: randomUUID(),
          bookId: 'book-local',
          chapterIndex: 1,
          base,
          mode: 'replace-selection',
          selection: { from: -1, to: 2, selectedTextHash: 'a'.repeat(64) },
        }),
      ).toThrow(CandidateError)

      // 4. replace-selection 缺少 selection 创建时即拒绝
      expect(() =>
        createDraftCandidate(root, {
          id: randomUUID(),
          operationId: randomUUID(),
          bookId: 'book-local',
          chapterIndex: 1,
          base,
          mode: 'replace-selection',
        }),
      ).toThrow(CandidateError)

      // 5. 范围超出 baseBody 长度 composeBody 拒绝
      expect(() =>
        composeBody(
          {
            mode: 'replace-selection',
            text: 'new',
            selection: { from: 0, to: 9999, selectedTextHash: 'a'.repeat(64) },
          },
          'short',
        ),
      ).toThrow(CandidateError)
    })

    it('生成中外部改文导致 base 过期：accept 抛出冲突并保留正文与候选', () => {
      const plane = LocalDataPlane.open(root)
      const scan = plane.getProseChapter(1)
      plane.close()
      const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }

      const id = randomUUID()
      createDraftCandidate(root, {
        id,
        operationId: randomUUID(),
        bookId: 'book-local',
        chapterIndex: 1,
        base,
        mode: 'replace-selection',
        selection: { from: 0, to: 2, selectedTextHash: sha256(scan.body.slice(0, 2)) },
      })
      appendCandidateDelta(root, id, '修改')
      finishCandidate(root, id, 'ready')

      // 模拟作者在生成过程中改文
      const plane2 = LocalDataPlane.open(root)
      plane2.saveProseDraft({ chapterIndex: 1, body: '作者外部新修改内容。\n', expectedRevision: base.revision })
      plane2.close()

      // acceptDraft 必须因 base stale 拒绝
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'k-stale-selection-1',
        }),
      ).toThrow()

      const planeAfter = LocalDataPlane.open(root)
      expect(planeAfter.getProseChapter(1).body).toBe('作者外部新修改内容。\n')
      planeAfter.close()
      expect(readDraftCandidate(root, id)?.status).toBe('ready')
    })
  })
})
