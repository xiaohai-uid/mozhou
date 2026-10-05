/**
 * W4 任务身份 · 任务记录（t41 §A 冻结契约）。
 *
 * 落点：`<bookRoot>/.mozhou/tasks/<sha256(taskId)>.json`（一任务一文件，目录懒创建）。
 * 运行时区、非 canon：不参与对账、不进 manifest 基线。
 *
 * **四个标识不是一回事**（t41 §A 的三处关键区分，混用会静默出错）：
 * - `taskId`：逻辑任务，**跨 attempt 稳定**；与 W3 的 `operationId`（一次写入操作的身份）**不同**；
 * - `attemptId`：**单次外部调用**，用于计费归因；重试换 attemptId 但 taskId 不变；
 * - `generationEpoch`：**客户端视图切换驱动**（切书/切章/停止/新生成 +1），单调递增，服务端只记录；
 * - `sequence`：**单任务内序号**，从 1 起，供丢弃旧代次的迟到 chunk。
 *
 * 与 W3 操作记录是**单向引用**：任务记录持有 operationIds（任务 → 操作），
 * **操作记录绝不反向引用任务**（写入路径不因此产生任何跨文件写）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RUNTIME_TASKS_DIR } from './layout.js'
import { atomicWriteFileSync } from './atomic-write.js'
import { sha256Hex } from './sha256.js'

/** 记录格式版本：独立演进；旧程序遇未知版本**拒写而非猜测**。 */
export const TASK_RECORD_VERSION = 1

export type TaskKind = 'draft.generate' | 'draft.continue'

export type TaskAttemptState = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown'

export interface TaskAttempt {
  readonly attemptId: string
  readonly startedAt: string
  readonly endedAt?: string
  readonly state: TaskAttemptState
  /** 计费归因（与 taskId 无关）。 */
  readonly provider?: string
  readonly model?: string
}

export interface TaskRecord {
  readonly recordVersion: typeof TASK_RECORD_VERSION
  readonly taskId: string
  readonly bookId: string
  readonly taskKind: TaskKind
  /** 客户端视图切换驱动；单调递增，服务端只记录不推导。 */
  readonly generationEpoch: number
  /** 单任务内序号；从 1 起。 */
  readonly lastSequence: number
  readonly attempts: readonly TaskAttempt[]
  /** 单向引用：任务 → W3 操作记录；反向不成立。 */
  readonly operationIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export class TaskRecordError extends Error {
  override readonly name = 'TaskRecordError'

  constructor(
    readonly code:
      | 'TASK_EXISTS'
      | 'TASK_NOT_FOUND'
      | 'TASK_RECORD_UNSUPPORTED'
      | 'ATTEMPT_EXISTS'
      | 'ATTEMPT_NOT_FOUND'
      | 'INVALID_TASK_ID'
      | 'RETRY_REQUIRES_BILLING_CONFIRMATION',
    message: string,
  ) {
    super(message)
  }
}

function assertTaskId(taskId: string): void {
  if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 128) {
    throw new TaskRecordError('INVALID_TASK_ID', 'INVALID_TASK_ID: taskId must be a non-empty string of at most 128 chars')
  }
}

/** 文件名用 sha256(taskId)：杜绝路径穿越，且避开 NTFS 大小写折叠。 */
export function taskRecordPath(root: string, taskId: string): string {
  assertTaskId(taskId)
  return join(root, RUNTIME_TASKS_DIR, `${sha256Hex(taskId)}.json`)
}

