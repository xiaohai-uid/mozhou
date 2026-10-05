/**
 * W3 操作幂等 · 应用共享契约（t32 冻结 §C.1）。
 *
 * 落 apps/web/shared/：UI 与 server 各自 import 本文件，**UI 不 import server 私有实现**
 * （规划 §6.6 禁止 UI → server；仓库既有的 51 处 type-only server import 归 W5 收口）。
 * 本文件必须 **browser-safe**：只含类型与常量，不 import 任何 Node 内置模块或 server 侧实现。
 */

/** 命令契约版本。未知版本必须拒绝，不得静默解释（规划 §8 API-01）。 */
export const OPERATION_SCHEMA_VERSION = 1 as const

export type OperationType = 'prose.save' | 'chapter.commit'

/** 客户端生成的操作标识：同一次意图的重试必须复用。 */
export interface OperationKey {
  readonly operationId: string
}

export interface SaveDraftCommand extends OperationKey {
  readonly schemaVersion: typeof OPERATION_SCHEMA_VERSION
  readonly chapterIndex: number
  /** null = 仅新建（沿用既有语义）。 */
  readonly expectedRevision: number | null
  readonly body: string
  readonly title?: string
  readonly confirmExternalOverwrite?: boolean
}

export interface CommitChapterCommand extends OperationKey {
  readonly schemaVersion: typeof OPERATION_SCHEMA_VERSION
  readonly chapterIndex: number
  /** commit 无新建语义，不收 null。 */
  readonly expectedRevision: number
  readonly summary: string
  readonly usage?: readonly unknown[]
}

/** 命令响应里与幂等相关的字段（向后兼容：老客户端忽略即可）。 */
export interface OperationResponseFields {
  /** true = 本次是回放既有成功结果（正文/版本零变更）。 */
  readonly replayed: boolean
  /** 该操作**当时**落定的 revision（回放时是历史值）。 */
  readonly appliedRevision: number
  /** 当前盘上 revision——**不得**当成自己那次操作的正文基线（规划 §6.4.6）。 */
  readonly currentRevision: number
}

export type OperationState = 'not_found' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown'

export interface OperationStatusRequest extends OperationKey {
  readonly schemaVersion?: number
}

export type OperationStatus =
  | { readonly state: 'not_found'; readonly safeToRetrySameId: boolean }
  | { readonly state: 'running'; readonly operationId: string }
  | {
      readonly state: 'succeeded'
      readonly operationId: string
      readonly result: {
        readonly appliedRevision: number
        readonly appliedBodyHash: string
        readonly commitId?: string
      }
      readonly currentRevision: number
      /** 查询结果**不是**新的提交授权；仅表示该操作曾成功。 */
      readonly replayed: true
    }
  | { readonly state: 'failed'; readonly operationId: string; readonly code: string }
  | { readonly state: 'cancelled'; readonly operationId: string }
  | { readonly state: 'outcome_unknown'; readonly operationId: string }
