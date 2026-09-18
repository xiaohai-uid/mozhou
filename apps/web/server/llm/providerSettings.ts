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
const MASTER_KEY = scryptSync(
  process.env['MOZHOU_SECRET_KEY'] ?? 'mozhou-default-internal-master-key-2026',
  'mozhou-salt-fixed',
  32,
)

function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, MASTER_KEY, iv)
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
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, MASTER_KEY, iv)
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
