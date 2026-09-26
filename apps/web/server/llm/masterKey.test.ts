/**
 * BYOK 主密钥解析契约：生产/hosted 不得回退到源码可见常量。
 *
 * 回归防护：此前 `MASTER_KEY` 直接 `?? 'mozhou-default-internal-master-key-2026'`，
 * 且 Dockerfile/compose/systemd 都不设置该变量——于是每个部署的
 * `local-provider-settings.enc` 都能用公开常量 + 固定盐解开，加密等于装饰。
 * 故此处断言的是「缺失即拒绝启动」，而不是「能返回一把密钥」。
 */
import { describe, expect, it } from 'vitest'
import { resolveMasterKey } from './providerSettings.js'

const STRONG = 'a'.repeat(32)

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

  it('production 下提供显式密钥即可通过，且不等于开发回退密钥', () => {
    const dev = resolveMasterKey({}, false)
    const prod = resolveMasterKey({ NODE_ENV: 'production', MOZHOU_SECRET_KEY: STRONG }, false)

    expect(prod).toHaveLength(32)
    expect(prod.equals(dev)).toBe(false)
  })

  it('过短的密钥被拒绝并给出可执行的修复提示', () => {
    expect(() => resolveMasterKey({ MOZHOU_SECRET_KEY: 'short' }, false)).toThrow(/at least 32 characters/)
  })

  it('本地开发（非 production、非 hosted）保留零配置回退', () => {
    expect(resolveMasterKey({}, false)).toHaveLength(32)
  })
})
