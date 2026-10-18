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
})
