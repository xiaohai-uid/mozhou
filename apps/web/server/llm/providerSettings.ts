/**
 * apps/web/server/llm · 模型端点配置与凭据安全仓储 (Provider Settings · T07)。
 * 
 * 依照 reference/01-core.md T07 规格：
 * - 支持用户级自定义 OpenAI-compatible 端点（BYOK）；
 * - hosted 模式下加密隔离存储每用户凭据，local 模式存后端安全目录，不入 localStorage/书目录；
 * - 提供端点 URL/协议前置校验与 SSRF 阻断；
 * - 响应脱敏：对外只返回掩码 Key（如 sk-****abcd），绝不外泄明文 Key；
 * - 每次配置修改自增 configVersion 并记录修改时间。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { atomicWriteFileSync } from '@mozhou/data-plane'
import { defaultBookAccessManager } from '../bookAccess.js'
import { RequestBoundaryError } from '../security.js'
import type { ResolvedEndpoint } from './types.js'

export interface UserProviderConfig {
  readonly providerId: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly configVersion: number
  readonly updatedAt: string
}

export interface MaskedProviderConfig {
  readonly configured: boolean
  readonly providerId: string
  readonly baseUrl: string
  readonly maskedKey: string
  readonly model: string
  readonly configVersion: number
  readonly updatedAt: string | null
}

/**
 * 进程环境变量 → 端点字段的**唯一**解析处。
 *
 * 为什么必须收口：这段候选变量链此前在 getMaskedSettings 与 resolveEndpointForUser
 * 各写了一份，且 getMaskedSettings 那份**漏了 OPENAI_API_BASE**。后果是只配了
 * OPENAI_* 变量的部署：设置面板把 baseUrl 显示成 https://api.deepseek.com，
 * 而真实请求发往 OPENAI_API_BASE——面板对作者说的和系统做的是两件事。
 * 一条链、一个来源，两种呈现方式共用。
 */
