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
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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

function encryptWith(key: Buffer, text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

function encrypt(text: string): string {
  return encryptWith(masterKey(), text)
}

/**
 * 用指定主密钥解密。结构、认证标签或填充任一失败都返回 null；调用方据此决定是
 * 「备份 + 报错」还是「试旧密钥迁移」。不再把失败折成空串——那正是静默的根。
 */
function decryptWith(key: Buffer, cipherText: string): string | null {
  const parts = cipherText.split(':')
  if (parts.length !== 3) return null
  const [ivHex = '', tagHex = '', dataHex = ''] = parts
  try {
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(dataHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return null
  }
}

function decrypt(cipherText: string): string | null {
  return decryptWith(masterKey(), cipherText)
}

/** 解析已解密的配置 JSON；非对象或缺 apiKey 一律视同「不可读」，交由上层处置。 */
function parseUserConfig(plaintext: string): UserProviderConfig | null {
  try {
    const parsed = JSON.parse(plaintext) as Partial<UserProviderConfig> | null
    if (parsed === null || typeof parsed !== 'object') return null
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey === '') return null
    return parsed as UserProviderConfig
  } catch {
    return null
  }
}

/**
 * 把无法解密的凭据文件复制为 `<path>.bak` 并返回备份路径；**绝不删除**原文件。
 * 数据保护优先：文件里可能仍是用户唯一的 Key 副本（只是解不开），删了就真没了。
 * 备份本身失败（目标不可写、磁盘满）返回 null——上层仍抛显式错误，绝不把备份失败
 * 升级成未捕获的 500，也绝不因备份失败去动原文件。
 */
function backupUnreadableCredentials(path: string, bytes: Buffer): string | null {
  const backupPath = `${path}.bak`
  try {
    // 备份也走原子写：要么完整存在、要么不存在——半份 .bak 比没有备份更危险
    // （用户会以为凭据已保住，实际拿到的是截断文件）。
    atomicWriteFileSync(backupPath, bytes)
    return backupPath
  } catch {
    return null
  }
}

/**
 * 读文件本身失败时的**尽力**备份：用 copyFileSync，不经 JS 把内容读进来。
 * 多数读失败（EISDIR/EACCES/EBUSY）下复制同样失败，返回 null；能成则返回路径。
 * 无论成败都不删除原文件。
 */
function backupUnreadableCredentialsByCopy(path: string): string | null {
  const backupPath = `${path}.bak`
  try {
    copyFileSync(path, backupPath)
    return backupPath
  } catch {
    return null
  }
}

/** 读失败的可读归因：带上 errno code（EISDIR/EACCES/EBUSY…），供错误消息与日志定位。 */
function describeReadFailure(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  const message = err instanceof Error ? err.message : String(err)
  return code === undefined || code === ''
    ? `读取凭据文件失败：${message}`
    : `读取凭据文件失败（${code}）：${message}`
}

/**
 * 迁移期一次性路径：把旧主密钥加密的凭据重加密为当前主密钥。
 *
 * 旧版本用源码常量作为主密钥加密 provider-settings.enc；该常量已在 B7 从源码移除，
 * 绝不写回源码——写回等于把「任何读到 .enc 的人都能用公开常量解开」的漏洞重新引入。
 * 因此这里只接受操作员通过环境变量 MOZHOU_LEGACY_SECRET_KEY 显式提供的旧密钥：
 * 解得开就用当前主密钥重加密并原子落盘（内容以更强密钥保留，不是删除用户文件）；
 * 解不开返回 null，交给上层走「备份 + 明确报错」。
 *
 * 移除条件：升级窗口结束后（不再有旧版本写出的 .enc），连同 MOZHOU_LEGACY_SECRET_KEY
 * 的读取一起删除本函数。风险：设置该变量期间它出现在进程环境里，同机同权限的进程可读；
 * 迁移完成后应立即从环境中移除。
 */
function migrateLegacyCredentials(path: string, cipherText: string): UserProviderConfig | null {
  const legacy = process.env['MOZHOU_LEGACY_SECRET_KEY']?.trim()
  if (legacy === undefined || legacy === '') return null
  const plaintext = decryptWith(scryptSync(legacy, MASTER_KEY_SALT, 32), cipherText)
  if (plaintext === null) return null
  const config = parseUserConfig(plaintext)
  if (config === null) return null
  atomicWriteFileSync(path, encryptWith(masterKey(), plaintext))
  return config
}

export function maskApiKey(key: string): string {
  if (!key || key.trim().length === 0) return ''
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '****'
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`
}

/**
 * 「已保存的凭据无法读取或无法用当前主密钥解密」的显式错误。
 *
 * 触发场景：
 * - 升级前用旧源码常量加密的 provider-settings.enc，升级后主密钥改为
 *   installation.key（B7），旧文件解不开；
 * - 凭据文件损坏、被占用、无读取权限，或该路径被目录占位（读文件本身即抛错）。
 *
 * 修复前 getSettings 把解密失败折成 null，用户看到的是「从没配过」——同一个 Key
 * 明明还在文件里；读文件失败更直接冒泡成 500。现在两条路径统一走这里。
 *
 * 数据保护：能备份就把原文件复制为 `<path>.bak`（绝不删除）；不能备份时 backupPath
 * 为 null，message 里说明原因（底层 errno 见 detail）。code 供调用方/日志识别，
 * message 直接告诉用户下一步（重新输入 API Key）。
 */
export class ProviderCredentialsUnreadableError extends RequestBoundaryError {
  /** 备份文件路径；备份失败时为 null（原文件在任何情况下都不删除）。 */
  readonly backupPath: string | null
  constructor(backupPath: string | null, detail?: string) {
    const backupNote =
      backupPath === null
        ? '原文件未删除，但备份失败（见底层原因）。'
        : `原文件未删除，已备份到 ${backupPath}。`
    super(
      409,
      'PROVIDER_CREDENTIALS_UNREADABLE',
      '已保存的模型凭据无法读取或解密（升级后主密钥变更、installation.key 被替换、' +
        '文件损坏、无读取权限或被占用）。' +
        `${backupNote}请到「模型设置」重新输入 API Key 恢复使用。` +
        (detail === undefined ? '' : `底层原因：${detail}`),
    )
    this.name = 'ProviderCredentialsUnreadableError'
    this.backupPath = backupPath
  }
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

  /**
   * 读取并解密本机/本用户的凭据。文件不存在返回 null（确实没配过）。
   *
   * 显式失败（绝不静默 null、也绝不冒泡成 500）：
   * - 文件存在但**读不出来**（损坏、权限、被占用、路径被目录占位）：先尽力备份，
   *   再抛 ProviderCredentialsUnreadableError，message 带上底层 errno；
   * - 文件读得到但**解不开**（升级后主密钥变更、installation.key 被替换、文件损坏）：
   *   先尝试迁移期旧密钥重加密；不行就把原文件备份为 .bak 并抛同一错误。
   * 两条路径都绝不删除用户文件，让调用方/界面给出「重新输入 API Key」的恢复动作。
   */
  getSettings(userId?: string): UserProviderConfig | null {
    const path = this.getSettingsPath(userId)
    if (!existsSync(path)) return null

    let bytes: Buffer
    try {
      bytes = readFileSync(path)
    } catch (err) {
      // 读文件本身失败：与「解不开」走同一条显式错误路径。能备份就备份（copy 不经 JS 读入），
      // 不能备份时 backupPath=null 并把底层原因写进 message。
      throw new ProviderCredentialsUnreadableError(
        backupUnreadableCredentialsByCopy(path),
        describeReadFailure(err),
      )
    }

    const cipherText = bytes.toString('utf8').trim()
    const plaintext = decrypt(cipherText)
    if (plaintext !== null) {
      const config = parseUserConfig(plaintext)
      if (config !== null) return config
    }

    // 1) 迁移期：操作员显式给出旧主密钥时，尝试一次性重加密。
    const migrated = migrateLegacyCredentials(path, cipherText)
    if (migrated !== null) return migrated

    // 2) 解不开：先备份原文件（绝不删除），再抛出可操作错误。
    throw new ProviderCredentialsUnreadableError(backupUnreadableCredentials(path, bytes))
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

    let existing: UserProviderConfig | null
    try {
      existing = this.getSettings(userId)
    } catch (err) {
      // 旧文件解不开：原文件已备份为 .bak。继续以「无既有配置」保存新 Key——这正是
      // 用户从不可读状态恢复的路径，不能因为旧文件坏掉就拒绝写入。
      if (!(err instanceof ProviderCredentialsUnreadableError)) throw err
      existing = null
    }
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
