// @vitest-environment node
/**
 * BYOK 凭据「旧主密钥文件在新主密钥下读取」的行为契约。
 *
 * 背景：B7 把本地主密钥从源码常量改为数据根的 installation.key（CSPRNG 铸造）。
 * 升级前用旧常量加密的 provider-settings.enc 在新主密钥下解不开；修复前 getSettings
 * 把解密失败折成 null，用户看到的是「从没配过」——同一个 Key 明明还在文件里。
 *
 * 本文件断言两条路径：
 * 1) 无旧密钥可用：原文件复制为 .bak（绝不删除），并抛出可操作错误（非静默）；
 * 2) 操作员经 MOZHOU_LEGACY_SECRET_KEY 提供旧密钥：一次性重加密为当前主密钥。
 * 夹具密钥一律用构造字符串、文件用同算法现场生成——测试里没有任何可用凭据字面量。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultBookAccessManager } from '../bookAccess.js'
import {
  ProviderCredentialsUnreadableError,
  defaultProviderSettingsManager,
} from './providerSettings.js'

const MANAGER = defaultProviderSettingsManager
const ALGORITHM = 'aes-256-gcm'
const SALT = 'mozhou-salt-fixed' // 与实现同盐；盐是公开参数，不是凭据
const CURRENT_SECRET = ['mozhou', 'test', 'current', 'master', 'secret'].join('-')
const LEGACY_SECRET = ['mozhou', 'test', 'legacy', 'master', 'secret'].join('-')
const WRONG_LEGACY = ['mozhou', 'test', 'wrong', 'legacy', 'secret'].join('-')

let tempDir = ''
let previousRoot = ''
let savedEnv: Record<string, string | undefined> = {}

/** 按生产格式用指定主密钥加密，构造「旧密钥写出的 .enc」夹具。 */
function encryptFixture(secret: string, plaintext: string): string {
  const key = scryptSync(secret, SALT, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

function settingsPath(): string {
  return join(tempDir, 'local-provider-settings.enc')
}

const CONFIG = {
  providerId: 'custom',
  baseUrl: 'https://api.deepseek.com',
  apiKey: ['stored', 'key', 'fixture'].join('-'),
  model: 'deepseek-chat',
  configVersion: 3,
  updatedAt: '2026-10-01T00:00:00.000Z',
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mozhou-cred-'))
  previousRoot = defaultBookAccessManager.getDataRoot()
  defaultBookAccessManager.setDataRoot(tempDir)
  savedEnv = {
    MOZHOU_SECRET_KEY: process.env['MOZHOU_SECRET_KEY'],
    MOZHOU_LEGACY_SECRET_KEY: process.env['MOZHOU_LEGACY_SECRET_KEY'],
    MOZHOU_HOSTED: process.env['MOZHOU_HOSTED'],
  }
  process.env['MOZHOU_SECRET_KEY'] = CURRENT_SECRET
  delete process.env['MOZHOU_LEGACY_SECRET_KEY']
  delete process.env['MOZHOU_HOSTED']
})

afterEach(() => {
  defaultBookAccessManager.setDataRoot(previousRoot)
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(tempDir, { recursive: true, force: true })
})

describe('旧主密钥文件在新主密钥下读取 · 不静默', () => {
  it('解不开且无旧密钥 ⇒ 备份为 .bak 并抛明确错误（绝不删除原文件）', () => {
    const original = encryptFixture(LEGACY_SECRET, JSON.stringify(CONFIG))
    writeFileSync(settingsPath(), original)

    let thrown: unknown
    try {
      MANAGER.getSettings()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ProviderCredentialsUnreadableError)
    const err = thrown as ProviderCredentialsUnreadableError
    expect(err.code).toBe('PROVIDER_CREDENTIALS_UNREADABLE')
    expect(err.backupPath).toBe(settingsPath() + '.bak')
    expect(err.message).toContain('重新输入 API Key')

    // 数据保护：原文件仍在，且内容与备份逐字节一致
    expect(existsSync(settingsPath())).toBe(true)
    expect(readFileSync(settingsPath(), 'utf8')).toBe(original)
    expect(err.backupPath).not.toBeNull()
    expect(readFileSync(err.backupPath as string, 'utf8')).toBe(original)
  })

  it('getMaskedSettings 同样不静默：上抛错误而不是回 configured=false', () => {
    writeFileSync(settingsPath(), encryptFixture(LEGACY_SECRET, JSON.stringify(CONFIG)))
    expect(() => MANAGER.getMaskedSettings(undefined, {})).toThrow(ProviderCredentialsUnreadableError)
  })

  it('提供 MOZHOU_LEGACY_SECRET_KEY ⇒ 一次性迁移，重加密后清掉旧密钥仍可读', () => {
    writeFileSync(settingsPath(), encryptFixture(LEGACY_SECRET, JSON.stringify(CONFIG)))
    process.env['MOZHOU_LEGACY_SECRET_KEY'] = LEGACY_SECRET

    const migrated = MANAGER.getSettings()
    expect(migrated?.apiKey).toBe(CONFIG.apiKey)
    expect(migrated?.configVersion).toBe(CONFIG.configVersion)

    // 迁移后文件已被当前主密钥重加密：移除旧密钥仍能读
    delete process.env['MOZHOU_LEGACY_SECRET_KEY']
    expect(MANAGER.getSettings()?.apiKey).toBe(CONFIG.apiKey)
  })

  it('旧密钥不对（迁移失败）⇒ 仍备份并抛错，不误判为已迁移', () => {
    writeFileSync(settingsPath(), encryptFixture(LEGACY_SECRET, JSON.stringify(CONFIG)))
    process.env['MOZHOU_LEGACY_SECRET_KEY'] = WRONG_LEGACY

    expect(() => MANAGER.getSettings()).toThrow(ProviderCredentialsUnreadableError)
    expect(existsSync(settingsPath() + '.bak')).toBe(true)
    expect(existsSync(settingsPath())).toBe(true) // 原文件未被删除或破坏
  })

  it('saveSettings 可从不可读状态恢复：旧文件坏掉不阻止保存新 Key', () => {
    writeFileSync(settingsPath(), encryptFixture(LEGACY_SECRET, JSON.stringify(CONFIG)))

    const saved = MANAGER.saveSettings({ apiKey: ['fresh', 'key', 'fixture'].join('-') })
    expect(saved.configVersion).toBe(1)
    expect(MANAGER.getSettings()?.apiKey).toBe(['fresh', 'key', 'fixture'].join('-'))
  })

  it('没有文件时仍返回 null（确实没配过，不是错误）', () => {
    expect(MANAGER.getSettings()).toBeNull()
  })
})

/**
 * 读文件本身失败（B7 修复的残余）：修复前 getSettings 直接 readFileSync，
 * 文件读不出来（目录占位/权限/被占用）时裸错误冒泡成 500。现改为与「解不开」
 * 一致的显式失败：409 PROVIDER_CREDENTIALS_UNREADABLE，message 带底层 errno。
 *
 * 复现方式：把凭据文件路径用**目录**占位。existsSync 为真（进入读取分支），
 * readFileSync 对目录抛 EISDIR——Windows/macOS/Linux 上均稳定复现，不依赖权限
 * 设置（CI 常以高权限运行，chmod 000 在部分环境不生效）。
 */
describe('凭据文件不可读 · 显式失败而非 500/静默', () => {
  it('目录占位凭据文件路径 ⇒ 抛 409，备份失败如实置 null，消息带底层原因', () => {
    mkdirSync(settingsPath()) // 用目录占住 local-provider-settings.enc

    let thrown: unknown
    try {
      MANAGER.getSettings()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(ProviderCredentialsUnreadableError)
    const err = thrown as ProviderCredentialsUnreadableError
    expect(err.status).toBe(409)
    expect(err.code).toBe('PROVIDER_CREDENTIALS_UNREADABLE')
    // 读都读不出来，无从备份；但绝不删除原路径（这里原「文件」仍是那个目录）
    expect(err.backupPath).toBeNull()
    expect(existsSync(settingsPath())).toBe(true)
    // 消息可操作 + 带上底层 errno，便于定位（EISDIR/EPERM 等因平台而异，只查前缀）
    expect(err.message).toContain('重新输入 API Key')
    expect(err.message).toContain('读取凭据文件失败')
    expect(err.message).toContain('备份失败')
  })

  it('getMaskedSettings 同路径同样上抛（GET /api/llm/settings 得 409，不是 500）', () => {
    mkdirSync(settingsPath())
    expect(() => MANAGER.getMaskedSettings(undefined, {})).toThrow(ProviderCredentialsUnreadableError)
  })

  it('认证标签被截短 ⇒ 视为不可读，不静默返回空配置', () => {
    // 正确主密钥 + 结构合法，只把 16 字节 tag 截成 8 字节：
    // 若解密端不钉死 authTagLength，这会成为「短标签也算认证通过」的入口。
    const valid = encryptFixture(CURRENT_SECRET, JSON.stringify(CONFIG))
    const [ivHex, tagHex, dataHex] = valid.split(':')
    writeFileSync(settingsPath(), `${ivHex}:${(tagHex ?? '').slice(0, 16)}:${dataHex}`)

    expect(() => MANAGER.getSettings()).toThrow(ProviderCredentialsUnreadableError)
  })
})