export interface EnvEndpointFields {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export function resolveEnvEndpoint(env: NodeJS.ProcessEnv = process.env): EnvEndpointFields {
  return {
    apiKey: env['MOZHOU_API_KEY'] ?? env['DEEPSEEK_API_KEY'] ?? env['OPENAI_API_KEY'] ?? '',
    baseUrl: env['MOZHOU_API_BASE'] ?? env['DEEPSEEK_API_BASE'] ?? env['OPENAI_API_BASE'] ?? '',
    model: env['MOZHOU_MODEL'] ?? env['DEEPSEEK_MODEL'] ?? 'deepseek-chat',
  }
}

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const MASTER_KEY_SALT = 'mozhou-salt-fixed'
const MIN_SECRET_KEY_LENGTH = 32

/**
 * 本机凭据加密主密钥文件（installation.key）的读取/铸造。
 *
 * 与 scripts/launcher.mjs、scripts/release/windows/desktop-server.mjs 同一套引导：
 * 48 字节 CSPRNG 随机、十六进制 96 字符、0600 权限。文件不存在时用 `wx` 落盘，
 * 因此并发首启只有一个赢家，输家读回赢家写下的同一把钥匙。密钥与加密后的
 * provider-settings.enc 同处数据根，属同一信任边界（文件权限）；它不进源码、不进库。
 */
function loadOrCreateInstallationKey(keyPath: string): string {
  try {
    mkdirSync(dirname(keyPath), { recursive: true })
    writeFileSync(keyPath, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  const key = readFileSync(keyPath, 'utf8').trim()
  if (!/^[0-9a-f]{96}$/.test(key)) {
    throw new Error(
      `凭据加密主密钥文件已损坏: ${keyPath}。请从备份恢复；不要替换它，替换会使既有 BYOK 凭据无法解密。`,
    )
  }
  return key
}

/**
 * 主密钥解析：加密 BYOK 凭据的密钥材料。
 *
 * 生产（NODE_ENV=production）或 hosted 模式下必须显式提供 MOZHOU_SECRET_KEY，
 * 缺失即在服务启动阶段抛错（fail-closed）。本地单机（非 production 且非 hosted）
 * 未显式提供时，改从数据根的 installation.key 读取；文件不存在则用 CSPRNG 现场
 * 生成 48 字节并落盘（0600），此后沿用同一把钥匙。
 *
 * 为什么不再保留源码常量回退：常量一旦入库，任何读到 provider-settings.enc 的人
 * 都能用公开常量 + 固定盐解开，加密形同装饰。改为本机随机密钥后，密钥不在源码里，
 * 且与加密后的凭据同处数据根，属同一信任边界（文件权限）。
 *
 * 求值时机：由 assertMasterKeyConfigured 与首次加解密触发。刻意不在模块加载时求值——
 * `vite build` 会以 NODE_ENV=production 加载本模块，构建机没有也不该有运行期密钥；
 * 模块加载期抛错会把「构建」和「运行」混为一谈，直接卡死发布流水线。
 */
export function resolveMasterKey(
  env: NodeJS.ProcessEnv = process.env,
  hostedMode = false,
  keyFilePath?: string,
): Buffer {
  const secret = env['MOZHOU_SECRET_KEY']?.trim()
  if (secret !== undefined && secret !== '') {
    if (secret.length < MIN_SECRET_KEY_LENGTH) {
      throw new Error(
        `MOZHOU_SECRET_KEY must be at least ${MIN_SECRET_KEY_LENGTH} characters (got ${secret.length}). ` +
          'Generate one with: openssl rand -base64 48',
      )
    }
    return scryptSync(secret, MASTER_KEY_SALT, 32)
  }

  if (env['NODE_ENV'] === 'production' || hostedMode) {
    throw new Error(
      'MOZHOU_SECRET_KEY is required when NODE_ENV=production or MOZHOU_HOSTED=true: ' +
        'refusing to encrypt provider credentials without an explicit key. ' +
        'Generate one with: openssl rand -base64 48',
    )
  }

  const path = keyFilePath ?? resolve(defaultBookAccessManager.getDataRoot(), 'installation.key')
  return scryptSync(loadOrCreateInstallationKey(path), MASTER_KEY_SALT, 32)
}

/**
 * 启动期断言：由服务入口（productionServer）显式调用。
 *
 * 刻意不在模块加载时求值。`vite build` 会以 NODE_ENV=production 加载本模块
 * （构建配置引入了服务端中间件），构建机没有也不该有运行期密钥；模块加载期抛错
 * 会把「构建」和「运行」两件事混为一谈，直接卡死发布流水线。
 * 求值推迟到启动断言与首次加解密，则：构建不受影响，而「生产缺密钥」仍在开始
 * 服务之前被拒绝——不是等到作者第一次保存凭据才暴露。
 */
export function assertMasterKeyConfigured(): void {
  masterKey()
}

let cachedMasterKey: Buffer | null = null

function masterKey(): Buffer {
  cachedMasterKey ??= resolveMasterKey(process.env, defaultBookAccessManager.isHostedMode())
  return cachedMasterKey
}

function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, masterKey(), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

function decrypt(cipherText: string): string {
  const parts = cipherText.split(':')
  if (parts.length !== 3) return ''
  const [ivHex = '', tagHex = '', dataHex = ''] = parts
  try {
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, masterKey(), iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(dataHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return ''
  }
}

export function maskApiKey(key: string): string {
  if (!key || key.trim().length === 0) return ''
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '****'
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`
}

export class ProviderSettingsManager {
  private getSettingsPath(userId?: string): string {
    const dataRoot = defaultBookAccessManager.getDataRoot()
    if (defaultBookAccessManager.isHostedMode() && userId) {
      const userDir = resolve(dataRoot, 'users', userId)
      mkdirSync(userDir, { recursive: true })
      return resolve(userDir, 'provider-settings.enc')
    }
    mkdirSync(dataRoot, { recursive: true })
    return resolve(dataRoot, 'local-provider-settings.enc')
  }

  getSettings(userId?: string): UserProviderConfig | null {
    const path = this.getSettingsPath(userId)
    if (!existsSync(path)) return null
    try {
      const encrypted = readFileSync(path, 'utf8').trim()
      const raw = decrypt(encrypted)
      if (!raw) return null
      return JSON.parse(raw) as UserProviderConfig
    } catch {
      return null
    }
  }

  saveSettings(
    input: {
      readonly providerId?: string | undefined
      readonly baseUrl?: string | undefined
      readonly apiKey: string
      readonly model?: string | undefined
    },
    userId?: string,
  ): UserProviderConfig {
    const apiKey = input.apiKey.trim()
    if (!apiKey) {
      throw new RequestBoundaryError(400, 'INVALID_API_KEY', 'API key must not be empty')
    }

    const baseUrl = input.baseUrl ? input.baseUrl.trim().replace(/\/$/, '') : 'https://api.deepseek.com'
    // 基础 URL 格式合法性校验
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new RequestBoundaryError(400, 'INVALID_URL', `only http/https URLs are permitted, got ${parsed.protocol}`)
      }
      if (defaultBookAccessManager.isHostedMode() && parsed.protocol !== 'https:') {
        throw new RequestBoundaryError(400, 'HTTPS_REQUIRED', 'public model endpoint must use HTTPS')
      }
    } catch (err) {
      if (err instanceof RequestBoundaryError) throw err
      throw new RequestBoundaryError(400, 'INVALID_URL', 'invalid baseUrl format')
    }

    const existing = this.getSettings(userId)
    const configVersion = (existing?.configVersion ?? 0) + 1
    const config: UserProviderConfig = {
      providerId: input.providerId?.trim() || existing?.providerId || 'custom',
      baseUrl,
      apiKey,
      model: input.model?.trim() || existing?.model || 'deepseek-chat',
      configVersion,
      updatedAt: new Date().toISOString(),
    }

    const path = this.getSettingsPath(userId)
    const cipherText = encrypt(JSON.stringify(config))
    // 原子写：凭据文件被截断时 getSettings 会静默返回 null，用户保存的 Key 无声丢失。
    atomicWriteFileSync(path, cipherText)
    return config
  }

  getMaskedSettings(userId?: string, env: NodeJS.ProcessEnv = process.env): MaskedProviderConfig {
    const config = this.getSettings(userId)
    if (!config) {
      // 检查环境变量回退：与 resolveEndpointForUser 共用同一条链（见 resolveEnvEndpoint）
      const { apiKey: envKey, baseUrl: envBase, model: envModel } = resolveEnvEndpoint(env)
      return {
        configured: Boolean(envKey),
        providerId: 'environment',
        baseUrl: envBase || 'https://api.deepseek.com',
        maskedKey: maskApiKey(envKey),
        model: envModel,
        configVersion: 0,
        updatedAt: null,
      }
    }
    return {
      configured: true,
      providerId: config.providerId,
      baseUrl: config.baseUrl,
      maskedKey: maskApiKey(config.apiKey),
      model: config.model,
      configVersion: config.configVersion,
      updatedAt: config.updatedAt,
    }
  }

  resetSettings(userId?: string): void {
    const path = this.getSettingsPath(userId)
    if (existsSync(path)) {
      try { unlinkSync(path) } catch { /* ignore */ }
    }
  }

  resolveEndpointForUser(userId?: string, env: NodeJS.ProcessEnv = process.env): ResolvedEndpoint | null {
    // 1. 优先使用已持久化的用户安全配置
    const userConfig = this.getSettings(userId)
    if (userConfig?.apiKey) {
      return {
        baseUrl: userConfig.baseUrl,
        apiKey: userConfig.apiKey,
        model: userConfig.model,
        allowPrivateNetwork: env['MOZHOU_ALLOW_PRIVATE_LLM'] === '1',
      }
    }

    // 2. 回退到进程环境变量（与 getMaskedSettings 共用同一条链）
    const { apiKey, baseUrl, model } = resolveEnvEndpoint(env)
    if (!apiKey) return null
    return {
      baseUrl,
      apiKey,
      model,
      allowPrivateNetwork: env['MOZHOU_ALLOW_PRIVATE_LLM'] === '1',
    }
  }

  /**
   * 「有没有配好凭据」的单一判据：产品内配置优先，其次进程环境变量。
   *
   * 只回答「配了没有」，**不**做 SSRF/DNS 门——那是 resolveEndpointForUser 的活，
   * 它会抛异常，而能力探针抛异常会打断整条路由。getSettings 也可能抛（getSettingsPath
   * 会 mkdirSync：数据根 EACCES/ENOSPC），就地吞掉折成「未配置」：探针 fail-closed。
   *
   * 调用方（hasDraftProvider 等）此前各自重写一遍候选变量链，已漏过一次。
   */
  hasUsableCredentials(userId?: string, env: NodeJS.ProcessEnv = process.env): boolean {
    try {
      if ((this.getSettings(userId)?.apiKey ?? '') !== '') return true
    } catch {
      // 读配置失败 = 没配好，不是 500
    }
    return resolveEnvEndpoint(env).apiKey !== ''
  }
}

export const defaultProviderSettingsManager = new ProviderSettingsManager()
