/**
 * 会话记录类型（D4）：session.ts 与 sessionStore.ts 共用，避免类型导入成环。
 * 纯类型文件，无运行时依赖。
 */

export interface SessionRecord {
  readonly sessionId: string
  readonly userId: string
  readonly email: string | null
  /** 供 `assertCsrf` 校验的令牌；当前未接线、不下发客户端（见 assertCsrf 注释）。 */
  readonly csrfToken: string
  readonly createdAt: number
  expiresAt: number
  revoked: boolean
}

export interface ResetCodeRecord {
  readonly code: string
  readonly email: string
  readonly userId: string
  readonly expiresAt: number
  consumed: boolean
}
