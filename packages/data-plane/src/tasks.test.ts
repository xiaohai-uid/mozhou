/**
 * W4-2a 任务身份：taskId / attemptId / generationEpoch / sequence 的落地与**单向引用**。
 * 隔离夹具（tmpdir），不读写真实书稿。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { RUNTIME_TASKS_DIR } from './layout.js'
import { operationRecordPath, writeOperationRecordIfAbsent } from './operations.js'
import {
  TaskRecordError,
  beginTaskAttempt,
  bumpGenerationEpoch,
  countTaskRecords,
  createTaskRecord,
  finishTaskAttempt,
  linkTaskOperation,
  nextTaskSequence,
  readTaskRecord,
  taskRecordPath,
} from './tasks.js'

const roots: string[] = []
let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mozhou-tasks-'))
  roots.push(root)
})

afterAll(() => {
  for (const r of roots.splice(0)) {
    rmSync(r, { recursive: true, force: true })
  }
})

describe('W4-2a 任务记录', () => {
  it('创建：目录懒创建、字段齐备；同 taskId 重复创建拒绝', () => {
    expect(existsSync(join(root, RUNTIME_TASKS_DIR))).toBe(false)
    const record = createTaskRecord(root, { taskId: 'task_1', bookId: 'book-1', taskKind: 'draft.generate' })
    expect(existsSync(join(root, RUNTIME_TASKS_DIR))).toBe(true)
    expect(record).toMatchObject({
      recordVersion: 1,
      taskId: 'task_1',
      bookId: 'book-1',
      taskKind: 'draft.generate',
      generationEpoch: 0,
      lastSequence: 0,
      attempts: [],
      operationIds: [],
    })
    expect(countTaskRecords(root)).toBe(1)
    expect(() => createTaskRecord(root, { taskId: 'task_1', bookId: 'book-1', taskKind: 'draft.generate' })).toThrow(
      TaskRecordError,
    )
  })

  it('attemptId 单次唯一：重复登记拒绝；未登记即结束拒绝（计费归因不被静默合并）', () => {
    createTaskRecord(root, { taskId: 'task_a', bookId: 'b', taskKind: 'draft.generate' })
    beginTaskAttempt(root, 'task_a', { attemptId: 'attempt_1', provider: 'deepseek', model: 'v3' })
    expect(() => beginTaskAttempt(root, 'task_a', { attemptId: 'attempt_1' })).toThrow(/ATTEMPT_EXISTS/)
    expect(() => finishTaskAttempt(root, 'task_a', { attemptId: 'attempt_nope', state: 'succeeded' })).toThrow(
      /ATTEMPT_NOT_FOUND/,
    )
    const after = finishTaskAttempt(root, 'task_a', { attemptId: 'attempt_1', state: 'outcome_unknown' })
    expect(after.attempts).toHaveLength(1)
    expect(after.attempts[0]).toMatchObject({ attemptId: 'attempt_1', state: 'outcome_unknown', provider: 'deepseek' })
    expect(after.attempts[0]?.endedAt).toBeDefined()
  })

  it('generationEpoch 与 sequence 单调递增；两者是不同维度的计数', () => {
    createTaskRecord(root, { taskId: 'task_m', bookId: 'b', taskKind: 'draft.generate' })
    expect(bumpGenerationEpoch(root, 'task_m')).toBe(1)
    expect(bumpGenerationEpoch(root, 'task_m')).toBe(2)
    // 同一代次内可以有多条 sequence（代次是视图切换，序号是任务内序号）
    expect(nextTaskSequence(root, 'task_m')).toBe(1)
    expect(nextTaskSequence(root, 'task_m')).toBe(2)
    expect(nextTaskSequence(root, 'task_m')).toBe(3)
    expect(bumpGenerationEpoch(root, 'task_m')).toBe(3)
    const record = readTaskRecord(root, 'task_m')
    expect(record).toMatchObject({ generationEpoch: 3, lastSequence: 3 })
  })

  it('与 W3 操作记录是单向引用：挂接不触碰操作记录，且同 operationId 去重', () => {
    createTaskRecord(root, { taskId: 'task_link', bookId: 'b', taskKind: 'draft.continue' })
    // 先落一条 W3 操作记录
    writeOperationRecordIfAbsent(root, {
      recordVersion: 1,
      operationId: 'op_x',
      operationType: 'prose.save',
      principalId: 'user_A',
      bookId: 'b',
      requestDigest: 'sha256:d',
      chapterIndex: 1,
      state: 'succeeded',
      result: { appliedRevision: 1, appliedBodyHash: 'sha256:h' },
      recordedAt: new Date().toISOString(),
    })
    const opPath = operationRecordPath(root, 'op_x')
    const opBytesBefore = readFileSync(opPath, 'utf8')

    linkTaskOperation(root, 'task_link', 'op_x')
    linkTaskOperation(root, 'task_link', 'op_x') // 去重
    linkTaskOperation(root, 'task_link', 'op_y')
    const record = readTaskRecord(root, 'task_link')
    expect(record?.operationIds).toEqual(['op_x', 'op_y'])
    // 单向：操作记录字节级未变（任务 → 操作，反向不成立）
    expect(readFileSync(opPath, 'utf8')).toBe(opBytesBefore)
  })

  it('两个命名空间互不重叠：同一字符串的 taskId 与 operationId 落在不同文件', () => {
    createTaskRecord(root, { taskId: 'same-string', bookId: 'b', taskKind: 'draft.generate' })
    expect(taskRecordPath(root, 'same-string')).not.toBe(operationRecordPath(root, 'same-string'))
    expect(taskRecordPath(root, 'same-string').startsWith(join(root, RUNTIME_TASKS_DIR))).toBe(true)
  })

  it('未知 recordVersion：拒写而非猜测（与 W3 journal 同纪律）', () => {
    mkdirSync(join(root, RUNTIME_TASKS_DIR), { recursive: true })
    const path = taskRecordPath(root, 'task_future')
    writeFileSync(path, JSON.stringify({ recordVersion: 99, taskId: 'task_future' }))
    expect(() => readTaskRecord(root, 'task_future')).toThrow(/TASK_RECORD_UNSUPPORTED/)
    expect(() => beginTaskAttempt(root, 'task_future', { attemptId: 'a' })).toThrow(/TASK_RECORD_UNSUPPORTED/)
    // 文件原样保留（不降级覆盖）
    expect(JSON.parse(readFileSync(path, 'utf8')).recordVersion).toBe(99)
  })
})
