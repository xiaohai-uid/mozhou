/**
 * apps/web · 账号体系与设备授权路由 (Account & Device Flow Routes · T08)。
 * - 注册、登录、退出、刷新、重置；
 * - 会话安全：HttpOnly / SameSite=Lax / Secure cookies，写请求防 CSRF；
 * - Windows PKCE 设备授权（系统浏览器回调接收器）；
 * - 最多 3 个绑定设备限额，解绑即撤销票据；
 * - 用户间严格隔离，错误不泄露账号存在性。
 */
import type { RouteHandler } from '../router.js'
import { RequestBoundaryError } from '../security.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import { defaultDeviceFlowManager } from '../auth/deviceFlow.js'

export const accountRoutes: RouteHandler = async (req, res, { path, body, json }) => {
  // 1. 获取当前用户账号信息与绑定设备
  if (path === '/api/account' || path === '/api/account/session') {
    if (req.method !== 'GET') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const principal = await defaultSessionManager.verifyRequestSession(req)
    const devices = defaultDeviceFlowManager.listDevices(principal.userId)
    json(200, {
      ok: true,
      user: {
        id: principal.userId,
        email: principal.email,
        role: principal.role ?? 'author',
        plan: principal.plan ?? 'free',
      },
      devices,
    })
    return true
  }

  // 2. 账号注册
  if (path === '/api/account/register') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password || password.length < 6) {
      throw new RequestBoundaryError(400, 'INVALID_REGISTRATION_DATA', 'valid email and minimum 6-character password required')
    }
    const { user, sessionToken } = await defaultSessionManager.provider.signUp(email, password)
    json(200, { ok: true, user, sessionToken })
    return true
  }

  // 3. 账号登录
  if (path === '/api/account/login') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) {
      throw new RequestBoundaryError(400, 'INVALID_LOGIN_DATA', 'email and password required')
    }

    const ip = req.socket.remoteAddress || '127.0.0.1'
    const limitKey = `${ip}:${email.toLowerCase()}`
    const rateCheck = defaultSessionManager.loginLimiter.check(limitKey)
    if (!rateCheck.allowed) {
      throw new RequestBoundaryError(429, 'TOO_MANY_ATTEMPTS', 'too many login attempts, please try again later')
    }

    const { user } = await defaultSessionManager.provider.signIn(email, password)
    const principal = { userId: user.id, email: user.email }
    const { session, cookie } = defaultSessionManager.createSession(principal)

    res.setHeader('Set-Cookie', cookie)
    json(200, {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
      },
      csrfToken: session.csrfToken,
    })
    return true
  }

  // 4. 账号退出
  if (path === '/api/account/logout') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const sessionId = defaultSessionManager.extractSessionId(req)
    if (sessionId) {
      const session = defaultSessionManager.getSession(sessionId)
      if (session) {
        defaultSessionManager.revokeSession(sessionId)
      }
      await defaultSessionManager.provider.signOut(sessionId)
    }
    res.setHeader('Set-Cookie', defaultSessionManager.createClearCookie())
    json(200, { ok: true })
    return true
  }

  // 5. 请求重置密码（一次性短期 code）
  if (path === '/api/account/reset-password-request') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email) {
      throw new RequestBoundaryError(400, 'INVALID_EMAIL', 'valid email required')
    }
    const ip = req.socket.remoteAddress || '127.0.0.1'
    const rateCheck = defaultSessionManager.resetLimiter.check(`${ip}:${email}`)
    if (!rateCheck.allowed) {
      throw new RequestBoundaryError(429, 'TOO_MANY_ATTEMPTS', 'too many reset attempts')
    }

    let testResetCode: string | undefined
    if (defaultSessionManager.provider instanceof InMemoryAuthProvider) {
      const existing = defaultSessionManager.provider.getUserByEmail(email)
      if (existing) {
        testResetCode = defaultSessionManager.createResetCode(email, existing.id)
      }
    } else {
      await defaultSessionManager.provider.requestPasswordReset(email)
    }

    // 响应永远不泄露该账户是否存在
    json(200, {
      ok: true,
      message: 'If the account exists, reset instructions have been dispatched.',
      testResetCode,
    })
    return true
  }

  // 6. 确认重置密码（单次消费，二次消费或过期拒绝）
  if (path === '/api/account/reset-password-confirm') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (!code || !newPassword || newPassword.length < 6) {
      throw new RequestBoundaryError(400, 'INVALID_RESET_DATA', 'valid reset code and new password required')
    }

    // 消费一次性重置码（单次使用：首次成功，二次拒绝，过期拒绝）
    const record = defaultSessionManager.consumeResetCode(code)
    if (defaultSessionManager.provider instanceof InMemoryAuthProvider) {
      defaultSessionManager.provider.updatePasswordForUser(record.userId, newPassword)
    } else {
      await defaultSessionManager.provider.confirmPasswordReset(code, newPassword)
    }

    // 密码重置成功后，使用户现有全部 session 均失效
    defaultSessionManager.revokeAllForUser(record.userId)

    json(200, { ok: true, message: 'Password reset successfully' })
    return true
  }

  // 7. 设备授权请求初始化 (PKCE · Windows 系统浏览器拉起)
  if (path === '/api/auth/device/authorize') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const state = typeof body.state === 'string' ? body.state : ''
    const codeChallenge = typeof body.codeChallenge === 'string' ? body.codeChallenge : ''
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName : undefined

    const pending = defaultDeviceFlowManager.createAuthorizationRequest({
      state,
      codeChallenge,
      redirectUri,
      deviceName,
    })
    json(200, { ok: true, pending })
    return true
  }

  // 8. 浏览器确认设备授权 (由已登录的 Web 会话确认)
  if (path === '/api/auth/device/confirm') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const principal = await defaultSessionManager.verifyRequestSession(req)
    const state = typeof body.state === 'string' ? body.state : ''
    const result = defaultDeviceFlowManager.authorize(state, principal.userId)
    json(200, { ok: true, ...result })
    return true
  }

  // 9. 设备 Token 兑换 (Windows 本地客户端调用)
  if (path === '/api/auth/device/token') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const code = typeof body.code === 'string' ? body.code : ''
    const state = typeof body.state === 'string' ? body.state : ''
    const codeVerifier = typeof body.codeVerifier === 'string' ? body.codeVerifier : ''
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName : undefined

    const tokens = defaultDeviceFlowManager.exchangeCode({
      code,
      state,
      codeVerifier,
      deviceName,
    })
    json(200, { ok: true, ...tokens })
    return true
  }

  // 10. 设备 Token 刷新
  if (path === '/api/auth/device/refresh') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : ''
    const result = defaultDeviceFlowManager.refreshDeviceToken(refreshToken)
    json(200, { ok: true, ...result })
    return true
  }

  // 11. 列出当前用户的绑定设备
  if (path === '/api/account/devices') {
    if (req.method !== 'GET') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const principal = await defaultSessionManager.verifyRequestSession(req)
    const devices = defaultDeviceFlowManager.listDevices(principal.userId)
    json(200, { ok: true, devices })
    return true
  }

  // 12. 解绑指定设备
  if (path === '/api/account/devices/unbind') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const principal = await defaultSessionManager.verifyRequestSession(req)
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    defaultDeviceFlowManager.unbindDevice(principal.userId, deviceId)
    json(200, { ok: true, unbound: deviceId })
    return true
  }

  // 13. 账号注销删除
  if (path === '/api/account/delete') {
    if (req.method !== 'POST') {
      json(405, { ok: false, error: 'Method Not Allowed' })
      return true
    }
    const principal = await defaultSessionManager.verifyRequestSession(req)
    // 先删云端账号：删除失败即整体失败，不清理本机会话，也绝不回报注销成功——
    // 否则用户会以为账号已消失，实际云端记录仍在。
    try {
      await defaultSessionManager.provider.deleteAccount(principal.userId)
    } catch (err) {
      const boundary = err instanceof RequestBoundaryError ? err : null
      json(boundary?.status ?? 500, {
        ok: false,
        code: boundary?.code ?? 'ACCOUNT_DELETE_FAILED',
        error: (err as Error).message,
        notice: '账号未删除；本机会话与本地作品均未改动。',
      })
      return true
    }
    // 云端已删除：清理本机会话与凭证；不触碰本机作品
    defaultSessionManager.revokeAllForUser(principal.userId)
    res.setHeader('Set-Cookie', defaultSessionManager.createClearCookie())
    json(200, {
      ok: true,
      deleted: principal.userId,
      notice: 'Account deleted from server. Local novel files on disk remain untouched.',
    })
    return true
  }

  return false
}
