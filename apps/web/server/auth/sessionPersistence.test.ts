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

  it('全局重置码上限优先淘汰已消费的旧记录，未消费记录保持可用', () => {
    const root = tempRoot()
    const capped = new SessionManager(new InMemoryAuthProvider(), { maxResetCodes: 2 })
    capped.configurePersistence(root)

    const code1 = capped.createResetCode('r1@example.com', 'u1')
    capped.consumeResetCode(code1)
    const code2 = capped.createResetCode('r2@example.com', 'u2')
    capped.createResetCode('r3@example.com', 'u3')

    // 已消费的 code1 被优先淘汰；code2/code3 仍有效
    expect(() => capped.consumeResetCode(code1)).toThrow(/invalid or not found/)
    expect(capped.consumeResetCode(code2).userId).toBe('u2')
  })
})
