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

  it('uses the production Node server rather than Vite preview for distributed runtime', () => {
    const launcher = read('scripts/launcher.mjs')
    const webPackage = JSON.parse(read('apps/web/package.json')) as { scripts?: Record<string, string> }
    const dockerfile = read('Dockerfile')

    expect(webPackage.scripts?.['serve']).toBe('node dist-server/productionServer.js')
    expect(launcher).toContain('dist-server/productionServer.js')
    expect(launcher).not.toContain("'preview'")
    expect(dockerfile).toContain('dist-server/productionServer.js')
    expect(dockerfile).toContain('USER node')
  })

  it('publishes only truthful generic runtime/web/docker assets', () => {
    const script = read('scripts/build-release.mjs')
    expect(script).toContain('-local-runtime.tar.gz')
    expect(script).toContain('-web-dist.tar.gz')
    expect(script).toContain('-docker.tar.gz')
    expect(script).not.toContain('-windows-x64.tar.gz')
    expect(script).not.toContain('-darwin-universal.tar.gz')
    expect(script).not.toContain('Windows 绿色免安装包')
    expect(script).not.toContain('macOS 通用包')
    expect(script).not.toContain("console.warn('⚠️ 打包命令异常:'")
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

  it('ignores local credentials and signing-key material', () => {
    const ignore = read('.gitignore')
    for (const pattern of ['.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx']) {
      expect(ignore).toContain(pattern)
    }
  })

  it('configures long-term book storage volume and permissions for Docker bundles', () => {
    const buildScript = read('scripts/build-release.mjs')
    expect(buildScript).toContain('MOZHOU_LIBRARY_DIR: /data/books')
    expect(buildScript).toContain('mozhou_books:/data/books')
    expect(buildScript).toContain('mkdir -p /data/books && chown -R node:node /data/books')

    const rootCompose = read('docker-compose.yml')
    expect(rootCompose).toContain('MOZHOU_LIBRARY_DIR=/data/books')
    expect(rootCompose).toContain('mozhou_books:/data/books')
    expect(rootCompose).toContain('mozhou_books:')

    const rootDockerfile = read('Dockerfile')
    expect(rootDockerfile).toContain('mkdir -p /data/books && chown -R node:node /data/books')
  })
})
