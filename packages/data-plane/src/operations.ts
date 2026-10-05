/**
 * W3 操作幂等 · 操作结果记录（t32 冻结契约 §C.1/§C.4）。
 *
 * 落点：`<bookRoot>/.mozhou/operations/<sha256(operationId)>.json`（一操作一文件）。
 * 运行时区、非 canon：不参与对账、不进 manifest 基线。
 *
 * 记录不是旁路账本：提交路径把操作身份写进 pending-commit journal（v2），
 * 结果文件在**线性化点之后、删 journal 之前**落盘，因此「记录说成功而正文未提交」
 * 与「正文提交了却丢了请求身份」都不可能发生（见 chapter.ts 的写入顺序）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RUNTIME_OPERATIONS_DIR } from './layout.js'
import { atomicWriteFileSync } from './atomic-write.js'
import { sha256Hex } from './sha256.js'

/** 结果记录格式版本：**独立于** journalVersion 演进（避免日志版本一升、结果文件全要迁移）。 */
export const OPERATION_RECORD_VERSION = 1

export type OperationType = 'prose.save' | 'chapter.commit' | 'draft.accept' | 'draft.continue'

/** journal v2 携带的操作身份（服务端解析出的主体与书身份，绝不接受请求体自填）。 */
export interface OperationIntent {
  readonly operationType: OperationType
  readonly operationId: string
  readonly principalId: string
  readonly bookId: string
  readonly requestDigest: string
}

export interface OperationResult {
  readonly appliedRevision: number
  readonly appliedBodyHash: string
  readonly commitId?: string
}

export interface OperationRecord {
  readonly recordVersion: typeof OPERATION_RECORD_VERSION
  readonly operationId: string
  readonly operationType: OperationType
  readonly principalId: string
  readonly bookId: string
  readonly requestDigest: string
  /** 操作作用的章：状态查询据此读当前 revision（查询本身仍按 operationId，非按章节）。 */
  readonly chapterIndex: number
  readonly state: 'succeeded'
  readonly result: OperationResult
  /** 仅可观测用；不参与任何相等判定。 */
  readonly recordedAt: string
}

/** 同 ID 不同摘要：身份复用冲突（路由映射 409 OPERATION_ID_REUSED），零盘上变更。 */
export class OperationIdReusedError extends Error {
  /** 声明为 string：子类（作用域不匹配）需要覆写成自己的名字。 */
  override readonly name: string = 'OperationIdReusedError'

  constructor(readonly operationId: string) {
    super(`operationId is already bound to a different request digest: ${operationId}`)
  }
}

/**
 * 作用域不匹配：同 operationId 但 (principalId, bookId) 与记录不同（t32 §C.4 的四元组作用域）。
 *
 * 必须**先于**摘要比较判定：否则他人同 ID 同摘要的重试会被当作回放，直接把**别人**的
 * appliedRevision/appliedBodyHash/commitId 交出去（存在性 + 结果双泄露）。
 * 继承 OperationIdReusedError，使任何尚未区分该码的调用方最坏也只是 409 而非 500。
 */
export class OperationScopeMismatchError extends OperationIdReusedError {
  override readonly name = 'OperationScopeMismatchError'
  readonly code = 'OPERATION_SCOPE_MISMATCH'

  constructor(operationId: string) {
    super(operationId)
    // W3 残余 R1（t39 复审）：基类文案说的是 'different request digest'，与实际原因
    // （主体/书不匹配）不符——日志/排障会误导。此处**只覆写实例 message**：
    // 不改基类签名、不影响 instanceof / code / name，路由 404 分支的响应体用的是
    // 固定文案（proseRoutes.ts:415/:783），因此 HTTP 面不受影响。
    this.message = `operationId is already bound to a different principal or book: ${operationId}`
  }
}

/** 结果文件与 journal 身份不一致（宁败不脏）。 */
export class OperationRecordConflictError extends Error {
  override readonly name = 'OperationRecordConflictError'

  constructor(readonly operationId: string, detail: string) {
    super(`operation record conflict for ${operationId}: ${detail}`)
  }
}

export function operationRecordPath(root: string, operationId: string): string {
  // 文件名用 sha256：杜绝路径穿越，且避开 NTFS 大小写折叠带来的同名碰撞
  return join(root, RUNTIME_OPERATIONS_DIR, `${sha256Hex(operationId)}.json`)
}

export function readOperationRecord(root: string, operationId: string): OperationRecord | null {
  const path = operationRecordPath(root, operationId)
  if (!existsSync(path)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as OperationRecord
  } catch (error) {
    throw new OperationRecordConflictError(operationId, `record file is not valid JSON: ${(error as Error).message}`)
  }
}

/**
 * 幂等写入结果记录：文件已存在且 operationId + requestDigest 匹配 → 跳过（前滚重放安全）；
 * 不匹配 → 抛冲突（绝不覆盖别人的结果）。
 */
export function writeOperationRecordIfAbsent(root: string, record: OperationRecord): void {
  const existing = readOperationRecord(root, record.operationId)
  if (existing !== null) {
    if (existing.operationId !== record.operationId || existing.requestDigest !== record.requestDigest) {
      throw new OperationRecordConflictError(
        record.operationId,
        `existing record has requestDigest ${existing.requestDigest}, incoming ${record.requestDigest}`,
      )
    }
    return
  }
  mkdirSync(join(root, RUNTIME_OPERATIONS_DIR), { recursive: true })
  atomicWriteFileSync(operationRecordPath(root, record.operationId), `${JSON.stringify(record, null, 2)}\n`)
}

/**
 * 幂等前置检查：同 ID 同摘要 ⇒ 命中（调用方直接回放结果）；同 ID 不同摘要 ⇒ 抛身份复用冲突。
 * 返回 null 表示该 operationId 尚无记录，调用方继续正常执行。
 */
export function findReplayableOperation(root: string, intent: OperationIntent): OperationRecord | null {
  const existing = readOperationRecord(root, intent.operationId)
  if (existing === null) {
    return null
  }
  // 作用域（t32 §C.4 四元组）先判：同 ID 不同主体/书 = **不同操作**，绝不回放他人结果。
  // 与状态查询（proseRoutes 已按 principal 作用域）保持一致，避免同实现内部两套口径。
  if (existing.principalId !== intent.principalId || existing.bookId !== intent.bookId) {
    throw new OperationScopeMismatchError(intent.operationId)
  }
  if (existing.requestDigest !== intent.requestDigest || existing.operationType !== intent.operationType) {
    throw new OperationIdReusedError(intent.operationId)
  }
  return existing
}

/** 可观测增长：当前书内操作结果文件数（初版不做自动清理，先让它可被看到）。 */
export function countOperationRecords(root: string): number {
  const dir = join(root, RUNTIME_OPERATIONS_DIR)
  if (!existsSync(dir)) {
    return 0
  }
  return readdirSync(dir).filter((name) => name.endsWith('.json')).length
}
