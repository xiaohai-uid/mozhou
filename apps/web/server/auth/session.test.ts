// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryAuthProvider,
  SessionManager,
  SupabaseAuthProvider,
  SESSION_COOKIE_NAME,
} from './session.js'
import type { IncomingMessage } from 'node:http'

describe('Session & Auth Verification (T08)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
  })

  it('SupabaseAuthProvider.deleteAccount 在无法删除时显式失败，绝不假成功', async () => {
    // 未配置凭据：整体 fail-closed
    await expect(new SupabaseAuthProvider('', '').deleteAccount('usr_1')).rejects.toThrow('not configured')

    const provider = new SupabaseAuthProvider('https://proj.supabase.co', 'anon-key')
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']

    // 已配置但缺 service-role key：admin delete 无法执行，必须报错而非静默返回
    await expect(provider.deleteAccount('usr_1')).rejects.toThrow(/ACCOUNT_DELETE_UNAVAILABLE/)

    // 配了 service-role key：真正调用 admin delete 端点
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-key'
    const calls: { url: string; method: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init?: { method?: string }) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET' })
        return Promise.resolve({ ok: true, status: 204 } as Response)
      }),
    )

    await expect(provider.deleteAccount('usr_1')).resolves.toBeUndefined()
    expect(calls).toEqual([
      { url: 'https://proj.supabase.co/auth/v1/admin/users/usr_1', method: 'DELETE' },
    ])
  })

  it('SupabaseAuthProvider fails closed when not configured', async () => {
    const unconfigured = new SupabaseAuthProvider('', '')
    expect(unconfigured.isConfigured()).toBe(false)
    expect(await unconfigured.verifyToken('any-token')).toBeNull()
    await expect(unconfigured.signUp('a@b.com', 'pwd')).rejects.toThrow('not configured')
    await expect(unconfigured.signIn('a@b.com', 'pwd')).rejects.toThrow('not configured')
  })

  it('InMemoryAuthProvider handles signup, signin, and password hashing', async () => {
    const auth = new InMemoryAuthProvider()
    const { user } = await auth.signUp('author@mozhou.ai', 'Secret123!')
    expect(user.email).toBe('author@mozhou.ai')
    expect(user.id).toMatch(/^usr_/)

    // Duplicate signup rejected
    await expect(auth.signUp('author@mozhou.ai', 'Secret123!')).rejects.toThrow('already exists')

    // Sign in with correct password
    const login = await auth.signIn('author@mozhou.ai', 'Secret123!')
    expect(login.user.id).toBe(user.id)
    expect(login.sessionToken).toBeTruthy()

    // Sign in with wrong password
    await expect(auth.signIn('author@mozhou.ai', 'WrongPassword')).rejects.toThrow('invalid login credentials')

    // Sign in with non-existent user gives same error (does not leak existence)
    await expect(auth.signIn('nobody@mozhou.ai', 'Secret123!')).rejects.toThrow('invalid login credentials')

    // Verify token returns verified principal
    const verified = await auth.verifyToken(login.sessionToken)
    expect(verified?.userId).toBe(user.id)
    expect(verified?.email).toBe('author@mozhou.ai')

    // Sign out revokes token
    await auth.signOut(login.sessionToken)
    expect(await auth.verifyToken(login.sessionToken)).toBeNull()
  })

  it('SessionManager manages cookies, verification, and revocation', async () => {
    const auth = new InMemoryAuthProvider()
    const sm = new SessionManager(auth)

    const principal = { userId: 'usr_test_1', email: 'test@example.com' }
    const { session, cookie } = sm.createSession(principal)

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${session.sessionId}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')

    // Simulate incoming request with cookie
    const fakeReq = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}`,
      },
    } as unknown as IncomingMessage

    const verified = await sm.verifyRequestSession(fakeReq)
    expect(verified.userId).toBe(principal.userId)
    expect(verified.email).toBe(principal.email)

    // Revoke session -> next request fails with 401
    sm.revokeSession(session.sessionId)
    await expect(sm.verifyRequestSession(fakeReq)).rejects.toThrow()
  })

  it('rejects unauthenticated requests and forged tokens', async () => {
    const sm = new SessionManager(new InMemoryAuthProvider())

    // No cookie or auth header -> 401
    const noAuthReq = { headers: {} } as unknown as IncomingMessage
    await expect(sm.verifyRequestSession(noAuthReq)).rejects.toThrow('authentication required')

    // Forged token -> 401
    const forgedReq = {
      headers: { authorization: 'Bearer forged-random-jwt-or-token' },
    } as unknown as IncomingMessage
    await expect(sm.verifyRequestSession(forgedReq)).rejects.toThrow('invalid, revoked, or expired')
  })

  it('handles single-use password reset codes with expiry', () => {
    const sm = new SessionManager()
    const code = sm.createResetCode('user@mozhou.ai', 'usr_123', 5000)

    // 首次消费成功
    const first = sm.consumeResetCode(code)
    expect(first.userId).toBe('usr_123')
    expect(first.consumed).toBe(true)

    // 第二次消费拒绝（单次使用）
    expect(() => sm.consumeResetCode(code)).toThrow('already been consumed')

    // 过期 code 拒绝
    const expiredCode = sm.createResetCode('user@mozhou.ai', 'usr_123', -1000)
    expect(() => sm.consumeResetCode(expiredCode)).toThrow('expired')
  })

  it('rate limiter restricts rapid attempts', () => {
    const sm = new SessionManager()
    const ip = '127.0.0.1'

    for (let i = 0; i < 5; i++) {
      expect(sm.loginLimiter.check(ip).allowed).toBe(true)
    }
    // 第 6 次触发限流
    expect(sm.loginLimiter.check(ip).allowed).toBe(false)
  })

  it('validates CSRF token on write requests', () => {
    const sm = new SessionManager()
    const { session } = sm.createSession({ userId: 'usr_1', email: 'u1@test.com' })

    const validReq = {
      headers: { 'x-csrf-token': session.csrfToken },
    } as unknown as IncomingMessage
    expect(() => sm.assertCsrf(validReq, session)).not.toThrow()

    const invalidReq = {
      headers: { 'x-csrf-token': 'wrong-csrf' },
    } as unknown as IncomingMessage
    expect(() => sm.assertCsrf(invalidReq, session)).toThrow('CSRF')
  })
})
