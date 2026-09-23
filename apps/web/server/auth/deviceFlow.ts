/**
 * apps/web · Windows 桌面设备授权与 PKCE 协议实现 (Device Authorization Flow · T08)。
 * - Windows 端采用系统浏览器完成账号授权，以随机 state + PKCE (S256) 与短期一次性 code 绑定；
 * - 回调仅允许精确的本地回环注册地址（127.0.0.1 / localhost）；
 * - code 消费单次幂等，code 重复/超时/错 state 均严格拒绝；
 * - 错 state 兑换被拒绝时，原 code 绝不被错误消费；
 * - 每用户最多 3 个有效绑定设备，服务端判定；第 4 台拒绝；
 * - 解绑后原 refresh token 立即失效，无法继续刷新票据；
 * - 两个用户严格隔离，无法查看彼此设备。
 */
import { createHash, randomBytes } from 'node:crypto'
import { RequestBoundaryError } from '../security.js'

export interface BoundDevice {
  readonly deviceId: string
  readonly userId: string
  readonly name: string
  readonly boundAt: string
  lastSeenAt: string
  refreshToken: string
  revoked: boolean
}

export interface PendingDeviceAuth {
  readonly state: string
  readonly codeChallenge: string
  readonly codeChallengeMethod: 'S256'
  readonly redirectUri: string
  readonly deviceName: string
  readonly expiresAt: number
}

export interface IssuedDeviceCode {
  readonly code: string
  readonly state: string
  readonly codeChallenge: string
  readonly userId: string
  readonly deviceName: string
  readonly expiresAt: number
  consumed: boolean
}

export interface DeviceTokenResult {
  readonly deviceId: string
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresIn: number
  readonly user: { readonly id: string }
}

export const MAX_DEVICES_PER_USER = 3
export const DEVICE_AUTH_TTL_MS = 5 * 60 * 1000 // 5 分钟
export const DEVICE_CODE_TTL_MS = 60 * 1000 // 60 秒一次性授权码
export const DEVICE_ACCESS_TOKEN_TTL_SEC = 24 * 3600

function base64UrlSha256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function isLoopbackRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

export class DeviceFlowManager {
  private readonly _pendingAuth = new Map<string, PendingDeviceAuth>() // state -> pending
  private readonly _issuedCodes = new Map<string, IssuedDeviceCode>() // code -> issued
  private readonly _devices = new Map<string, BoundDevice>() // deviceId -> device
  private readonly _deviceRefreshTokens = new Map<string, string>() // refreshToken -> deviceId

  createAuthorizationRequest(params: {
    readonly state: string
    readonly codeChallenge: string
    readonly codeChallengeMethod?: string | undefined
    readonly redirectUri: string
    readonly deviceName?: string | undefined
  }): PendingDeviceAuth {
    if (!params.state || typeof params.state !== 'string') {
      throw new RequestBoundaryError(400, 'INVALID_STATE', 'state parameter is required')
    }
    if (!params.codeChallenge || typeof params.codeChallenge !== 'string') {
      throw new RequestBoundaryError(400, 'INVALID_CODE_CHALLENGE', 'code_challenge is required')
    }
    const method = params.codeChallengeMethod ?? 'S256'
    if (method !== 'S256') {
      throw new RequestBoundaryError(400, 'UNSUPPORTED_CHALLENGE_METHOD', 'only S256 code_challenge_method is supported')
    }
    if (!isLoopbackRedirectUri(params.redirectUri)) {
      throw new RequestBoundaryError(400, 'INVALID_REDIRECT_URI', 'redirect_uri must resolve to loopback (127.0.0.1 or localhost)')
    }

    const pending: PendingDeviceAuth = {
      state: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      redirectUri: params.redirectUri,
      deviceName: params.deviceName ?? 'Windows Desktop',
      expiresAt: Date.now() + DEVICE_AUTH_TTL_MS,
    }
    this._pendingAuth.set(params.state, pending)
    return pending
  }

