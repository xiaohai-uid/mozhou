/**
 * W4-2c：任务事件行 schema 扩展 + 外层 seq / 内层 sequence 的区分。
 * 全程零时钟零外部服务；账本落在 hermetic 临时目录。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PublishBus, TASK_ROW_SCHEMA_VERSION, readLedger } from './eventBus.js'

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-taskrow-'))
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  return root
}

const ev = (type: 'GenerationStarted' | 'GenerationFinished' | 'TaskStarted' | 'TaskFinished', taskRef = 't1') =>
  ({ type, taskRef }) as const

describe('W4-2c 任务事件行 schema', () => {
  it('不提供任务身份 ⇒ 行与 W4 之前**逐字节相同**（平铺领域行与旧调用方零影响）', () => {
    const root = hermeticRoot()
    new PublishBus().publish({ root }, ev('GenerationStarted'))
    const line = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8').trim()
    expect(line).toBe(JSON.stringify({ seq: 1, event: { type: 'GenerationStarted', taskRef: 't1' } }))
  })

  it('任务行携带 schemaVersion/taskId/attemptId/generationEpoch/sequence；**平铺领域行逐字节不动**', () => {
    const root = hermeticRoot()
    const path = join(root, '.mozhou', 'events.jsonl')
    // 平铺领域行（T3/T9 先于 runtime 存在的写入方格式）
    const flatLine = JSON.stringify({ type: 'ChapterCommitted', chapterIndex: 1 })
    writeFileSync(path, flatLine + '\n')
    new PublishBus().publish({ root }, ev('GenerationStarted'), {
      taskId: 'task_a',
      attemptId: 'attempt_1',
      generationEpoch: 3,
      sequence: 1,
    })
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines[0]).toBe(flatLine)
    const row = JSON.parse(lines[1] ?? '{}') as Record<string, unknown>
    expect(row['schemaVersion']).toBe(TASK_ROW_SCHEMA_VERSION)
    expect(row['taskId']).toBe('task_a')
    expect(row['attemptId']).toBe('attempt_1')
    expect(row['generationEpoch']).toBe(3)
    expect(row['sequence']).toBe(1)
    // 外层 seq 只数任务行（平铺行不占号）
    expect(row['seq']).toBe(1)
  })

  it('外层 seq（账本级，供游标补发）与内层 sequence（单任务级，供丢弃旧代次）是不同维度', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    const a = { taskId: 'task_A', generationEpoch: 1 }
    bus.publish({ root }, ev('TaskStarted', 'task_A'), { ...a, sequence: 1 })
    bus.publish({ root }, ev('GenerationStarted', 'task_A'), { ...a, sequence: 2 })
    bus.publish({ root }, ev('GenerationFinished', 'task_A'), { ...a, sequence: 3 })
    bus.publish({ root }, ev('TaskFinished', 'task_A'), { ...a, sequence: 4 })
    const b = { taskId: 'task_B', generationEpoch: 7 }
    bus.publish({ root }, ev('GenerationStarted', 'task_B'), { ...b, sequence: 1 })
    bus.publish({ root }, ev('GenerationFinished', 'task_B'), { ...b, sequence: 2 })

    const rows = readLedger({ root })
    // 外层：全账本单调递增，跨任务不重置
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6])
    // 内层：按任务各自从 1 起
    expect(rows.filter((row) => row.task?.taskId === 'task_A').map((row) => row.task?.sequence)).toEqual([1, 2, 3, 4])
    expect(rows.filter((row) => row.task?.taskId === 'task_B').map((row) => row.task?.sequence)).toEqual([1, 2])
    // 代次随任务走，不与序号混用
    expect(rows[0]?.task?.generationEpoch).toBe(1)
    expect(rows[4]?.task?.generationEpoch).toBe(7)
  })

  it('旧账本（任务行无身份块）读回不变：task 为 undefined，seq 语义不变', () => {
    const root = hermeticRoot()
    writeFileSync(
      join(root, '.mozhou', 'events.jsonl'),
      JSON.stringify({ seq: 1, event: { type: 'GenerationStarted', taskRef: 't1' } }) + '\n',
    )
    const rows = readLedger({ root })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.task).toBeUndefined()
    expect(rows[0]?.seq).toBe(1)
    expect(rows[0]?.event.type).toBe('GenerationStarted')
  })
})
