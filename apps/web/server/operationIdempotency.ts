/**
 * W3 操作幂等 · 服务端请求摘要与操作身份（t32 冻结契约 §C.3）。
 *
 * 摘要只覆盖**影响副作用的字段**：operationType / bookId / chapterIndex / expectedRevision /
 * body（**规范化后**）/ title / confirmExternalOverwrite / summary / usage / schemaVersion。
 * operationId 是身份不是意图，不入摘要；时间戳、模型名、attemptId 等每次重试会变的字段也不入。
 *
 * 正文规范化必须与写入器共用同一个函数（`normalizeProseBody`）——否则「少一个末尾换行」
 * 的重试会被判成不同意图，返回 OPERATION_ID_REUSED，幂等直接失效。
 */
import { createHash } from 'node:crypto'
import { normalizeProseBody } from '@mozhou/data-plane'
import type { OperationIntent, OperationType } from '@mozhou/data-plane'

/** 命令契约版本：未知版本必须拒绝，不得静默解释。 */
export const OPERATION_SCHEMA_VERSION = 1

/** operationId 形状：长度 1–128，字符集 ^[A-Za-z0-9._:-]+$。 */
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export class OperationRequestError extends Error {
  override readonly name = 'OperationRequestError'

  constructor(
    readonly code: 'OPERATION_ID_INVALID' | 'OPERATION_SCHEMA_UNSUPPORTED',
    message: string,
  ) {
    super(message)
  }
}

/** canonical JSON：键按 UTF-16 码元升序递归排序、无空白、undefined 折叠为 null、数组保持顺序。 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

export interface DigestInput {
  readonly operationType: OperationType
  readonly bookId: string
  readonly chapterIndex: number
  readonly expectedRevision: number | null
  readonly body?: string | undefined
  readonly title?: string | undefined
  readonly confirmExternalOverwrite?: boolean | undefined
  readonly summary?: string | undefined
  readonly usage?: unknown
}

export function computeRequestDigest(input: DigestInput): string {
  const canonical = canonicalJson({
    operationType: input.operationType,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    expectedRevision: input.expectedRevision,
    body: input.body === undefined ? null : normalizeProseBody(input.body),
    title: input.title ?? null,
    confirmExternalOverwrite: input.confirmExternalOverwrite ?? false,
    summary: input.summary ?? null,
    usage: input.usage ?? null,
    schemaVersion: OPERATION_SCHEMA_VERSION,
  })
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

/**
 * 解析请求里的操作身份：未携带 operationId ⇒ null（旧请求，保留既有 CAS 语义，不承诺跨重启去重）。
 * 携带即校验形状与 schemaVersion——不合法一律 400，绝不静默降级。
 */
export function parseOperationIntent(
  body: Record<string, unknown>,
): { readonly operationId: string; readonly schemaVersion: number } | null {
  const rawId = body['operationId']
  if (rawId === undefined || rawId === null) {
    return null
  }
  if (typeof rawId !== 'string' || !OPERATION_ID_PATTERN.test(rawId)) {
    throw new OperationRequestError('OPERATION_ID_INVALID', 'operationId must match ^[A-Za-z0-9._:-]{1,128}$')
  }
  const rawSchema = body['schemaVersion']
  if (rawSchema !== undefined && rawSchema !== OPERATION_SCHEMA_VERSION) {
    throw new OperationRequestError(
      'OPERATION_SCHEMA_UNSUPPORTED',
      `schemaVersion ${JSON.stringify(rawSchema)} is not supported (expected ${OPERATION_SCHEMA_VERSION})`,
    )
  }
  return { operationId: rawId, schemaVersion: OPERATION_SCHEMA_VERSION }
}

export function buildOperationIntent(
  operationType: OperationType,
  operationId: string,
  context: { readonly principalId: string; readonly bookId: string },
  digest: string,
): OperationIntent {
  return {
    operationType,
    operationId,
    principalId: context.principalId,
    bookId: context.bookId,
    requestDigest: digest,
  }
}
