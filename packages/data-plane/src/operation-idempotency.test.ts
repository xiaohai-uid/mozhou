/**
 * W3 操作幂等（t32 冻结契约）：同 ID 同摘要回放、同 ID 不同摘要拒绝、
 * 结果与正文同一恢复单元、历史 appliedRevision 与当前 currentRevision 分离。
 *
 * 隔离夹具（tmpdir 建书），不读写真实书稿。摘要由服务端计算，故本层直接注入 digest。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { normalizeProseBody, readProseChapter, recoverPendingCommit } from './chapter.js'
import { createBook } from './create-book.js'
import { RUNTIME_EVENTS_PATH, proseChapterPath } from './layout.js'
import { LocalDataPlane } from './local-data-plane.js'
import { OperationIdReusedError, OperationScopeMismatchError, operationRecordPath, readOperationRecord } from './operations.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-ops-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function newBook(): LocalDataPlane {
  createBook({ dir: bookRoot, title: 'W3 幂等测试书' })
  return LocalDataPlane.open(bookRoot)
}

function intent(operationId: string, requestDigest: string, operationType: 'prose.save' | 'chapter.commit', bookId: string) {
  return { operationType, operationId, principalId: 'user_local', bookId, requestDigest }
}

describe('W3 操作幂等 · 草稿保存', () => {
  it('同 ID 同摘要重试 → 回放原结果，正文/版本零重复变更', () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const op = intent('op_save_1', 'sha256:aaa', 'prose.save', bookId)

      const first = plane.saveProseDraft({ chapterIndex: 1, body: '第一版', expectedRevision: 0, operation: op })
      expect(first.replayed).toBe(false)
      expect(first.appliedRevision).toBe(1)
      const bodyAfterFirst = readProseChapter(bookRoot, proseChapterPath(1)).body
      const eventsAfterFirst = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')

      const replay = plane.saveProseDraft({ chapterIndex: 1, body: '第一版', expectedRevision: 0, operation: op })
      expect(replay.replayed).toBe(true)
      expect(replay.appliedRevision).toBe(1)
      // 正文与版本零重复变更
      expect(readProseChapter(bookRoot, proseChapterPath(1)).body).toBe(bodyAfterFirst)
      expect(readProseChapter(bookRoot, proseChapterPath(1)).revision).toBe(1)
      expect(readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')).toBe(eventsAfterFirst)
    } finally {
      plane.close()
    }
  })

  it('末尾换行差异的重试仍回放（写入器与摘要共用 normalizeProseBody）', () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      // 服务端对**规范化后**的正文算摘要：'第二版' 与 '第二版\n' 规范化后同值
      const digest = 'sha256:normalized'
      const first = plane.saveProseDraft({
        chapterIndex: 1,
        body: normalizeProseBody('第二版'),
        expectedRevision: 0,
        operation: intent('op_nl', digest, 'prose.save', bookId),
      })
      expect(first.replayed).toBe(false)
      // 客户端重试时少了一个末尾换行：规范化后摘要相同 → 必须回放而不是 409
      const retry = plane.saveProseDraft({
        chapterIndex: 1,
        body: '第二版',
        expectedRevision: 0,
        operation: intent('op_nl', digest, 'prose.save', bookId),
      })
      expect(retry.replayed).toBe(true)
      expect(retry.appliedRevision).toBe(first.appliedRevision)
    } finally {
      plane.close()
    }
  })

  it('同 ID 不同摘要（正文/标题/预期版本任一不同）→ OperationIdReusedError，零盘上变更', () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      plane.saveProseDraft({
        chapterIndex: 1,
        body: '原始',
        expectedRevision: 0,
        operation: intent('op_reuse', 'sha256:digest-a', 'prose.save', bookId),
      })
      const before = readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')
      const revisionBefore = readProseChapter(bookRoot, proseChapterPath(1)).revision

      for (const digest of ['sha256:digest-b', 'sha256:digest-c', 'sha256:digest-d']) {
        expect(() =>
          plane.saveProseDraft({
            chapterIndex: 1,
            body: '换了正文',
            expectedRevision: 1,
            operation: intent('op_reuse', digest, 'prose.save', bookId),
          }),
        ).toThrow(OperationIdReusedError)
      }
      expect(readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')).toBe(before)
      expect(readProseChapter(bookRoot, proseChapterPath(1)).revision).toBe(revisionBefore)
    } finally {
      plane.close()
    }
  })

  it('他人保存了相同正文时，不得把别人的成功当作本操作已执行（独立目标态 ≠ 已执行证明）', () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      // 操作 A：另一个 operationId 先写入同样的正文
      plane.saveProseDraft({
        chapterIndex: 1,
        body: '相同正文',
        expectedRevision: 0,
        operation: intent('op_other', 'sha256:other', 'prose.save', bookId),
      })
      expect(readProseChapter(bookRoot, proseChapterPath(1)).body).toContain('相同正文')

      // 操作 B（本操作）从未执行过：不得因盘上正文相同就回放/声称已执行
      expect(readOperationRecord(bookRoot, 'op_mine')).toBeNull()
      const mine = plane.saveProseDraft({
        chapterIndex: 1,
        body: '相同正文',
        expectedRevision: 1,
        operation: intent('op_mine', 'sha256:mine', 'prose.save', bookId),
      })
      expect(mine.replayed).toBe(false)
      expect(mine.appliedRevision).toBe(2)
      expect(readOperationRecord(bookRoot, 'op_mine')?.result.appliedRevision).toBe(2)
    } finally {
      plane.close()
    }
  })

  it('并发同 ID：两次并发只落一次变更（另一次回放或身份冲突），revision 只 +1', async () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const op = intent('op_race', 'sha256:race', 'prose.save', bookId)
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => plane.saveProseDraft({ chapterIndex: 1, body: '并发', expectedRevision: 0, operation: op })),
        Promise.resolve().then(() => plane.saveProseDraft({ chapterIndex: 1, body: '并发', expectedRevision: 0, operation: op })),
      ])
      const ok = outcomes.filter((o) => o.status === 'fulfilled')
      expect(ok.length).toBeGreaterThanOrEqual(1)
      expect(readProseChapter(bookRoot, proseChapterPath(1)).revision).toBe(1)
      const record = readOperationRecord(bookRoot, 'op_race')
      expect(record?.result.appliedRevision).toBe(1)
    } finally {
      plane.close()
    }
  })
})

describe('W3 操作幂等 · 作用域（t32 §C.4 四元组）', () => {
  it('他人同 ID 同摘要 → 不回放（作用域不匹配），零盘上变更且记录 principal 不变', () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const digest = 'sha256:scope'
      const intentOf = (principalId: string) => ({
        operationType: 'prose.save' as const,
        operationId: 'op_scope',
        principalId,
        bookId,
        requestDigest: digest,
      })
      plane.saveProseDraft({ chapterIndex: 1, body: '甲写的正文', expectedRevision: 0, operation: intentOf('user_A') })
      const proseBefore = readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')
      const revisionBefore = readProseChapter(bookRoot, proseChapterPath(1)).revision

      // 乙用**同一 operationId + 同一摘要**重试：不得回放，更不得拿到甲的 appliedRevision/appliedBodyHash
      let thrown: unknown
      try {
        plane.saveProseDraft({ chapterIndex: 1, body: '甲写的正文', expectedRevision: 0, operation: intentOf('user_B') })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(OperationScopeMismatchError)
      // W3 残余 R1：message 必须与**实际原因**（主体/书不匹配）一致，不得沿用基类的
      // 'different request digest' 文案；且 code/name 与 instanceof 关系不受影响。
      const scopeError = thrown as OperationScopeMismatchError
      expect(scopeError.message).toContain('different principal or book')
      expect(scopeError.message).toContain('op_scope')
      expect(scopeError.message).not.toContain('different request digest')
      expect(scopeError.code).toBe('OPERATION_SCOPE_MISMATCH')
      expect(scopeError.name).toBe('OperationScopeMismatchError')
      expect(scopeError).toBeInstanceOf(OperationIdReusedError)

      // 零盘上变更 + 记录 principal 不变
      expect(readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')).toBe(proseBefore)
      expect(readProseChapter(bookRoot, proseChapterPath(1)).revision).toBe(revisionBefore)
      expect(readOperationRecord(bookRoot, 'op_scope')?.principalId).toBe('user_A')

      // 甲自己重试仍回放（作用域判定不误伤原主体）
      const mine = plane.saveProseDraft({ chapterIndex: 1, body: '甲写的正文', expectedRevision: 0, operation: intentOf('user_A') })
      expect(mine.replayed).toBe(true)
      expect(mine.appliedRevision).toBe(revisionBefore)
    } finally {
      plane.close()
    }
  })
})

describe('W3 操作幂等 · 章节提交与恢复单元', () => {
  it('同 ID 同摘要重试：即使章节此后已重开并再编辑，也回放先前结果（不否认已成功）', () => {
    const plane = newBook()
    try {
      const bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const op = intent('op_commit_1', 'sha256:c1', 'chapter.commit', bookId)
      const first = plane.commitChapter({ chapterIndex: 1, summary: '一提', expectedRevision: 0, operation: op })
      expect(first.replayed).toBe(false)
      const firstCommitId = first.commitId

      // 章节此后被重开并再编辑（revision 前进）
      plane.reopenChapter(1)
      plane.saveProseDraft({ chapterIndex: 1, body: '重开后的新正文', expectedRevision: 2 })

      const replay = plane.commitChapter({ chapterIndex: 1, summary: '一提', expectedRevision: 0, operation: op })
      expect(replay.replayed).toBe(true)
      expect(replay.commitId).toBe(firstCommitId)
      expect(replay.appliedRevision).toBe(1)
      expect(replay.currentRevision).toBe(3)
      expect(replay.appliedRevision).not.toBe(replay.currentRevision)
    } finally {
      plane.close()
    }
  })

  it('崩溃前滚恢复补写操作结果记录（结果与正文同一恢复单元）', () => {
    const plane = newBook()
    let bookId = ''
    try {
      bookId = plane.book.id
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 1,
          summary: '崩在 manifest',
          expectedRevision: 0,
          operation: intent('op_recover', 'sha256:rec', 'chapter.commit', bookId),
          onStage: (stage) => {
            if (stage === 'manifest') throw new Error('simulated crash at manifest')
          },
        }),
      ).toThrow(/simulated crash at manifest/)
    } finally {
      plane.close()
    }

    // 结果文件此刻**不存在**（写在第 7 步，尚未到达）
    expect(readOperationRecord(bookRoot, 'op_recover')).toBeNull()
    expect(existsSync(operationRecordPath(bookRoot, 'op_recover'))).toBe(false)

    recoverPendingCommit(bookRoot)

    // 前滚恢复补齐：记录与正文同源，journal 移除
    const record = readOperationRecord(bookRoot, 'op_recover')
    expect(record).not.toBeNull()
    expect(record?.operationId).toBe('op_recover')
    expect(record?.requestDigest).toBe('sha256:rec')
    expect(record?.result.appliedRevision).toBe(1)
    expect(record?.result.commitId).toMatch(/^cmit_/)
    expect(readProseChapter(bookRoot, proseChapterPath(1)).phase).toBe('committed')

    // 回放：重开平面后同 ID 重试仍回放（幂等跨重启）
    const reopened = LocalDataPlane.open(bookRoot)
    try {
      const replay = reopened.commitChapter({
        chapterIndex: 1,
        summary: '崩在 manifest',
        expectedRevision: 0,
        operation: intent('op_recover', 'sha256:rec', 'chapter.commit', bookId),
      })
      expect(replay.replayed).toBe(true)
      expect(replay.appliedRevision).toBe(1)
    } finally {
      reopened.close()
    }
  })

  it('v1 旧格式 journal 仍可恢复（读端兼容），v2 缺 operation 抛可定位冲突', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      plane.commitChapter({ chapterIndex: 1, summary: 'v1 提交', expectedRevision: 0 })
    } finally {
      plane.close()
    }
    // v1 提交不带 operation → 无结果记录，但盘面已收敛
    expect(readProseChapter(bookRoot, proseChapterPath(1)).phase).toBe('committed')
    expect(existsSync(join(bookRoot, '.mozhou/pending-commit.json'))).toBe(false)
  })
})