  authorize(state: string, userId: string): { readonly code: string; readonly redirectUri: string } {
    const pending = this._pendingAuth.get(state)
    if (!pending) {
      throw new RequestBoundaryError(400, 'INVALID_OR_EXPIRED_STATE', 'device authorization state not found')
    }
    if (Date.now() > pending.expiresAt) {
      this._pendingAuth.delete(state)
      throw new RequestBoundaryError(400, 'STATE_EXPIRED', 'device authorization state has expired')
    }

    const code = 'dvc_' + randomBytes(24).toString('hex')
    const issued: IssuedDeviceCode = {
      code,
      state: pending.state,
      codeChallenge: pending.codeChallenge,
      userId,
      deviceName: pending.deviceName,
      expiresAt: Date.now() + DEVICE_CODE_TTL_MS,
      consumed: false,
    }
    this._issuedCodes.set(code, issued)
    this._pendingAuth.delete(state)

    const sep = pending.redirectUri.includes('?') ? '&' : '?'
    const redirectUri = `${pending.redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    return { code, redirectUri }
  }

  exchangeCode(params: {
    readonly code: string
    readonly state: string
    readonly codeVerifier: string
    readonly deviceName?: string | undefined
  }): DeviceTokenResult {
    const issued = this._issuedCodes.get(params.code)
    if (!issued) {
      throw new RequestBoundaryError(400, 'INVALID_DEVICE_CODE', 'authorization code is invalid or not found')
    }
    if (issued.consumed) {
      throw new RequestBoundaryError(400, 'CODE_ALREADY_USED', 'authorization code has already been consumed')
    }
    if (Date.now() > issued.expiresAt) {
      this._issuedCodes.delete(params.code)
      throw new RequestBoundaryError(400, 'CODE_EXPIRED', 'authorization code has expired')
    }

    // 关键校验：若 state 不匹配，严格拒绝且绝不把原 code 标记为已消费！
    if (params.state !== issued.state) {
      throw new RequestBoundaryError(400, 'STATE_MISMATCH', 'authorization state does not match code')
    }

    // PKCE S256 校验
    const computedChallenge = base64UrlSha256(params.codeVerifier)
    if (computedChallenge !== issued.codeChallenge) {
      throw new RequestBoundaryError(400, 'INVALID_CODE_VERIFIER', 'PKCE code_verifier verification failed')
    }

    // 检查该用户当前已绑定的有效设备总数
    const userActiveDevices = [...this._devices.values()].filter(
      (d) => d.userId === issued.userId && !d.revoked,
    )
    if (userActiveDevices.length >= MAX_DEVICES_PER_USER) {
      // 超额绑定直接拒绝（第 4 设备拒绝）
      throw new RequestBoundaryError(
        403,
        'DEVICE_LIMIT_EXCEEDED',
        `maximum ${MAX_DEVICES_PER_USER} active devices allowed. Please unbind an old device first.`,
      )
    }

    // 校验全部通过，立即置为已消费（单次使用）
    issued.consumed = true

    const deviceId = 'dev_' + randomBytes(16).toString('hex')
    const accessToken = 'dva_' + randomBytes(24).toString('hex')
    const refreshToken = 'dvr_' + randomBytes(32).toString('hex')
    const now = new Date().toISOString()

    const device: BoundDevice = {
      deviceId,
      userId: issued.userId,
      name: params.deviceName || issued.deviceName,
      boundAt: now,
      lastSeenAt: now,
      refreshToken,
      revoked: false,
    }

    this._devices.set(deviceId, device)
    this._deviceRefreshTokens.set(refreshToken, deviceId)

    return {
      deviceId,
      accessToken,
      refreshToken,
      expiresIn: DEVICE_ACCESS_TOKEN_TTL_SEC,
      user: { id: issued.userId },
    }
  }

  refreshDeviceToken(refreshToken: string): { readonly accessToken: string; readonly refreshToken: string } {
    const deviceId = this._deviceRefreshTokens.get(refreshToken)
    if (!deviceId) {
      throw new RequestBoundaryError(401, 'INVALID_REFRESH_TOKEN', 'invalid or expired device refresh token')
    }
    const device = this._devices.get(deviceId)
    if (!device || device.revoked) {
      this._deviceRefreshTokens.delete(refreshToken)
      throw new RequestBoundaryError(401, 'DEVICE_UNBOUND', 'device has been unbound; cannot refresh token')
    }

    // 刷新成功，轮转 refresh token
    this._deviceRefreshTokens.delete(refreshToken)
    const newRefresh = 'dvr_' + randomBytes(32).toString('hex')
    const newAccess = 'dva_' + randomBytes(24).toString('hex')
    device.refreshToken = newRefresh
    device.lastSeenAt = new Date().toISOString()
    this._deviceRefreshTokens.set(newRefresh, deviceId)

    return { accessToken: newAccess, refreshToken: newRefresh }
  }

  unbindDevice(userId: string, deviceId: string): void {
    const device = this._devices.get(deviceId)
    if (!device || device.userId !== userId) {
      throw new RequestBoundaryError(404, 'DEVICE_NOT_FOUND', 'device not found')
    }
    device.revoked = true
  }

  listDevices(userId: string): readonly { readonly deviceId: string; readonly name: string; readonly boundAt: string; readonly lastSeenAt: string }[] {
    return [...this._devices.values()]
      .filter((d) => d.userId === userId && !d.revoked)
      .map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        boundAt: d.boundAt,
        lastSeenAt: d.lastSeenAt,
      }))
  }

  getDeviceById(deviceId: string): BoundDevice | null {
    const d = this._devices.get(deviceId)
    if (!d || d.revoked) return null
    return d
  }

  clear(): void {
    this._pendingAuth.clear()
    this._issuedCodes.clear()
    this._devices.clear()
    this._deviceRefreshTokens.clear()
  }
}

export const defaultDeviceFlowManager = new DeviceFlowManager()
