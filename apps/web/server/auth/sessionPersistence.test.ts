/**
 * D4：会话与重置码跨进程持久化。
 *
 * 验收：重启后会话仍有效；撤销后重启仍无效；过期会话回读时清理；
 * 一次性重置码消费跨重启仍被拒；审计不落原始 bearer token。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryAuthProvider, SessionManager } from './session.js'

let dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  dirs = []
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-session-store-'))
  dirs.push(dir)
  return dir
}

function manager(root: string): SessionManager {
  const instance = new SessionManager(new InMemoryAuthProvider())
  instance.configurePersistence(root)
  return instance
}

describe('D4 会话持久化', () => {
  it('重启后会话仍有效；撤销后重启仍无效', () => {
    const root = tempRoot()
    const first = manager(root)
    const { session } = first.createSession({ userId: 'u1', email: 'a@example.com' })

    const second = manager(root)
    expect(second.getSession(session.sessionId)).toMatchObject({ userId: 'u1', email: 'a@example.com' })

    second.revokeSession(session.sessionId)
    const third = manager(root)
    expect(third.getSession(session.sessionId)).toBeNull()
  })

  it('过期会话在回读时被清理', async () => {
    const root = tempRoot()
    const first = manager(root)
    const { session } = first.createSession({ userId: 'u2', email: null }, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))

    const second = manager(root)
    expect(second.getSession(session.sessionId)).toBeNull()
  })

  it('一次性重置码消费跨重启仍被拒', () => {
    const root = tempRoot()
    const first = manager(root)
    const code = first.createResetCode('a@example.com', 'u1')

    const second = manager(root)
    expect(second.consumeResetCode(code).userId).toBe('u1')

    const third = manager(root)
    expect(() => third.consumeResetCode(code)).toThrow(/already been consumed/)
  })

  it('审计记录事件但不落原始 session token', () => {
    const root = tempRoot()
    const first = manager(root)
    const { session } = first.createSession({ userId: 'u1', email: 'a@example.com' })
    first.revokeSession(session.sessionId)

    const audit = readFileSync(join(root, 'users', 'auth-audit.jsonl'), 'utf8')
    expect(audit).toContain('session.created')
    expect(audit).toContain('session.revoked')
    expect(audit).not.toContain(session.sessionId)
  })

  it('损坏的状态文件显式失败，不静默丢会话', () => {
    const root = tempRoot()
    mkdirSync(join(root, 'users'), { recursive: true })
    writeFileSync(join(root, 'users', 'auth-state.json'), '{not-json')

    const broken = new SessionManager(new InMemoryAuthProvider())
    expect(() => broken.configurePersistence(root)).toThrow()
  })

  it('配额淘汰的会话跨重启依然失效，保留的会话不受影响', () => {
    const root = tempRoot()
    const first = manager(root)
    const sessions = []
    for (let i = 0; i < 11; i++) {
      sessions.push(first.createSession({ userId: 'quota-user', email: 'q@example.com' }).session)
    }

    // 重启后回读：被淘汰的最老会话仍不可用
    const second = manager(root)
    expect(second.getSession(sessions[0]!.sessionId)).toBeNull()
    for (let i = 1; i < 11; i++) {
      expect(second.getSession(sessions[i]!.sessionId)).not.toBeNull()
    }
  })

  it('配额淘汰写入审计事件且不落原始 token', () => {
    const root = tempRoot()
    const first = manager(root)
    const sessions = []
    for (let i = 0; i < 11; i++) {
      sessions.push(first.createSession({ userId: 'audit-user', email: 'a@example.com' }).session)
    }

    const audit = readFileSync(join(root, 'users', 'auth-audit.jsonl'), 'utf8')
    expect(audit).toContain('session.evicted_user_quota')
    expect(audit).not.toContain(sessions[0]!.sessionId)
  })

  it('全局容量上限按最老会话淘汰', () => {
    const root = tempRoot()
    const capped = new SessionManager(new InMemoryAuthProvider(), {
      maxSessionsPerUser: 100,
      maxActiveSessions: 2,
    })
    capped.configurePersistence(root)

    const a = capped.createSession({ userId: 'cap-a', email: null }).session
    const b = capped.createSession({ userId: 'cap-b', email: null }).session
    const c = capped.createSession({ userId: 'cap-c', email: null }).session

    expect(capped.getSession(a.sessionId)).toBeNull()
    expect(capped.getSession(b.sessionId)).not.toBeNull()
    expect(capped.getSession(c.sessionId)).not.toBeNull()
  })

  it('全局重置码上限只淘汰未消费记录，已消费记录跨重启仍答「已使用」', () => {
    const root = tempRoot()
    const capped = new SessionManager(new InMemoryAuthProvider(), { maxResetCodes: 2 })
    capped.configurePersistence(root)

    const consumed = capped.createResetCode('used@example.com', 'u1')
    capped.consumeResetCode(consumed)
    const older = capped.createResetCode('older@example.com', 'u2')
    const newer = capped.createResetCode('newer@example.com', 'u3')

    // 未消费的最旧记录被淘汰，已消费记录保留语义
    expect(() => capped.consumeResetCode(older)).toThrow(/invalid or not found/)
    expect(() => capped.consumeResetCode(consumed)).toThrow(/already been consumed/)
    expect(capped.consumeResetCode(newer).userId).toBe('u3')

    // 重启后「已使用」仍成立，不降级为「不存在」
    const second = manager(root)
    expect(() => second.consumeResetCode(consumed)).toThrow(/already been consumed/)
  })

  it('创建会话时被动清理过期会话（持久化文件中不再出现）', () => {
    const root = tempRoot()
    const first = manager(root)
    const { session: expired } = first.createSession({ userId: 'u-expired', email: null }, -1000)

    first.createSession({ userId: 'u-live', email: null })

    const persisted = readFileSync(join(root, 'users', 'auth-state.json'), 'utf8')
    expect(persisted).not.toContain(expired.sessionId)
  })

  it('回读超过新上限的状态文件时收敛容量', () => {
    const root = tempRoot()
    mkdirSync(join(root, 'users'), { recursive: true })
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `ses_legacy_${i}`,
      userId: 'u-legacy',
      email: null,
      csrfToken: `csr_legacy_${i}`,
      createdAt: 1_000 + i,
      expiresAt: Date.now() + 3_600_000,
      revoked: false,
    }))
    writeFileSync(join(root, 'users', 'auth-state.json'), JSON.stringify({ schemaVersion: 1, sessions, resetCodes: [] }))

    const capped = new SessionManager(new InMemoryAuthProvider(), { maxSessionsPerUser: 2 })
    capped.configurePersistence(root)

    expect(capped.getSession('ses_legacy_0')).toBeNull()
    expect(capped.getSession('ses_legacy_2')).toBeNull()
    expect(capped.getSession('ses_legacy_3')).not.toBeNull()
    expect(capped.getSession('ses_legacy_4')).not.toBeNull()
  })

  it('重置码审计不落原始 code', () => {
    const root = tempRoot()
    const first = manager(root)
    const code = first.createResetCode('audit-reset@example.com', 'u-audit')

    const audit = readFileSync(join(root, 'users', 'auth-audit.jsonl'), 'utf8')
    expect(audit).toContain('reset.created')
    expect(audit).not.toContain(code)
  })
})
