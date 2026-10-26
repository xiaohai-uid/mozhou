import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import {
  LocalDataPlane,
  createBook,
  proseChapterPath,
  OperationIdReusedError,
  operationRecordPath,
  readOperationRecord,
  createTaskRecord,
  readTaskRecord,
} from '@mozhou/data-plane'
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

  describe('F-01 操作幂等前置（审查回归锁）', () => {
    it('同 operationId 同候选重试 → 回放原结果；换候选 → 冲突在任何盘面副作用之前抛出', () => {
      const a = createFixtureCandidate('replace')
      finishCandidate(root, a.id, 'ready')
      const first = acceptDraft({
        bookRoot: root,
        candidateId: a.id,
        base: a.base,
        idempotencyKey: 'f01-key',
        operationId: 'f01-operation',
        bookId: a.bookId,
      })
      expect(first.alreadyApplied).toBe(false)

      const planeAfterA = LocalDataPlane.open(root)
      const afterA = planeAfterA.getProseChapter(1)
      planeAfterA.close()

      // 同 operationId 同候选重试 → 回放（零新写入）
      const replay = acceptDraft({
        bookRoot: root,
        candidateId: a.id,
        base: a.base,
        idempotencyKey: 'f01-key',
        operationId: 'f01-operation',
        bookId: a.bookId,
      })
      expect(replay.alreadyApplied).toBe(true)
      expect(replay.revision).toBe(first.revision)
      expect(replay.sha256).toBe(first.sha256)

      // 候选 B（现场 base）复用同 operationId → 冲突必须先于正文写入/accepted 标记
      const b = createFixtureCandidate('replace')
      finishCandidate(root, b.id, 'ready')
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: b.id,
          base: b.base,
          idempotencyKey: 'f01-key-b',
          operationId: 'f01-operation',
          bookId: b.bookId,
        }),
      ).toThrow(OperationIdReusedError)

      const planeAfterConflict = LocalDataPlane.open(root)
      const afterConflict = planeAfterConflict.getProseChapter(1)
      planeAfterConflict.close()
      expect(afterConflict.revision).toBe(afterA.revision)
      expect(afterConflict.body).toBe(afterA.body)
      expect(readDraftCandidate(root, b.id)?.canonState).toBe('unaccepted')
      expect(existsSync(join(root, '.mozhou', 'accept-intents', b.id + '.json'))).toBe(false)
    })
  })

  describe('F-01 加固：恢复分支身份前置与操作结果补全', () => {
    function diskRevision(): number {
      const plane = LocalDataPlane.open(root)
      const revision = plane.getProseChapter(1).revision
      plane.close()
      return revision
    }

    it('done 回放不得绕过身份检查：同 key 换 operationId 在副作用前拒绝', () => {
      const { id, base, bookId } = createFixtureCandidate('replace')
      finishCandidate(root, id, 'ready')

      const first = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'f01b-key',
        operationId: 'f01b-op-A',
        bookId,
      })
      expect(first.alreadyApplied).toBe(false)

      const beforeRaw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
      const beforeRevision = diskRevision()

      // 同候选同 key，但换成另一个 operationId：intent 里存的是 op-A，请求是 op-B。
      // 修复前 done 分支先于身份检查返回，这里会拿到 alreadyApplied —— 恢复分支的旁路。
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 'f01b-key',
          operationId: 'f01b-op-B',
          bookId,
        }),
      ).toThrow(AcceptConflictError)

      expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(beforeRaw)
      expect(diskRevision()).toBe(beforeRevision)
      expect(readDraftCandidate(root, id)?.status).toBe('accepted')
    })

    it('无原始身份的 intent（旧记录/未带 operationId 的请求所写）拒绝绑定新操作', () => {
      const { id, base } = createFixtureCandidate('replace')
      finishCandidate(root, id, 'ready')

      // 不带 operationId 的采纳 ⇒ intent 是 v2 但无 operation 块
      const first = acceptDraft({ bookRoot: root, candidateId: id, base, idempotencyKey: 'f01c-key' })
      expect(first.alreadyApplied).toBe(false)

      const intentPath = join(root, '.mozhou', 'accept-intents', `${id}.json`)
      const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as { schemaVersion: number; operation?: unknown }
      expect(intent.schemaVersion).toBe(2)
      expect(intent.operation).toBeUndefined()

      // 带 operationId 的重试无法证明同源 ⇒ 拒绝，绝不把新操作绑到旧记录上
      expect(() =>
        acceptDraft({ bookRoot: root, candidateId: id, base, idempotencyKey: 'f01c-key', operationId: 'f01c-op' }),
      ).toThrow(AcceptConflictError)
    })

    it('done 已写、操作结果未写时重试：补齐操作记录且正文版本不再增长', () => {
      const { id, base, bookId } = createFixtureCandidate('replace')
      finishCandidate(root, id, 'ready')

      const first = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'f01d-key',
        operationId: 'f01d-op',
        bookId,
      })
      expect(first.alreadyApplied).toBe(false)
      expect(readOperationRecord(root, 'f01d-op')?.result.appliedRevision).toBe(first.revision)

      // 模拟「done 已写、操作结果未写」窗口：删掉结果文件，intent 保持 done
      rmSync(operationRecordPath(root, 'f01d-op'))

      const retry = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'f01d-key',
        operationId: 'f01d-op',
        bookId,
      })
      expect(retry.alreadyApplied).toBe(true)
      expect(retry.revision).toBe(first.revision)
      expect(diskRevision()).toBe(first.revision) // 正文版本只增加一次

      // 操作结果必须可查（身份取自 intent 快照，不依赖本次请求）
      const record = readOperationRecord(root, 'f01d-op')
      expect(record).not.toBeNull()
      expect(record?.result.appliedRevision).toBe(first.revision)
      expect(record?.result.appliedBodyHash).toBe(first.sha256)
    })

    it('记录已写、原任务关联未写：重试不带 taskId 仍恢复原关联（S3）', () => {
      const { id, base, bookId } = createFixtureCandidate('replace')
      finishCandidate(root, id, 'ready')

      // 原任务尚不存在 ⇒ 首次采纳在「结果记录已写、关联失败」处抛错（TASK_NOT_FOUND）
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 's3-key',
          operationId: 's3-op',
          taskId: 's3-task',
          bookId,
        }),
      ).toThrow()
      expect(readOperationRecord(root, 's3-op')).not.toBeNull() // 结果记录已写
      const firstRevision = diskRevision()

      // 补上原任务记录后重试（**不带 taskId**）⇒ 必须按 intent 中保存的原任务补关联
      createTaskRecord(root, { taskId: 's3-task', bookId, taskKind: 'draft.generate' })
      const retry = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 's3-key',
        operationId: 's3-op',
        bookId,
      })
      expect(retry.alreadyApplied).toBe(true)
      expect(retry.revision).toBe(firstRevision)
      expect(diskRevision()).toBe(firstRevision) // 正文不再增长
      expect(readTaskRecord(root, 's3-task')?.operationIds).toContain('s3-op')
    })

    it('intent 已有原身份时，省略 operationId 不得免除校验（S4）', () => {
      const { id, base, bookId } = createFixtureCandidate('replace')
      finishCandidate(root, id, 'ready')

      const first = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 's4-key',
        operationId: 's4-op',
        principalId: 'principal-A',
        bookId,
      })
      expect(first.alreadyApplied).toBe(false)

      // 另一主体省略 operationId 重试 ⇒ 拒绝（修复前返回 alreadyApplied，等于跨主体回放）
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 's4-key',
          principalId: 'principal-B',
          bookId,
        }),
      ).toThrow(AcceptConflictError)

      // 同主体省略 operationId 同样拒绝：有原身份就必须出示（契约显式，不留静默旁路）
      expect(() =>
        acceptDraft({
          bookRoot: root,
          candidateId: id,
          base,
          idempotencyKey: 's4-key',
          principalId: 'principal-A',
          bookId,
        }),
      ).toThrow(AcceptConflictError)

      // 出示同一身份仍可正常回放
      const replay = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 's4-key',
        operationId: 's4-op',
        principalId: 'principal-A',
        bookId,
      })
      expect(replay.alreadyApplied).toBe(true)
      expect(replay.revision).toBe(first.revision)
    })

    it('窗口 2 恢复（intent=intent、盘面=after）同样补齐操作结果', () => {
      const { id, base, bookId } = createFixtureCandidate('replace')
      finishCandidate(root, id, 'ready')

      const first = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'f01e-key',
        operationId: 'f01e-op',
        bookId,
      })
      expect(first.alreadyApplied).toBe(false)

      const intentPath = join(root, '.mozhou', 'accept-intents', `${id}.json`)
      const doneIntent = JSON.parse(readFileSync(intentPath, 'utf8')) as Record<string, unknown>
      // 回退 intent 为 intent 态（模拟正文已落盘但 done 未写），并删掉操作结果
      writeFileSync(intentPath, JSON.stringify({ ...doneIntent, state: 'intent' }), 'utf8')
      rmSync(operationRecordPath(root, 'f01e-op'))

      const retry = acceptDraft({
        bookRoot: root,
        candidateId: id,
        base,
        idempotencyKey: 'f01e-key',
        operationId: 'f01e-op',
        bookId,
      })
      expect(retry.alreadyApplied).toBe(true)
      expect(retry.revision).toBe(first.revision)
      expect(readOperationRecord(root, 'f01e-op')?.result.appliedRevision).toBe(first.revision)
      expect((JSON.parse(readFileSync(intentPath, 'utf8')) as { state?: string }).state).toBe('done')
    })
  })
})
