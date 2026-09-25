// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assertSafeRemoteTarget, resolveChatEndpoint } from '../server/llm/openaiStream'

/** 非真实凭据：本用例只验证协议门禁，key 值不参与断言。 */
const OUTBOUND_STUB = 'test-key'

describe('release hardening · outbound LLM SSRF boundary', () => {
  it('requires HTTPS for configured remote model endpoints', () => {
    expect(() => resolveChatEndpoint({
      MOZHOU_API_KEY: OUTBOUND_STUB,
      MOZHOU_API_BASE: 'http://api.example.com',
    })).toThrow(/HTTPS/i)
  })

  it.each([
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://[::1]',
    'https://[fc00::1]',
    'https://[fe80::1]',
    'https://[::ffff:127.0.0.1]',
  ])('rejects private/reserved literal target %s', async (url) => {
    await expect(assertSafeRemoteTarget(new URL(url), () => Promise.resolve([]))).rejects.toThrow(/SSRF/i)
  })

  it('rejects a public hostname when DNS resolves to a private address', async () => {
    await expect(assertSafeRemoteTarget(
      new URL('https://model.example.com'),
      () => Promise.resolve([{ address: '10.2.3.4', family: 4 }]),
    )).rejects.toThrow(/SSRF/i)
  })

  it('accepts a public HTTPS hostname when all resolved addresses are public', async () => {
    await expect(assertSafeRemoteTarget(
      new URL('https://model.example.com'),
      () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
    )).resolves.toBeUndefined()
  })
})
