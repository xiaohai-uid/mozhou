/**
 * W4-2c-2 · 任务事件流的应用共享契约（browser-safe：零 node/server 依赖）。
 *
 * 三个概念必须在客户端分清（混用会静默出错）：
 * - **外层 seq**：账本级全局序号，服务端分配；游标补发按它做。
 * - **内层 sequence**：单任务内序号，从 1 起；与 generationEpoch 一起用于**丢弃旧代次**。
 * - **generationEpoch**：客户端视图代次（切书/切章/停止/新生成 +1）。
 */

/** 与 packages/runtime 的 TASK_ROW_SCHEMA_VERSION 同值（服务端有奇偶校验用例锁定）。 */
export const TASK_ROW_SCHEMA_VERSION = 1

export interface TaskEventRowView {
  /** 外层：账本级全局序号（游标即它）。 */
  readonly seq: number
  readonly schemaVersion: number
  readonly taskId: string
  /** 单次外部调用（计费归因）。 */
  readonly attemptId?: string
  /** 客户端视图代次。 */
  readonly generationEpoch: number
  /** 内层：单任务内序号（从 1 起）。 */
  readonly sequence: number
  readonly event: { readonly type: string; readonly taskRef?: string; readonly payload?: unknown }
}

/** 客户端视图状态：在看哪个任务、哪个代次、已应用到哪一号。 */
export interface TaskStreamViewState {
  readonly taskId: string | null
  readonly generationEpoch: number
  readonly lastSequence: number
}

export type GenerationEpochReason = 'book-switch' | 'chapter-switch' | 'stop' | 'new-generation'

/**
 * **代次触发点**：切书 / 切章 / 停止 / 新生成 —— 每次 +1，并把内层序号归零
 * （新代次从 1 重新计，旧代次的 sequence 不再与之可比）。
 */
export function bumpGenerationEpoch(
  state: TaskStreamViewState,
  reason: GenerationEpochReason,
  nextTaskId?: string | null,
): TaskStreamViewState {
  void reason
  return {
    taskId: nextTaskId === undefined ? state.taskId : nextTaskId,
    generationEpoch: state.generationEpoch + 1,
    lastSequence: 0,
  }
}

/**
 * **客户端第二层判定**：只有「同一任务 + 非旧代次 + 新序号」的行才允许更新当前编辑器。
 * 服务端已按 seq 补发；这里挡的是**旧代次迟到 chunk**（客户端切了书/章或按了停止之后
 * 仍在到达的旧流数据）——它绝不能改写当前编辑器。
 */
export function shouldApplyTaskEvent(
  state: TaskStreamViewState,
  // 收窄到三个判定字段：服务端补发的整行与「流帧现场构造」的最小行都能传
  row: Pick<TaskEventRowView, 'taskId' | 'generationEpoch' | 'sequence'>,
): boolean {
  if (state.taskId === null || row.taskId !== state.taskId) return false
  if (row.generationEpoch < state.generationEpoch) return false
  if (row.generationEpoch === state.generationEpoch && row.sequence <= state.lastSequence) return false
  return true
}

/** 应用后推进视图状态（调用方在 shouldApplyTaskEvent 为 true 后调用）。 */
export function applyTaskEvent(
  state: TaskStreamViewState,
  row: Pick<TaskEventRowView, 'taskId' | 'generationEpoch' | 'sequence'>,
): TaskStreamViewState {
  return { taskId: row.taskId, generationEpoch: row.generationEpoch, lastSequence: row.sequence }
}

/**
 * 视图代次的进程内共享点（浏览器内一份）：切书/切章/停止/新生成都 +1。
 *
 * 为什么需要共享：流消费点（DialogueStream）除了自己的流内代次，还要知道**别的组件**
 * 是否切了视图——作者在章节列表里点了另一章时，在飞的旧流随后到达的 chunk 必须被丢弃，
 * 而那个点击发生在另一个组件里。
 */
export function createViewGenerationStore(): {
  readonly current: () => number
  readonly bump: (reason: GenerationEpochReason) => number
  readonly reset: () => void
} {
  let epoch = 0
  return {
    current: () => epoch,
    bump: (reason: GenerationEpochReason) => {
      void reason
      epoch += 1
      return epoch
    },
    reset: () => {
      epoch = 0
    },
  }
}

/** 应用级单例。 */
export const viewGeneration = createViewGenerationStore()

export interface StreamModeDecision {
  readonly mode: 'replay' | 'snapshot'
  /** 仅 snapshot 时给出原因，便于诊断（不用于分支判断）。 */
  readonly reason?: 'cursor_invalid' | 'cursor_ahead' | 'ledger_truncated'
}

/**
 * 补发/快照决策（与服务端同一口径的纯函数，便于两侧共测）：
 * - 游标非法 → 快照；
 * - 游标**领先于**账本末号（账本被截断/替换）→ 快照；
 * - 游标**早于**账本首个任务行之前（中间行已不存在）→ 快照；
 * - 其余 → 按外层 seq 补发。
 */
export function decideStreamMode(input: {
  readonly since: number | null
  readonly firstSeq: number | null
  readonly lastSeq: number | null
}): StreamModeDecision {
  const { since, firstSeq, lastSeq } = input
  if (since === null || !Number.isInteger(since) || since < 0) {
    return { mode: 'snapshot', reason: 'cursor_invalid' }
  }
  if (lastSeq === null) {
    // 账本里没有任何任务行：空补发即可（不是快照场景）
    return { mode: 'replay' }
  }
  if (since > lastSeq) {
    return { mode: 'snapshot', reason: 'cursor_ahead' }
  }
  if (firstSeq !== null && since < firstSeq - 1) {
    return { mode: 'snapshot', reason: 'ledger_truncated' }
  }
  return { mode: 'replay' }
}

/** 把服务端原始行收窄成契约视图；形状不认识 → null（调用方按未知处理，绝不猜测）。 */
export function parseTaskEventRow(raw: unknown): TaskEventRowView | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const seq = row['seq']
  const schemaVersion = row['schemaVersion']
  const taskId = row['taskId']
  const generationEpoch = row['generationEpoch']
  const sequence = row['sequence']
  const event = row['event']
  if (
    typeof seq !== 'number' ||
    typeof schemaVersion !== 'number' ||
    typeof taskId !== 'string' ||
    typeof generationEpoch !== 'number' ||
    typeof sequence !== 'number' ||
    typeof event !== 'object' ||
    event === null
  ) {
    return null
  }
  const attemptId = row['attemptId']
  return {
    seq,
    schemaVersion,
    taskId,
    generationEpoch,
    sequence,
    event: event as TaskEventRowView['event'],
    ...(typeof attemptId === 'string' ? { attemptId } : {}),
  }
}
