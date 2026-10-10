/**
 * BYOK 主密钥解析契约：生产/hosted 不得回退到源码可见常量；本地单机密钥取自
 * 数据根的 installation.key（首次用 CSPRNG 铸造），源码里没有任何可用凭据字面量。
 *
 * 回归防护：此前主密钥直接 `?? '<硬编码常量>'`，
 * 且 Dockerfile/compose/systemd 都不设置该变量——于是每个部署的
 * `local-provider-settings.enc` 都能用公开常量 + 固定盐解开，加密等于装饰。
 * 故此处断言的是「缺失即拒绝启动」（生产/hosted），以及「本地密钥取自随机密钥文件、
 * 而非固定常量」。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMasterKey } from './providerSettings.js'

const STRONG = 'a'.repeat(32)

const tempDirs: string[] = []
function tempKeyPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-masterkey-'))
  tempDirs.push(dir)
  return join(dir, 'installation.key')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveMasterKey · 生产与 hosted 强制显式密钥', () => {
  it('显式密钥生效且确定：同密钥同结果，异密钥异结果', () => {
    const a = resolveMasterKey({ MOZHOU_SECRET_KEY: STRONG }, false)
    const b = resolveMasterKey({ MOZHOU_SECRET_KEY: STRONG }, false)
    const c = resolveMasterKey({ MOZHOU_SECRET_KEY: 'b'.repeat(32) }, false)

    expect(a).toHaveLength(32)
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })

  it('NODE_ENV=production 且无密钥 ⇒ 抛错，不回退', () => {
    expect(() => resolveMasterKey({ NODE_ENV: 'production' }, false)).toThrow(/MOZHOU_SECRET_KEY is required/)
  })

  it('hosted 模式且无密钥 ⇒ 抛错（即便 NODE_ENV 未设）', () => {
    expect(() => resolveMasterKey({}, true)).toThrow(/MOZHOU_SECRET_KEY is required/)
  })

  it('空白密钥等同于未设置，production 下仍抛错', () => {
    expect(() => resolveMasterKey({ NODE_ENV: 'production', MOZHOU_SECRET_KEY: '   ' }, false)).toThrow(
      /MOZHOU_SECRET_KEY is required/,
    )
  })

  it('production 下提供显式密钥即可通过，且不等于本地密钥文件派生的密钥', () => {
    const dev = resolveMasterKey({}, false, tempKeyPath())
    const prod = resolveMasterKey({ NODE_ENV: 'production', MOZHOU_SECRET_KEY: STRONG }, false)

    expect(prod).toHaveLength(32)
    expect(prod.equals(dev)).toBe(false)
  })

  it('过短的密钥被拒绝并给出可执行的修复提示', () => {
    expect(() => resolveMasterKey({ MOZHOU_SECRET_KEY: 'short' }, false)).toThrow(/at least 32 characters/)
  })
})

describe('resolveMasterKey · 本地零配置密钥来自 installation.key（非源码常量）', () => {
  it('缺失密钥文件时现场铸造 48 字节 CSPRNG 密钥并落盘为 96 位十六进制', () => {
    const keyPath = tempKeyPath()
    const key = resolveMasterKey({}, false, keyPath)

    expect(key).toHaveLength(32)
    expect(readFileSync(keyPath, 'utf8').trim()).toMatch(/^[0-9a-f]{96}$/)
  })

  it('同一密钥文件重复解析得到相同主密钥；不同密钥文件得到不同主密钥', () => {
    const a = tempKeyPath()
    const b = tempKeyPath()

    expect(resolveMasterKey({}, false, a).equals(resolveMasterKey({}, false, a))).toBe(true)
    expect(resolveMasterKey({}, false, a).equals(resolveMasterKey({}, false, b))).toBe(false)
  })

  it('损坏的密钥文件被拒绝，而非静默换新', () => {
    const keyPath = tempKeyPath()
    writeFileSync(keyPath, 'not-a-valid-key')

    expect(() => resolveMasterKey({}, false, keyPath)).toThrow(/已损坏/)
  })
})
