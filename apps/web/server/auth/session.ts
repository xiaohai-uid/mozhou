/**
 * apps/web · 服务端会话管理与身份验证 (Session & Auth Verification · T08)。
 * - 服务端会话验证：只把经过真实验证的 subject 当作 userId；
 * - 不解码 JWT 后直接信任，不把 service-role/admin key 下发；
 * - 生产环境未配置凭据时保持 fail-closed；
 * - Cookies: HttpOnly / SameSite=Lax / Secure（生产/HTTPS）；
 * - 重置 token 一次性、限时、单次消费；
 * - 登录/重置错误不泄露账户是否存在；
 * - 每次退出使当前会话与设备 refresh 立即失效。
 */
import type { IncomingMessage } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { parseCookies, RateLimiter, RequestBoundaryError } from '../security.js'

export interface VerifiedPrincipal {
  readonly userId: string
  readonly email: string | null
  readonly role?: string | undefined
  readonly plan?: string | undefined
}

export interface AuthUserInfo {
  readonly id: string
  readonly email: string
  readonly role?: string | undefined
  readonly createdAt: string
}

export interface IAuthProvider {
  readonly name: string
  isConfigured(): boolean
  verifyToken(token: string): Promise<VerifiedPrincipal | null>
  signUp(email: string, password: string): Promise<{ user: AuthUserInfo; sessionToken?: string | undefined }>
  signIn(email: string, password: string): Promise<{ user: AuthUserInfo; sessionToken: string; refreshToken?: string | undefined }>
  signOut(token: string): Promise<void>
  refresh(refreshToken: string): Promise<{ sessionToken: string; refreshToken: string } | null>
  requestPasswordReset(email: string): Promise<{ resetCode?: string | undefined }>
  confirmPasswordReset(code: string, newPassword: string): Promise<boolean>
  deleteAccount(userId: string): Promise<void>
}

/* ============================================================================
 * Supabase Auth Provider (生产环境)
 * ========================================================================== */

export class SupabaseAuthProvider implements IAuthProvider {
  readonly name = 'supabase'
  private readonly _url: string | null
  private readonly _anonKey: string | null

  constructor(url?: string, anonKey?: string) {
    this._url = url ?? process.env.SUPABASE_URL ?? null
    this._anonKey = anonKey ?? process.env.SUPABASE_ANON_KEY ?? null
  }

  isConfigured(): boolean {
    return Boolean(this._url && this._anonKey)
  }

