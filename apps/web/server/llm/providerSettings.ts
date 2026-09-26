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
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
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

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const MASTER_KEY_SALT = 'mozhou-salt-fixed'
const DEV_FALLBACK_SECRET = 'mozhou-default-internal-master-key-2026'
const MIN_SECRET_KEY_LENGTH = 32

/**
 * 主密钥解析：加密 BYOK 凭据的密钥材料。
 *
 * 生产（NODE_ENV=production）或 hosted 模式下必须显式提供 MOZHOU_SECRET_KEY。
 * 回退到源码可见的常量会让每个部署的凭据实际可被解密——文件就在同一数据目录里，
 * 读到它的人用公开常量即可解开；固定盐还使跨实例彩虹攻击可行。
 * 本地单机（非 production 且非 hosted）保留常量回退，以维持零配置启动。
 *
 * 密钥在模块加载时求值：缺失即在服务启动阶段抛出，而不是等到首次写入凭据才暴露。
 */
export function resolveMasterKey(
  env: NodeJS.ProcessEnv = process.env,
  hostedMode = false,
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
        'refusing to encrypt provider credentials with a source-visible default key. ' +
        'Generate one with: openssl rand -base64 48',
    )
  }

  return scryptSync(DEV_FALLBACK_SECRET, MASTER_KEY_SALT, 32)
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
    writeFileSync(path, cipherText, 'utf8')
    return config
  }

  getMaskedSettings(userId?: string): MaskedProviderConfig {
    const config = this.getSettings(userId)
    if (!config) {
      // 检查环境变量回退
      const envKey = process.env['MOZHOU_API_KEY'] ?? process.env['DEEPSEEK_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? ''
      const envBase = process.env['MOZHOU_API_BASE'] ?? process.env['DEEPSEEK_API_BASE'] ?? ''
      const envModel = process.env['MOZHOU_MODEL'] ?? process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat'
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

    // 2. 回退到进程环境变量
    const apiKey = env['MOZHOU_API_KEY'] ?? env['DEEPSEEK_API_KEY'] ?? env['OPENAI_API_KEY'] ?? ''
    if (!apiKey) return null
    const baseUrl = env['MOZHOU_API_BASE'] ?? env['DEEPSEEK_API_BASE'] ?? env['OPENAI_API_BASE'] ?? ''
    const model = env['MOZHOU_MODEL'] ?? env['DEEPSEEK_MODEL'] ?? 'deepseek-chat'
    return {
      baseUrl,
      apiKey,
      model,
      allowPrivateNetwork: env['MOZHOU_ALLOW_PRIVATE_LLM'] === '1',
    }
  }
}

export const defaultProviderSettingsManager = new ProviderSettingsManager()
