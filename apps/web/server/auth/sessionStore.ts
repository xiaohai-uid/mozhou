/**
 * D4：会话持久化（sessions + reset codes）。
 *
 * 为什么需要：SessionManager 此前把会话与重置码放在进程内 Map，服务重启/升级即
 * 全部失效——有限用户测试一旦启用账号，重启会把所有人踢出。这里把两类记录落到
 * 数据根的 `users/auth-state.json`，启动时回读；撤销/过期在读取路径上继续生效。
 *
 * 边界：
 * - 单进程假设：同一 dataRoot 已有进程级排他锁（productionServer 启动锁），
 *   store 不做跨进程文件锁。
 * - 文件含 bearer token（sessionId）与一次性重置码，POSIX 下尽力收紧到 0600；
 *   Windows 依赖数据根所在用户目录的 ACL。
 * - 审计只写事件与哈希后的 sessionRef，不写原始 token。
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@mozhou/data-plane'
import type { ResetCodeRecord, SessionRecord } from './sessionTypes.js'

const SCHEMA_VERSION = 1

export interface PersistedAuthState {
  readonly schemaVersion: number
  readonly sessions: readonly SessionRecord[]
  readonly resetCodes: readonly ResetCodeRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!isRecord(value)) return false
  return (
    typeof value['sessionId'] === 'string' &&
    typeof value['userId'] === 'string' &&
    (value['email'] === null || typeof value['email'] === 'string') &&
    typeof value['csrfToken'] === 'string' &&
    typeof value['createdAt'] === 'number' &&
    typeof value['expiresAt'] === 'number' &&
    typeof value['revoked'] === 'boolean'
  )
}

function isResetCodeRecord(value: unknown): value is ResetCodeRecord {
  if (!isRecord(value)) return false
  return (
    typeof value['code'] === 'string' &&
    typeof value['email'] === 'string' &&
    typeof value['userId'] === 'string' &&
    typeof value['expiresAt'] === 'number' &&
    typeof value['consumed'] === 'boolean'
  )
}

/** 审计用：不落原始 bearer token，只留可关联的短哈希。 */
export function sessionRef(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
}

export class SessionStore {
  readonly statePath: string
  readonly auditPath: string

  constructor(dataRoot: string) {
    const usersDir = join(dataRoot, 'users')
    mkdirSync(usersDir, { recursive: true })
    this.statePath = join(usersDir, 'auth-state.json')
    this.auditPath = join(usersDir, 'auth-audit.jsonl')
  }

  /** 缺失 = 首次启动（空态）；损坏/版本不符 = 显式失败，不静默丢会话。 */
  load(): PersistedAuthState | null {
    if (!existsSync(this.statePath)) return null
    const parsed: unknown = JSON.parse(readFileSync(this.statePath, 'utf8'))
    if (!isRecord(parsed)) throw new Error(`${this.statePath}: auth state must be an object`)
    if (parsed['schemaVersion'] !== SCHEMA_VERSION) {
      throw new Error(`${this.statePath}: unsupported auth state schema ${String(parsed['schemaVersion'])}`)
    }
    const sessions = parsed['sessions']
    const resetCodes = parsed['resetCodes']
    if (!Array.isArray(sessions) || !Array.isArray(resetCodes)) {
      throw new Error(`${this.statePath}: auth state requires sessions[] and resetCodes[]`)
    }
    if (!sessions.every(isSessionRecord)) throw new Error(`${this.statePath}: invalid session record`)
    if (!resetCodes.every(isResetCodeRecord)) throw new Error(`${this.statePath}: invalid reset code record`)
    return { schemaVersion: SCHEMA_VERSION, sessions, resetCodes }
  }

  save(sessions: Iterable<SessionRecord>, resetCodes: Iterable<ResetCodeRecord>): void {
    const state: PersistedAuthState = {
      schemaVersion: SCHEMA_VERSION,
      sessions: [...sessions],
      resetCodes: [...resetCodes],
    }
    atomicWriteFileSync(this.statePath, JSON.stringify(state, null, 2) + '\n')
    try {
      chmodSync(this.statePath, 0o600)
    } catch {
      // Windows / 非 POSIX 文件系统：依赖数据根目录 ACL。
    }
  }

  audit(event: string, fields: Record<string, unknown>): void {
    appendFileSync(this.auditPath, JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + '\n', {
      mode: 0o600,
    })
  }
}
