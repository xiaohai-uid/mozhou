/**
 * W4-2c-2 客户端侧：代次判定（第二层）、代次触发点、补发/快照决策、行收窄。
 * 纯函数、零 DOM、零网络。
 */
import { describe, expect, it } from 'vitest'
import {
  TASK_ROW_SCHEMA_VERSION,
  applyTaskEvent,
  bumpGenerationEpoch,
  decideStreamMode,
  parseTaskEventRow,
  shouldApplyTaskEvent,
  type TaskEventRowView,
  type TaskStreamViewState,
} from '../shared/taskStream.js'

const row = (over: Partial<TaskEventRowView> = {}): TaskEventRowView => ({
  seq: 1,
  schemaVersion: TASK_ROW_SCHEMA_VERSION,
  taskId: 'task_A',
  generationEpoch: 1,
  sequence: 1,
  event: { type: 'GenerationStarted', taskRef: 'task_A' },
  ...over,
})

describe('W4-2c-2 客户端第二层判定（旧代次 chunk 不更新编辑器）', () => {
  it('同任务 + 同代次 + 新序号 ⇒ 应用；旧代次 / 已见序号 / 他人任务 ⇒ 丢弃', () => {
    const state: TaskStreamViewState = { taskId: 'task_A', generationEpoch: 2, lastSequence: 3 }
    // 新序号：应用
    expect(shouldApplyTaskEvent(state, row({ generationEpoch: 2, sequence: 4 }))).toBe(true)
    // **旧代次**（客户端已切书/切章/停止/新生成）：丢弃——这是本卡的核心性质
    expect(shouldApplyTaskEvent(state, row({ generationEpoch: 1, sequence: 9 }))).toBe(false)
    // 同代次已见序号：丢弃（重复/乱序）
    expect(shouldApplyTaskEvent(state, row({ generationEpoch: 2, sequence: 3 }))).toBe(false)
    expect(shouldApplyTaskEvent(state, row({ generationEpoch: 2, sequence: 2 }))).toBe(false)
    // 他人任务：丢弃
    expect(shouldApplyTaskEvent(state, row({ taskId: 'task_B', generationEpoch: 2, sequence: 9 }))).toBe(false)
    // 未绑定任务：丢弃
    expect(shouldApplyTaskEvent({ taskId: null, generationEpoch: 0, lastSequence: 0 }, row())).toBe(false)
    // 应用后状态推进
    const applied = applyTaskEvent(state, row({ generationEpoch: 2, sequence: 4 }))
    expect(applied.taskId).toBe('task_A')
    expect(applied.generationEpoch).toBe(2)
    expect(applied.lastSequence).toBe(4)
  })

  it('代次触发点：切书/切章/停止/新生成各 +1，且序号归零（新代次重新计）', () => {
    let state: TaskStreamViewState = { taskId: 'task_A', generationEpoch: 0, lastSequence: 5 }
    for (const reason of ['book-switch', 'chapter-switch', 'stop', 'new-generation'] as const) {
      state = bumpGenerationEpoch(state, reason)
      expect(state.lastSequence).toBe(0)
    }
    expect(state.generationEpoch).toBe(4)
    // 切任务时可换绑 taskId；不传则保持
    expect(bumpGenerationEpoch(state, 'new-generation', 'task_B').taskId).toBe('task_B')
    expect(bumpGenerationEpoch(state, 'stop').taskId).toBe('task_A')
  })
})

describe('W4-2c-2 补发/快照决策（与后端口径一致）', () => {
  it('决策表：合法游标补发；非法/领先/早于首号 ⇒ 快照', () => {
    expect(decideStreamMode({ since: 0, firstSeq: 1, lastSeq: 5 })).toEqual({ mode: 'replay' })
    expect(decideStreamMode({ since: 5, firstSeq: 1, lastSeq: 5 })).toEqual({ mode: 'replay' })
    expect(decideStreamMode({ since: null, firstSeq: 1, lastSeq: 5 })).toEqual({
      mode: 'snapshot',
      reason: 'cursor_invalid',
    })
    expect(decideStreamMode({ since: -1, firstSeq: 1, lastSeq: 5 })).toEqual({
      mode: 'snapshot',
      reason: 'cursor_invalid',
    })
    // 游标领先账本末号（账本被截断/替换）
    expect(decideStreamMode({ since: 99, firstSeq: 1, lastSeq: 5 })).toEqual({
      mode: 'snapshot',
      reason: 'cursor_ahead',
    })
    // 游标早于账本首号之前（中间行已不存在）
    expect(decideStreamMode({ since: 0, firstSeq: 3, lastSeq: 5 })).toEqual({
      mode: 'snapshot',
      reason: 'ledger_truncated',
    })
    // 账本无任务行：空补发（不是快照）
    expect(decideStreamMode({ since: 7, firstSeq: null, lastSeq: null })).toEqual({ mode: 'replay' })
  })

  it('行收窄：五项不全 / 非对象一律 null（不猜测）', () => {
    expect(parseTaskEventRow(row())?.taskId).toBe('task_A')
    expect(parseTaskEventRow(row({ attemptId: 'attempt_1' }))?.attemptId).toBe('attempt_1')
    expect(parseTaskEventRow({ seq: 1, event: {} })).toBeNull()
    expect(parseTaskEventRow(null)).toBeNull()
    expect(parseTaskEventRow('x')).toBeNull()
  })
})
