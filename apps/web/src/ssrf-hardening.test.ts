// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assertSafeRemoteTarget, resolveChatEndpoint } from '../server/llm/openaiStream'

describe('release hardening · outbound LLM SSRF boundary', () => {
  it('requires HTTPS for configured remote model endpoints', () => {
    expect(() => resolveChatEndpoint({
      MOZHOU_API_KEY: 'test-key',
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
    await expect(assertSafeRemoteTarget(new URL(url), async () => [])).rejects.toThrow(/SSRF/i)
  })

  it('rejects a public hostname when DNS resolves to a private address', async () => {
    await expect(assertSafeRemoteTarget(
      new URL('https://model.example.com'),
      async () => [{ address: '10.2.3.4', family: 4 }],
    )).rejects.toThrow(/SSRF/i)
  })

  it('accepts a public HTTPS hostname when all resolved addresses are public', async () => {
    await expect(assertSafeRemoteTarget(
      new URL('https://model.example.com'),
      async () => [{ address: '203.0.113.10', family: 4 }],
    )).resolves.toBeUndefined()
  })
})