export function readTaskRecord(root: string, taskId: string): TaskRecord | null {
  const path = taskRecordPath(root, taskId)
  if (!existsSync(path)) {
    return null
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (parsed['recordVersion'] !== TASK_RECORD_VERSION) {
    // 旧程序遇新版本拒写而非猜测（与 W3 journal 同纪律）
    throw new TaskRecordError(
      'TASK_RECORD_UNSUPPORTED',
      `TASK_RECORD_UNSUPPORTED: task record version ${JSON.stringify(parsed['recordVersion'])} is not supported`,
    )
  }
  return parsed as unknown as TaskRecord
}

function readOrThrow(root: string, taskId: string): TaskRecord {
  const record = readTaskRecord(root, taskId)
  if (record === null) {
    throw new TaskRecordError('TASK_NOT_FOUND', `TASK_NOT_FOUND: task ${taskId} not found`)
  }
  return record
}

/** 读-改-写：**调用方**必须在同一临界区内（W2 的 withBookWriteLock）持有该书稿锁。 */
function mutate(root: string, taskId: string, fn: (record: TaskRecord) => TaskRecord): TaskRecord {
  const current = readOrThrow(root, taskId)
  const next = { ...fn(current), updatedAt: new Date().toISOString() }
  atomicWriteFileSync(taskRecordPath(root, taskId), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function createTaskRecord(
  root: string,
  input: { readonly taskId: string; readonly bookId: string; readonly taskKind: TaskKind },
): TaskRecord {
  assertTaskId(input.taskId)
  if (existsSync(taskRecordPath(root, input.taskId))) {
    throw new TaskRecordError('TASK_EXISTS', `TASK_EXISTS: task ${input.taskId} already exists`)
  }
  const now = new Date().toISOString()
  const record: TaskRecord = {
    recordVersion: TASK_RECORD_VERSION,
    taskId: input.taskId,
    bookId: input.bookId,
    taskKind: input.taskKind,
    generationEpoch: 0,
    lastSequence: 0,
    attempts: [],
    operationIds: [],
    createdAt: now,
    updatedAt: now,
  }
  mkdirSync(join(root, RUNTIME_TASKS_DIR), { recursive: true })
  atomicWriteFileSync(taskRecordPath(root, input.taskId), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

/** 登记一次外部调用（attemptId 单次唯一；重复登记即拒绝，绝不静默合并计费归因）。 */
export function beginTaskAttempt(
  root: string,
  taskId: string,
  input: { readonly attemptId: string; readonly provider?: string | undefined; readonly model?: string | undefined },
): TaskRecord {
  return mutate(root, taskId, (record) => {
    if (record.attempts.some((attempt) => attempt.attemptId === input.attemptId)) {
      throw new TaskRecordError('ATTEMPT_EXISTS', `ATTEMPT_EXISTS: attempt ${input.attemptId} already registered`)
    }
    const attempt: TaskAttempt = {
      attemptId: input.attemptId,
      startedAt: new Date().toISOString(),
      state: 'running',
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
    }
    return { ...record, attempts: [...record.attempts, attempt] }
  })
}

export function finishTaskAttempt(
  root: string,
  taskId: string,
  input: { readonly attemptId: string; readonly state: Exclude<TaskAttemptState, 'running'> },
): TaskRecord {
  return mutate(root, taskId, (record) => {
    const index = record.attempts.findIndex((attempt) => attempt.attemptId === input.attemptId)
    if (index < 0) {
      throw new TaskRecordError('ATTEMPT_NOT_FOUND', `ATTEMPT_NOT_FOUND: attempt ${input.attemptId} not registered`)
    }
    const attempts = record.attempts.map((attempt, i) =>
      i === index ? { ...attempt, state: input.state, endedAt: new Date().toISOString() } : attempt,
    )
    return { ...record, attempts }
  })
}

/** 客户端视图切换（切书/切章/停止/新生成）驱动；**单调递增**，服务端只记录。 */
export function bumpGenerationEpoch(root: string, taskId: string): number {
  const next = mutate(root, taskId, (record) => ({ ...record, generationEpoch: record.generationEpoch + 1 }))
  return next.generationEpoch
}

/** 取下一个单任务内序号（从 1 起，单调递增）——供丢弃旧代次的迟到 chunk 使用。 */
export function nextTaskSequence(root: string, taskId: string): number {
  const next = mutate(root, taskId, (record) => ({ ...record, lastSequence: record.lastSequence + 1 }))
  return next.lastSequence
}

/**
 * 单向引用：把一次 W3 操作身份挂到任务上（去重）。
 * **不触碰操作记录**——操作侧永不反向引用任务，写入路径因此不产生跨文件写。
 */
export function linkTaskOperation(root: string, taskId: string, operationId: string): TaskRecord {
  return mutate(root, taskId, (record) =>
    record.operationIds.includes(operationId) ? record : { ...record, operationIds: [...record.operationIds, operationId] },
  )
}

/** 可观测：当前书内任务记录数。 */
export function countTaskRecords(root: string): number {
  const dir = join(root, RUNTIME_TASKS_DIR)
  if (!existsSync(dir)) {
    return 0
  }
  return readdirSync(dir).filter((name) => name.endsWith('.json')).length
}

/** 任务是否处于结果不明状态（末次 attempt 为 outcome_unknown）。 */
export function isTaskOutcomeUnknown(record: TaskRecord): boolean {
  if (record.attempts.length === 0) return false
  const last = record.attempts[record.attempts.length - 1]
  return last?.state === 'outcome_unknown'
}

/** 任务是否允许自动重试（outcome_unknown 时关闭一切自动重试链）。 */
export function canTaskAutoRetry(record: TaskRecord): boolean {
  return !isTaskOutcomeUnknown(record)
}

/**
 * outcome_unknown 显式新 attempt 路径：
 * 严禁自动发起，必须由用户显式确认重复计费风险后，分配全新 attemptId（严禁重放原 attemptId）发起。
 */
export function retryTaskWithExplicitConfirmation(
  root: string,
  taskId: string,
  input: {
    readonly newAttemptId: string
    readonly newOperationId?: string | undefined
    readonly confirmDuplicateBilling: boolean
    readonly provider?: string | undefined
    readonly model?: string | undefined
  },
): TaskRecord {
  const current = readOrThrow(root, taskId)
  if (current.attempts.some((a) => a.attemptId === input.newAttemptId)) {
    throw new TaskRecordError(
      'ATTEMPT_EXISTS',
      `ATTEMPT_EXISTS: attempt ${input.newAttemptId} already exists, replaying attempt is strictly forbidden`,
    )
  }
  if (isTaskOutcomeUnknown(current) && !input.confirmDuplicateBilling) {
    throw new TaskRecordError(
      'RETRY_REQUIRES_BILLING_CONFIRMATION',
      'RETRY_REQUIRES_BILLING_CONFIRMATION: outcome_unknown task requires explicit confirmation of possible duplicate billing',
    )
  }
  beginTaskAttempt(root, taskId, {
    attemptId: input.newAttemptId,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
  })
  if (input.newOperationId !== undefined) {
    linkTaskOperation(root, taskId, input.newOperationId)
  }
  return readOrThrow(root, taskId)
}
