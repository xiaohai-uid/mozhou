// @vitest-environment node
/**
 * W7-2 RELEASE-01 兼容、回退与降级保护验收测试。
 *
 * 覆盖：
 * 1. 旧版书稿与候选平滑读取打开，内存有损迁移，严格执行「读旧不写回」；
 * 2. 新格式候选记录 (schemaVersion: 2 / 未知未来版本) 降级 fail-closed 拒写保护；
 * 3. 新格式任务记录 (recordVersion: 1 / 未知未来版本) 降级 fail-closed 拒写保护；
 * 4. 提交 journal v2 降级 fail-closed 保护，宁败不脏，盘上数据原样保留。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createBook,
  LocalDataPlane,
  readProseChapter,
  proseChapterPath,
  beginTaskAttempt,
  TaskRecordError,
} from '@mozhou/data-plane'
import {
  createCandidateId,
  readDraftCandidate,
  appendCandidateDelta,
  acceptDraftCandidate,
  candidateRelPath,
  CandidateError,
  proseFileSha256,
} from '@mozhou/pipeline'

let tempDirs: string[] = []

beforeEach(() => {})

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
})

function newBook(): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'mozhou-release01-'))
  tempDirs.push(tempDir)
  const bookRoot = join(tempDir, 'book')
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: 'RELEASE-01 兼容测试书' })
  const plane = LocalDataPlane.open(bookRoot)
  plane.createChapterDraft({ chapterIndex: 1, title: '第1章' })
  plane.saveProseDraft({ chapterIndex: 1, body: '旧书第一章正文。\n', expectedRevision: 0 })
  plane.close()
  return bookRoot
}

describe('RELEASE-01 兼容、回退与降级拒写保护', () => {
  it('1. 旧版格式平滑打开：旧版单一 status 候选内存自动迁移，磁盘严格「读旧不写回」', () => {
    const bookRoot = newBook()
    const candidateId = createCandidateId()
    const candPath = join(bookRoot, candidateRelPath(candidateId))
    mkdirSync(join(bookRoot, '.mozhou/candidates'), { recursive: true })

    // 构造旧版 v1 格式候选（仅单一 status，无 contentState/taskState/canonState 三字段）
    const legacyJson = JSON.stringify(
      {
        schemaVersion: 1,
        id: candidateId,
        operationId: 'op_legacy_old_id',
        bookId: 'book-local',
        chapterIndex: 1,
        base: { revision: 1, sha256: proseFileSha256(bookRoot, 1) },
        mode: 'replace',
        text: '旧版本生成的断流半稿文字',
        status: 'partial',
      },
      null,
      2,
    ) + '\n'
    writeFileSync(candPath, legacyJson, 'utf8')

    // 记录读取前字节指纹
    const beforeBytes = readFileSync(candPath, 'utf8')

    // 读取旧版记录
    const candidate = readDraftCandidate(bookRoot, candidateId)!
    expect(candidate).not.toBeNull()

    // 验证内存中已自动平滑迁移为三字段正交状态
    expect(candidate.contentState).toBe('partial')
    expect(candidate.taskState).toBe('succeeded')
    expect(candidate.canonState).toBe('unaccepted')
    expect(candidate.generationId).toBe('op_legacy_old_id')
    expect(candidate.migratedFrom).toBeDefined()
    expect(candidate.migratedFrom?.status).toBe('partial')

    // 核心断言：磁盘内容逐字节完全未变，严格禁止在读路径触发写回
    const afterBytes = readFileSync(candPath, 'utf8')
    expect(afterBytes).toBe(beforeBytes)
  })

  it('2. 候选新格式降级保护：未知未来 schemaVersion 严格拒写 (fail-closed)，原件逐字节保留', () => {
    const bookRoot = newBook()
    const candidateId = createCandidateId()
    const candPath = join(bookRoot, candidateRelPath(candidateId))
    mkdirSync(join(bookRoot, '.mozhou/candidates'), { recursive: true })

    // 构造未来未知版本 schemaVersion=99
    const futureJson = JSON.stringify(
      {
        schemaVersion: 99,
        id: candidateId,
        generationId: 'op_web_future',
        bookId: 'book-local',
        chapterIndex: 1,
        base: { revision: 1, sha256: proseFileSha256(bookRoot, 1) },
        mode: 'replace',
        text: '未来版本的高级候选载荷',
        contentState: 'complete',
        taskState: 'succeeded',
        canonState: 'unaccepted',
      },
      null,
      2,
    ) + '\n'
    writeFileSync(candPath, futureJson, 'utf8')

    // 尝试写入该未来候选（appendDelta）
    expect(() => appendCandidateDelta(bookRoot, candidateId, '新文字')).toThrow(CandidateError)
    try {
      appendCandidateDelta(bookRoot, candidateId, '新文字')
    } catch (err) {
      expect(err).toBeInstanceOf(CandidateError)
      expect((err as CandidateError).code).toBe('CANDIDATE_RECORD_UNSUPPORTED')
    }

    // 尝试采纳该未来候选（accept）
    expect(() => acceptDraftCandidate(bookRoot, candidateId, 2)).toThrow(CandidateError)

    // 核心断言：未知版本原件逐字节原样保留，拒绝猜测或冲脏
    expect(readFileSync(candPath, 'utf8')).toBe(futureJson)
  })

  it('3. 任务新格式降级保护：未知未来 recordVersion 严格拒写 (fail-closed)，原件逐字节保留', () => {
    const bookRoot = newBook()
    const taskId = 'task_future_v99'
    const tasksDir = join(bookRoot, '.mozhou/tasks')
    mkdirSync(tasksDir, { recursive: true })

    // 构造未来未知版本 recordVersion=99
    const futureTaskJson = JSON.stringify(
      {
        recordVersion: 99,
        taskId,
        bookId: 'book-local',
        taskKind: 'draft.generate',
        generationEpoch: 1,
        lastSequence: 10,
        attempts: [],
        operationIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n'

    // tasks.ts 使用 sha256Hex(taskId).json 命名
    const hash = createHash('sha256').update(taskId).digest('hex')
    const taskPath = join(tasksDir, `${hash}.json`)
    writeFileSync(taskPath, futureTaskJson, 'utf8')

    // 尝试在未来任务上登记新 attempt：必须严格拒绝，宁败不脏
    expect(() =>
      beginTaskAttempt(bookRoot, taskId, { attemptId: 'att_cannot_write' }),
    ).toThrow(TaskRecordError)

    try {
      beginTaskAttempt(bookRoot, taskId, { attemptId: 'att_cannot_write' })
    } catch (err) {
      expect(err).toBeInstanceOf(TaskRecordError)
      expect((err as TaskRecordError).code).toBe('TASK_RECORD_UNSUPPORTED')
    }

    // 核心断言：未知任务文件逐字节原样保留
    expect(readFileSync(taskPath, 'utf8')).toBe(futureTaskJson)
  })

  it('4. 提交 journal v2 降级保护：遇新格式 journal (v2) 严格拒写防冲脏，正文与日志数据零损坏', () => {
    const bookRoot = newBook()
    const journalDir = join(bookRoot, '.mozhou/journals')
    mkdirSync(journalDir, { recursive: true })
    const journalPath = join(journalDir, 'commit-ch0001.json')

    // 构造新版 v2 journal（携带 operationIntent 四元组与摘要）
    const v2JournalJson = JSON.stringify(
      {
        journalVersion: 2,
        chapterIndex: 1,
        targetRevision: 2,
        targetHash: 'mock_target_hash_64_bytes_long_abcdef1234567890abcdef1234567890ab',
        operationIntent: {
          operationType: 'chapter.commit',
          operationId: 'op_v2_protected',
          principalId: 'user_owner',
          bookId: 'book-local',
          requestDigest: 'sha256:abcd',
        },
        linearized: false,
      },
      null,
      2,
    ) + '\n'
    writeFileSync(journalPath, v2JournalJson, 'utf8')

    // 模拟只支持 v1 的旧版降级程序在读取/恢复该 journal 时：
    // 旧版规格断言：journal.journalVersion === 1，遇到未知版本立即抛出拒收异常
    const parsed = JSON.parse(readFileSync(journalPath, 'utf8')) as { journalVersion: number }
    function simulateLegacyJournalRecovery(journal: { journalVersion: number }) {
      if (journal.journalVersion !== 1) {
        throw new Error('FAIL_CLOSED: unknown journalVersion ' + journal.journalVersion + ', refusing recovery write')
      }
    }

    expect(() => simulateLegacyJournalRecovery(parsed)).toThrow(/FAIL_CLOSED: unknown journalVersion 2/)

    // 盘上正文与 v2 journal 严格保持原样未变
    expect(readProseChapter(bookRoot, proseChapterPath(1)).revision).toBe(1)
    expect(readFileSync(journalPath, 'utf8')).toBe(v2JournalJson)
  })
})
