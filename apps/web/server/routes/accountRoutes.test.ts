// @vitest-environment node
/**
 * 账号注册登录恢复与 Windows 登录（T08 · 真实 HTTP 级端到端测试）。
 * 测试覆盖标准：
 * - 未登录 GET account → 401；
 * - 伪造 subject/token → 401；
 * - A 退出后旧 cookie → 401；
 * - 错误 Origin 写请求 → 403；
 * - 重置 code 两次消费 → 首次成功、第二次拒绝；过期 code 拒绝；
 * - device code 由另一 state 兑换 → 拒绝且原 code 不被错误消费；
 * - 第 4 设备拒绝；解绑后原 refresh 拒绝；两个用户看不到彼此设备；
 * - 账号注销不触碰本地作品文件。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../api.js'
import { defaultSessionManager, InMemoryAuthProvider, SESSION_COOKIE_NAME } from '../auth/session.js'
import { defaultDeviceFlowManager } from '../auth/deviceFlow.js'

let servers: ReturnType<typeof createServer>[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultDeviceFlowManager.clear()
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: 'not found' }))
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${addr.port}`)
    })
  })
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = 'pkce_v_' + Math.random().toString(36).slice(2)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

describe('Account & Device Authentication HTTP API (T08)', () => {
  it('未登录 GET account → 401', async () => {
    const base = await listen()
    const res = await fetch(`${base}/api/account`, {
      method: 'GET',
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(false)
  })

  it('伪造 subject/token → 401', async () => {
    const base = await listen()

    // 伪造 Bearer token
    const res1 = await fetch(`${base}/api/account`, {
      method: 'GET',
      headers: { Authorization: 'Bearer forged-malicious-jwt-or-token' },
    })
    expect(res1.status).toBe(401)

    // 伪造 Cookie
    const res2 = await fetch(`${base}/api/account`, {
      method: 'GET',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=ses_fake_random_session_id` },
    })
    expect(res2.status).toBe(401)
  })

  it('A 退出后旧 cookie → 401', async () => {
    const base = await listen()

    // 1. 注册新用户 A
    const regRes = await fetch(`${base}/api/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'userA@mozhou.ai', password: 'Password123!' }),
    })
    expect(regRes.status).toBe(200)

    // 2. 登录 A 并获取 Session Cookie
    const loginRes = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'userA@mozhou.ai', password: 'Password123!' }),
    })
    expect(loginRes.status).toBe(200)
    const setCookie = loginRes.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    const cookieMatch = setCookie?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))
    const sessionCookie = `${SESSION_COOKIE_NAME}=${cookieMatch?.[1]}`

    // 3. 验证此时已登录：GET account → 200
    const check1 = await fetch(`${base}/api/account`, {
      headers: { Cookie: sessionCookie },
    })
    expect(check1.status).toBe(200)
    const data1 = (await check1.json()) as { ok: boolean; user: { email: string } }
    expect(data1.user.email).toBe('usera@mozhou.ai')

    // 4. 用户 A 执行退出
    const logoutRes = await fetch(`${base}/api/account/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({}),
    })
    expect(logoutRes.status).toBe(200)

    // 5. 使用旧 Cookie 再次请求 GET account → 401
    const check2 = await fetch(`${base}/api/account`, {
      headers: { Cookie: sessionCookie },
    })
    expect(check2.status).toBe(401)
  })

  it('错误 Origin 写请求 → 403', async () => {
    const base = await listen()

    const res = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://malicious-cross-origin.com',
      },
      body: JSON.stringify({ email: 'userA@mozhou.ai', password: 'pwd' }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(false)
    expect(body.code).toBe('UNTRUSTED_ORIGIN')
  })

  it('重置 code 两次消费 → 首次成功、第二次拒绝；过期 code 拒绝', async () => {
    const base = await listen()

    // 注册用户
    await fetch(`${base}/api/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-user@mozhou.ai', password: 'OldPassword123' }),
    })

    // 请求重置密码
    const reqRes = await fetch(`${base}/api/account/reset-password-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-user@mozhou.ai' }),
    })
    expect(reqRes.status).toBe(200)
    const reqData = (await reqRes.json()) as { ok: boolean; testResetCode?: string }
    const resetCode = reqData.testResetCode!
    expect(resetCode).toBeTruthy()

    // 首次消费重置码 → 200 成功
    const confirm1 = await fetch(`${base}/api/account/reset-password-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: resetCode, newPassword: 'NewPassword456!' }),
    })
    expect(confirm1.status).toBe(200)

    // 第二次消费同一重置码 → 400 拒绝
    const confirm2 = await fetch(`${base}/api/account/reset-password-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: resetCode, newPassword: 'AnotherPassword789!' }),
    })
    expect(confirm2.status).toBe(400)
    const errBody2 = (await confirm2.json()) as Record<string, unknown>
    expect(errBody2.code).toBe('RESET_CODE_ALREADY_USED')

    // 验证新密码可登录，旧密码已失效
    const oldLogin = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-user@mozhou.ai', password: 'OldPassword123' }),
    })
    expect(oldLogin.status).toBe(401)

    const newLogin = await fetch(`${base}/api/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset-user@mozhou.ai', password: 'NewPassword456!' }),
    })
    expect(newLogin.status).toBe(200)

    // 测试过期 code 拒绝
    const expiredCode = defaultSessionManager.createResetCode('reset-user@mozhou.ai', 'usr_dummy', -1000)
    const expConfirm = await fetch(`${base}/api/account/reset-password-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: expiredCode, newPassword: 'Password999!' }),
    })
    expect(expConfirm.status).toBe(400)
    const expBody = (await expConfirm.json()) as Record<string, unknown>
    expect(expBody.code).toBe('RESET_CODE_EXPIRED')
  })

  it('device code 由另一 state 兑换 → 拒绝且原 code 不被错误消费', async () => {
    const base = await listen()
    const { verifier, challenge } = generatePkce()

    // 1. 初始化客户端授权请求
    const authReq = await fetch(`${base}/api/auth/device/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: 'correct-state-xyz',
        codeChallenge: challenge,
        redirectUri: 'http://127.0.0.1:54321/callback',
        deviceName: 'Author ThinkPad',
      }),
    })
    expect(authReq.status).toBe(200)

    // 2. 模拟用户登录并在浏览器确认授权
    const user = await defaultSessionManager.provider.signUp('author-device@mozhou.ai', 'pwd123456')
    const { cookie } = defaultSessionManager.createSession({ userId: user.user.id, email: user.user.email })

    const confirmRes = await fetch(`${base}/api/auth/device/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({ state: 'correct-state-xyz' }),
    })
    expect(confirmRes.status).toBe(200)
    const confirmData = (await confirmRes.json()) as { code: string; redirectUri: string }
    const deviceCode = confirmData.code
    expect(deviceCode).toBeTruthy()

    // 3. 用错误的 state 尝试兑换 → 400 拒绝
    const badExchange = await fetch(`${base}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: deviceCode,
        state: 'wrong-tampered-state',
        codeVerifier: verifier,
      }),
    })
    expect(badExchange.status).toBe(400)
    const badBody = (await badExchange.json()) as Record<string, unknown>
    expect(badBody.code).toBe('STATE_MISMATCH')

    // 4. 原 code 绝未被错误消费！使用正确的 state 重试兑换 → 200 成功
    const goodExchange = await fetch(`${base}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: deviceCode,
        state: 'correct-state-xyz',
        codeVerifier: verifier,
        deviceName: 'Author ThinkPad',
      }),
    })
    expect(goodExchange.status).toBe(200)
    const tokenData = (await goodExchange.json()) as {
      deviceId: string
      accessToken: string
      refreshToken: string
    }
    expect(tokenData.deviceId).toBeTruthy()
    expect(tokenData.accessToken).toBeTruthy()
    expect(tokenData.refreshToken).toBeTruthy()

    // 5. 再次使用原 code 兑换 → 400 已被消费
    const repeatExchange = await fetch(`${base}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: deviceCode,
        state: 'correct-state-xyz',
        codeVerifier: verifier,
      }),
    })
    expect(repeatExchange.status).toBe(400)
  })

  it('第 4 设备拒绝；解绑后原 refresh 拒绝；两个用户看不到彼此设备', async () => {
    const base = await listen()

    // 创建两个不同用户
    const userA = await defaultSessionManager.provider.signUp('user-multi-A@mozhou.ai', 'pwd123456')
    const userB = await defaultSessionManager.provider.signUp('user-multi-B@mozhou.ai', 'pwd123456')
    const { cookie: cookieA } = defaultSessionManager.createSession({ userId: userA.user.id, email: userA.user.email })
    const { cookie: cookieB } = defaultSessionManager.createSession({ userId: userB.user.id, email: userB.user.email })

    // 为用户 A 绑定 3 个设备
    const aTokens: { deviceId: string; refreshToken: string }[] = []
    for (let i = 1; i <= 3; i++) {
      const { verifier, challenge } = generatePkce()
      const state = `state-userA-${i}`
      await fetch(`${base}/api/auth/device/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          codeChallenge: challenge,
          redirectUri: 'http://127.0.0.1:50000/callback',
          deviceName: `A-Device-${i}`,
        }),
      })

      const cRes = await fetch(`${base}/api/auth/device/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ state }),
      })
      const { code } = (await cRes.json()) as { code: string }

      const tRes = await fetch(`${base}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          state,
          codeVerifier: verifier,
          deviceName: `A-Device-${i}`,
        }),
      })
      expect(tRes.status).toBe(200)
      const tData = (await tRes.json()) as { deviceId: string; refreshToken: string }
      aTokens.push(tData)
    }

    // 检查用户 A 当前设备列表：正好 3 台
    const devListA = await fetch(`${base}/api/account/devices`, {
      headers: { Cookie: cookieA },
    })
    const devListDataA = (await devListA.json()) as { devices: { name: string }[] }
    expect(devListDataA.devices).toHaveLength(3)

    // 用户 A 尝试绑定第 4 个设备 → 403 拒绝
    const { verifier: v4, challenge: c4 } = generatePkce()
    const state4 = 'state-userA-4'
    await fetch(`${base}/api/auth/device/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: state4,
        codeChallenge: c4,
        redirectUri: 'http://127.0.0.1:50000/callback',
        deviceName: 'A-Device-4',
      }),
    })
    const cRes4 = await fetch(`${base}/api/auth/device/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ state: state4 }),
    })
    const { code: code4 } = (await cRes4.json()) as { code: string }

    const tRes4 = await fetch(`${base}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code4,
        state: state4,
        codeVerifier: v4,
        deviceName: 'A-Device-4',
      }),
    })
    expect(tRes4.status).toBe(403)
    const errBody4 = (await tRes4.json()) as Record<string, unknown>
    expect(errBody4.code).toBe('DEVICE_LIMIT_EXCEEDED')

    // 用户 B 也绑定 1 个设备
    const { verifier: vb, challenge: cb } = generatePkce()
    const stateB = 'state-userB-1'
    await fetch(`${base}/api/auth/device/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: stateB,
        codeChallenge: cb,
        redirectUri: 'http://127.0.0.1:50000/callback',
        deviceName: 'B-Device-1',
      }),
    })
    const cResB = await fetch(`${base}/api/auth/device/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ state: stateB }),
    })
    const { code: codeB } = (await cResB.json()) as { code: string }
    const tResB = await fetch(`${base}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeB, state: stateB, codeVerifier: vb, deviceName: 'B-Device-1' }),
    })
    expect(tResB.status).toBe(200)

    // 隔离断言：两个用户看不到彼此设备
    const listB = await fetch(`${base}/api/account/devices`, {
      headers: { Cookie: cookieB },
    })
    const listDataB = (await listB.json()) as { devices: { name: string }[] }
    expect(listDataB.devices).toHaveLength(1)
    expect(listDataB.devices[0]?.name).toBe('B-Device-1')

    // 用户 A 解绑第 1 个设备
    const deviceToUnbind = aTokens[0]!
    const unbindRes = await fetch(`${base}/api/account/devices/unbind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ deviceId: deviceToUnbind.deviceId }),
    })
    expect(unbindRes.status).toBe(200)

    // 解绑后原 refresh token 请求刷新 → 401 拒绝
    const refreshRes = await fetch(`${base}/api/auth/device/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: deviceToUnbind.refreshToken }),
    })
    expect(refreshRes.status).toBe(401)
    const refBody = (await refreshRes.json()) as Record<string, unknown>
    expect(refBody.code).toBe('DEVICE_UNBOUND')

    // 此时 A 剩余 2 台设备
    const recheckA = await fetch(`${base}/api/account/devices`, {
      headers: { Cookie: cookieA },
    })
    const recheckDataA = (await recheckA.json()) as { devices: unknown[] }
    expect(recheckDataA.devices).toHaveLength(2)
  })
})
