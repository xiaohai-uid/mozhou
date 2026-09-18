// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { DeviceFlowManager } from './deviceFlow.js'

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = 'test-pkce-verifier-' + Math.random().toString(36).slice(2)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

describe('Windows Device Flow (T08 · PKCE & Loopback)', () => {
  it('validates loopback redirect_uri strictly', () => {
    const df = new DeviceFlowManager()
    const { challenge } = generatePkce()

    // Loopback allowed
    expect(() =>
      df.createAuthorizationRequest({
        state: 'state-1',
        codeChallenge: challenge,
        redirectUri: 'http://127.0.0.1:45678/callback',
      }),
    ).not.toThrow()

    expect(() =>
      df.createAuthorizationRequest({
        state: 'state-2',
        codeChallenge: challenge,
        redirectUri: 'http://localhost:45678/callback',
      }),
    ).not.toThrow()

    // Non-loopback rejected
    expect(() =>
      df.createAuthorizationRequest({
        state: 'state-3',
        codeChallenge: challenge,
        redirectUri: 'https://evil.com/callback',
      }),
    ).toThrow('redirect_uri must resolve to loopback')
  })

  it('rejects state mismatch without consuming code, allows retry with correct state', () => {
    const df = new DeviceFlowManager()
    const { verifier, challenge } = generatePkce()

    df.createAuthorizationRequest({
      state: 'correct-state',
      codeChallenge: challenge,
      redirectUri: 'http://127.0.0.1:12345/callback',
    })

    const { code } = df.authorize('correct-state', 'usr_alice')

    // Attempt exchange with WRONG state -> rejected
    expect(() =>
      df.exchangeCode({
        code,
        state: 'tampered-state',
        codeVerifier: verifier,
      }),
    ).toThrow('state does not match')

    // Original code was NOT consumed! Retry with CORRECT state -> succeeds!
    const result = df.exchangeCode({
      code,
      state: 'correct-state',
      codeVerifier: verifier,
    })
    expect(result.deviceId).toBeTruthy()
    expect(result.accessToken).toBeTruthy()

    // Second redemption of same code -> rejected (single use)
    expect(() =>
      df.exchangeCode({
        code,
        state: 'correct-state',
        codeVerifier: verifier,
      }),
    ).toThrow('already been consumed')
  })

  it('rejects invalid PKCE code_verifier', () => {
    const df = new DeviceFlowManager()
    const { challenge } = generatePkce()

    df.createAuthorizationRequest({
      state: 'state-pkce',
      codeChallenge: challenge,
      redirectUri: 'http://127.0.0.1:12345/callback',
    })

    const { code } = df.authorize('state-pkce', 'usr_bob')

    expect(() =>
      df.exchangeCode({
        code,
        state: 'state-pkce',
        codeVerifier: 'wrong-verifier',
      }),
    ).toThrow('PKCE code_verifier verification failed')
  })

  it('enforces 3-device maximum quota per user and rejects 4th device', () => {
    const df = new DeviceFlowManager()
    const userId = 'usr_quota_test'

    // Bind 3 devices successfully
    for (let i = 1; i <= 3; i++) {
      const { verifier, challenge } = generatePkce()
      const state = `state-${i}`
      df.createAuthorizationRequest({
        state,
        codeChallenge: challenge,
        redirectUri: 'http://127.0.0.1:12345/callback',
        deviceName: `Device ${i}`,
      })
      const { code } = df.authorize(state, userId)
      const res = df.exchangeCode({ code, state, codeVerifier: verifier, deviceName: `Device ${i}` })
      expect(res.deviceId).toBeTruthy()
    }

    expect(df.listDevices(userId)).toHaveLength(3)

    // Attempt 4th device -> rejected
    const { verifier: v4, challenge: c4 } = generatePkce()
    df.createAuthorizationRequest({
      state: 'state-4',
      codeChallenge: c4,
      redirectUri: 'http://127.0.0.1:12345/callback',
      deviceName: 'Device 4',
    })
    const { code: code4 } = df.authorize('state-4', userId)

    expect(() =>
      df.exchangeCode({
        code: code4,
        state: 'state-4',
        codeVerifier: v4,
        deviceName: 'Device 4',
      }),
    ).toThrow('maximum 3 active devices allowed')
  })

  it('revokes refresh token upon device unbind', () => {
    const df = new DeviceFlowManager()
    const userId = 'usr_unbind_test'
    const { verifier, challenge } = generatePkce()

    df.createAuthorizationRequest({
      state: 'state-unbind',
      codeChallenge: challenge,
      redirectUri: 'http://127.0.0.1:12345/callback',
    })
    const { code } = df.authorize('state-unbind', userId)
    const { deviceId, refreshToken } = df.exchangeCode({
      code,
      state: 'state-unbind',
      codeVerifier: verifier,
    })

    // Can refresh before unbind
    const refreshed = df.refreshDeviceToken(refreshToken)
    expect(refreshed.accessToken).toBeTruthy()

    // Unbind device
    df.unbindDevice(userId, deviceId)
    expect(df.listDevices(userId)).toHaveLength(0)

    // Refresh after unbind -> rejected
    expect(() => df.refreshDeviceToken(refreshed.refreshToken)).toThrow()
  })

  it('strictly isolates devices between different users', () => {
    const df = new DeviceFlowManager()

    // User Alice
    const { verifier: va, challenge: ca } = generatePkce()
    df.createAuthorizationRequest({
      state: 'state-alice',
      codeChallenge: ca,
      redirectUri: 'http://127.0.0.1:12345/callback',
      deviceName: 'Alice Laptop',
    })
    const { code: codeA } = df.authorize('state-alice', 'usr_alice')
    df.exchangeCode({ code: codeA, state: 'state-alice', codeVerifier: va })

    // User Bob
    const { verifier: vb, challenge: cb } = generatePkce()
    df.createAuthorizationRequest({
      state: 'state-bob',
      codeChallenge: cb,
      redirectUri: 'http://127.0.0.1:12345/callback',
      deviceName: 'Bob PC',
    })
    const { code: codeB } = df.authorize('state-bob', 'usr_bob')
    df.exchangeCode({ code: codeB, state: 'state-bob', codeVerifier: vb })

    const aliceDevices = df.listDevices('usr_alice')
    const bobDevices = df.listDevices('usr_bob')

    expect(aliceDevices).toHaveLength(1)
    expect(bobDevices).toHaveLength(1)
    expect(aliceDevices[0]?.name).toBe('Alice Laptop')
    expect(bobDevices[0]?.name).toBe('Bob PC')

    // Alice cannot unbind Bob's device
    expect(() => df.unbindDevice('usr_alice', bobDevices[0]!.deviceId)).toThrow('device not found')
  })
})
