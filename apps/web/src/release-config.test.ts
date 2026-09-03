// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../../..')
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')

describe('release hardening · distribution configuration', () => {
  it('binds the standalone launcher to loopback by default', () => {
    const source = read('scripts/launcher.mjs')
    expect(source).toContain("const host = process.env.HOST || '127.0.0.1'")
    expect(source).not.toContain("const host = process.env.HOST || '0.0.0.0'")
  })

  it('does not publish legacy infrastructure ports or fixed development secrets by default', () => {
    const compose = read('docker-compose.yml')
    expect(compose).not.toContain('"11235:11235"')
    expect(compose).not.toContain('"5433:5432"')
    expect(compose).not.toContain('"3001:3000"')
    expect(compose).not.toContain('mozhou_dev')
    expect(compose).not.toContain('local-dev-token')
    expect(compose).not.toContain('mozhou-dev-secret-change-me')
  })

  it('ships Tauri with a non-null CSP', () => {
    const config = JSON.parse(read('src-tauri/tauri.conf.json')) as { app?: { security?: { csp?: unknown } } }
    expect(typeof config.app?.security?.csp).toBe('string')
    expect(config.app?.security?.csp).not.toBe('')
  })
})