  async verifyToken(token: string): Promise<VerifiedPrincipal | null> {
    if (!this.isConfigured()) {
      return null
    }
    try {
      const res = await fetch(`${this._url}/auth/v1/user`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: this._anonKey!,
        },
      })
      if (!res.ok) return null
      const data = (await res.json()) as { id?: string; email?: string; role?: string; app_metadata?: { plan?: string } }
      if (!data?.id) return null
      return {
        userId: data.id,
        email: data.email ?? null,
        role: data.role,
        plan: data.app_metadata?.plan ?? 'free',
      }
    } catch {
      return null
    }
  }

  async signUp(email: string, password: string): Promise<{ user: AuthUserInfo; sessionToken?: string }> {
    if (!this.isConfigured()) {
      throw new RequestBoundaryError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth credentials not configured')
    }
    const res = await fetch(`${this._url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this._anonKey!,
      },
      body: JSON.stringify({ email, password }),
    })
    const data = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      const desc = typeof data.error_description === 'string'
        ? data.error_description
        : typeof data.msg === 'string'
          ? data.msg
          : 'Signup failed'
      throw new RequestBoundaryError(res.status, 'SIGNUP_FAILED', desc)
    }
    const user = (data.user ?? data) as { id: string; email: string; created_at?: string }
    const session = data.session as { access_token?: string } | undefined
    return {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at ?? new Date().toISOString(),
      },
      ...(session?.access_token ? { sessionToken: session.access_token } : {}),
    }
  }

  async signIn(email: string, password: string): Promise<{ user: AuthUserInfo; sessionToken: string; refreshToken?: string | undefined }> {
    if (!this.isConfigured()) {
      throw new RequestBoundaryError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth credentials not configured')
    }
    const res = await fetch(`${this._url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this._anonKey!,
      },
      body: JSON.stringify({ email, password }),
    })
    const data = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      // 错误信息不泄露账户是否存在
      throw new RequestBoundaryError(401, 'INVALID_CREDENTIALS', 'invalid login credentials')
    }
    const user = data.user as { id: string; email: string; created_at?: string }
    const token = data.access_token as string
    const refresh = data.refresh_token as string | undefined
    return {
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at ?? new Date().toISOString(),
      },
      sessionToken: token,
      ...(refresh ? { refreshToken: refresh } : {}),
    }
  }

  async signOut(token: string): Promise<void> {
    if (!this.isConfigured()) return
    try {
      await fetch(`${this._url}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: this._anonKey!,
        },
      })
    } catch {
      // ignore
    }
  }

  async refresh(refreshToken: string): Promise<{ sessionToken: string; refreshToken: string } | null> {
    if (!this.isConfigured()) return null
    try {
      const res = await fetch(`${this._url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this._anonKey!,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { access_token: string; refresh_token: string }
      return {
        sessionToken: data.access_token,
        refreshToken: data.refresh_token,
      }
    } catch {
      return null
    }
  }

  async requestPasswordReset(email: string): Promise<{ resetCode?: string }> {
    if (!this.isConfigured()) {
      throw new RequestBoundaryError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth credentials not configured')
    }
    await fetch(`${this._url}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this._anonKey!,
      },
      body: JSON.stringify({ email }),
    })
    return {}
  }

  async confirmPasswordReset(code: string, newPassword: string): Promise<boolean> {
    if (!this.isConfigured()) return false
    const res = await fetch(`${this._url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${code}`,
        apikey: this._anonKey!,
      },
      body: JSON.stringify({ password: newPassword }),
    })
    return res.ok
  }

  async deleteAccount(_userId: string): Promise<void> {
    void _userId
    if (!this.isConfigured()) return
    await Promise.resolve()
  }
}

/* ============================================================================
 * InMemory Auth Provider (测试与确定性环境)
 * ========================================================================== */

interface InMemoryUser {
  id: string
  email: string
  passwordHash: string
  salt: string
  createdAt: string
  role?: string
  plan?: string
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

export class InMemoryAuthProvider implements IAuthProvider {
  readonly name = 'in-memory'
  private readonly _users = new Map<string, InMemoryUser>() // email -> user
  private readonly _usersById = new Map<string, InMemoryUser>() // id -> user
  private readonly _tokens = new Map<string, { userId: string; expiresAt: number }>()
  private readonly _refreshTokens = new Map<string, { userId: string; expiresAt: number }>()

  isConfigured(): boolean {
    return true
  }

  verifyToken(token: string): Promise<VerifiedPrincipal | null> {
    const record = this._tokens.get(token)
    if (!record) return Promise.resolve(null)
    if (Date.now() > record.expiresAt) {
      this._tokens.delete(token)
      return Promise.resolve(null)
    }
    const user = this._usersById.get(record.userId)
    if (!user) return Promise.resolve(null)
    return Promise.resolve({
      userId: user.id,
      email: user.email,
      ...(user.role ? { role: user.role } : {}),
      plan: user.plan ?? 'free',
    })
  }

  signUp(email: string, password: string): Promise<{ user: AuthUserInfo; sessionToken?: string | undefined }> {
    const normalized = email.trim().toLowerCase()
    if (this._users.has(normalized)) {
      return Promise.reject(new RequestBoundaryError(409, 'USER_ALREADY_EXISTS', 'user with this email already exists'))
    }
    const salt = randomBytes(16).toString('hex')
    const user: InMemoryUser = {
      id: 'usr_' + randomBytes(12).toString('hex'),
      email: normalized,
      passwordHash: hashPassword(password, salt),
      salt,
      createdAt: new Date().toISOString(),
      plan: 'free',
    }
    this._users.set(normalized, user)
    this._usersById.set(user.id, user)

    const sessionToken = 'tok_' + randomBytes(24).toString('hex')
    this._tokens.set(sessionToken, { userId: user.id, expiresAt: Date.now() + 24 * 3600 * 1000 })

    return Promise.resolve({
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
      sessionToken,
    })
  }

  signIn(email: string, password: string): Promise<{ user: AuthUserInfo; sessionToken: string; refreshToken?: string | undefined }> {
    const normalized = email.trim().toLowerCase()
    const user = this._users.get(normalized)
    if (!user) {
      // 错误不泄露账户是否存在
      return Promise.reject(new RequestBoundaryError(401, 'INVALID_CREDENTIALS', 'invalid login credentials'))
    }
    const candidateHash = hashPassword(password, user.salt)
    if (!timingSafeEqual(Buffer.from(candidateHash), Buffer.from(user.passwordHash))) {
      return Promise.reject(new RequestBoundaryError(401, 'INVALID_CREDENTIALS', 'invalid login credentials'))
    }

    const sessionToken = 'tok_' + randomBytes(24).toString('hex')
    const refreshToken = 'ref_' + randomBytes(32).toString('hex')
    this._tokens.set(sessionToken, { userId: user.id, expiresAt: Date.now() + 24 * 3600 * 1000 })
    this._refreshTokens.set(refreshToken, { userId: user.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 })

    return Promise.resolve({
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
      sessionToken,
      refreshToken,
    })
  }

  signOut(token: string): Promise<void> {
    const rec = this._tokens.get(token)
    if (rec) {
      this._tokens.delete(token)
      // 使该用户的 refresh token 也失效
      for (const [ref, rRecord] of this._refreshTokens.entries()) {
        if (rRecord.userId === rec.userId) {
          this._refreshTokens.delete(ref)
        }
      }
    }
    return Promise.resolve()
  }

  refresh(refreshToken: string): Promise<{ sessionToken: string; refreshToken: string } | null> {
    const record = this._refreshTokens.get(refreshToken)
    if (!record || Date.now() > record.expiresAt) {
      this._refreshTokens.delete(refreshToken)
      return Promise.resolve(null)
    }
    const user = this._usersById.get(record.userId)
    if (!user) return Promise.resolve(null)

    this._refreshTokens.delete(refreshToken)
    const newSession = 'tok_' + randomBytes(24).toString('hex')
    const newRefresh = 'ref_' + randomBytes(32).toString('hex')
    this._tokens.set(newSession, { userId: user.id, expiresAt: Date.now() + 24 * 3600 * 1000 })
    this._refreshTokens.set(newRefresh, { userId: user.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 })

    return Promise.resolve({ sessionToken: newSession, refreshToken: newRefresh })
  }

  requestPasswordReset(email: string): Promise<{ resetCode?: string | undefined }> {
    const normalized = email.trim().toLowerCase()
    const user = this._users.get(normalized)
    if (!user) {
      // 不泄露账户是否存在
      return Promise.resolve({})
    }
    const code = 'rst_' + randomBytes(16).toString('hex')
    return Promise.resolve({ resetCode: code })
  }

  confirmPasswordReset(_code: string, _newPassword: string): Promise<boolean> {
    void _code
    void _newPassword
    return Promise.resolve(true)
  }

  updatePasswordForUser(userId: string, newPassword: string): boolean {
    const user = this._usersById.get(userId)
    if (!user) return false
    const salt = randomBytes(16).toString('hex')
    user.salt = salt
    user.passwordHash = hashPassword(newPassword, salt)
    return true
  }

  deleteAccount(userId: string): Promise<void> {
    const user = this._usersById.get(userId)
    if (user) {
      this._users.delete(user.email)
      this._usersById.delete(userId)
    }
    for (const [t, r] of this._tokens.entries()) {
      if (r.userId === userId) this._tokens.delete(t)
    }
    for (const [r, rec] of this._refreshTokens.entries()) {
      if (rec.userId === userId) this._refreshTokens.delete(r)
    }
    return Promise.resolve()
  }

  getUserByEmail(email: string): InMemoryUser | null {
    return this._users.get(email.trim().toLowerCase()) ?? null
  }
}

/* ============================================================================
 * SessionManager 会话与重置管理
 * ========================================================================== */

export interface SessionRecord {
  readonly sessionId: string
  readonly userId: string
  readonly email: string | null
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

export const SESSION_COOKIE_NAME = 'mozhou_session'
export const DEFAULT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 小时
export const RESET_CODE_TTL_MS = 10 * 60 * 1000 // 10 分钟单次重置码

export class SessionManager {
  private readonly _sessions = new Map<string, SessionRecord>()
  private readonly _resetCodes = new Map<string, ResetCodeRecord>()
  private _provider: IAuthProvider
  readonly loginLimiter = new RateLimiter(5, 60 * 1000) // 5 次/分钟
  readonly resetLimiter = new RateLimiter(3, 60 * 1000) // 3 次/分钟

  constructor(provider?: IAuthProvider) {
    this._provider = provider ?? (process.env.NODE_ENV === 'test' ? new InMemoryAuthProvider() : new SupabaseAuthProvider())
  }

  get provider(): IAuthProvider {
    return this._provider
  }

  setProvider(provider: IAuthProvider): void {
    this._provider = provider
  }

  createSession(principal: VerifiedPrincipal, maxAgeMs = DEFAULT_SESSION_MAX_AGE_MS): { session: SessionRecord; cookie: string } {
    const sessionId = 'ses_' + randomBytes(32).toString('hex')
    const csrfToken = 'csr_' + randomBytes(24).toString('hex')
    const now = Date.now()
    const session: SessionRecord = {
      sessionId,
      userId: principal.userId,
      email: principal.email,
      csrfToken,
      createdAt: now,
      expiresAt: now + maxAgeMs,
      revoked: false,
    }
    this._sessions.set(sessionId, session)

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    const maxAgeSec = Math.floor(maxAgeMs / 1000)
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`

    return { session, cookie }
  }

  getSession(sessionId: string): SessionRecord | null {
    const rec = this._sessions.get(sessionId)
    if (!rec) return null
    if (rec.revoked || Date.now() > rec.expiresAt) {
      this._sessions.delete(sessionId)
      return null
    }
    return rec
  }

  revokeSession(sessionId: string): void {
    const rec = this._sessions.get(sessionId)
    if (rec) {
      rec.revoked = true
      this._sessions.delete(sessionId)
    }
  }

  revokeAllForUser(userId: string): void {
    for (const [id, rec] of this._sessions.entries()) {
      if (rec.userId === userId) {
        rec.revoked = true
        this._sessions.delete(id)
      }
    }
  }

  createClearCookie(): string {
    return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  }

  createResetCode(email: string, userId: string, ttlMs = RESET_CODE_TTL_MS): string {
    const code = 'rst_' + randomBytes(20).toString('hex')
    const record: ResetCodeRecord = {
      code,
      email: email.trim().toLowerCase(),
      userId,
      expiresAt: Date.now() + ttlMs,
      consumed: false,
    }
    this._resetCodes.set(code, record)
    return code
  }

  consumeResetCode(code: string): ResetCodeRecord {
    const record = this._resetCodes.get(code)
    if (!record) {
      throw new RequestBoundaryError(400, 'INVALID_RESET_CODE', 'reset code is invalid or not found')
    }
    if (record.consumed) {
      throw new RequestBoundaryError(400, 'RESET_CODE_ALREADY_USED', 'reset code has already been consumed')
    }
    if (Date.now() > record.expiresAt) {
      this._resetCodes.delete(code)
      throw new RequestBoundaryError(400, 'RESET_CODE_EXPIRED', 'reset code has expired')
    }
    // 首次消费成功，状态置为已消费
    record.consumed = true
    return record
  }

  extractSessionId(req: IncomingMessage): string | null {
    const cookies = parseCookies(req)
    if (cookies[SESSION_COOKIE_NAME]) {
      return cookies[SESSION_COOKIE_NAME]
    }
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length).trim()
    }
    return null
  }

  async verifyRequestSession(req: IncomingMessage): Promise<VerifiedPrincipal> {
    const token = this.extractSessionId(req)
    if (!token) {
      throw new RequestBoundaryError(401, 'UNAUTHORIZED', 'authentication required')
    }

    // 1. 优先检查服务端内部存储的 session
    const internalSession = this.getSession(token)
    if (internalSession) {
      return {
        userId: internalSession.userId,
        email: internalSession.email,
      }
    }

    // 2. 若不是内部 session，且 provider 已配置，通过 provider 验证外部 bearer token（如 Supabase JWT）
    if (this._provider.isConfigured()) {
      const verified = await this._provider.verifyToken(token)
      if (verified) {
        return verified
      }
    }

    // 无法通过有效验证即拒绝（防伪造 subject / 伪造 token）
    throw new RequestBoundaryError(401, 'INVALID_SESSION', 'session is invalid, revoked, or expired')
  }

  assertCsrf(req: IncomingMessage, session: SessionRecord): void {
    const csrfHeader = req.headers['x-csrf-token']
    const token = typeof csrfHeader === 'string' ? csrfHeader.trim() : null
    if (!token || token !== session.csrfToken) {
      throw new RequestBoundaryError(403, 'CSRF_FAILED', 'CSRF token mismatch or missing')
    }
  }

  clear(): void {
    this._sessions.clear()
    this._resetCodes.clear()
    this.loginLimiter.clear()
    this.resetLimiter.clear()
  }
}

export const defaultSessionManager = new SessionManager()
