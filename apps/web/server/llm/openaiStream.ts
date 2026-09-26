/**
 * apps/web/server/llm · 真实 LLM 流式代理（OpenAI-compatible / DeepSeek / GLM）。
 *
 * 安全约束：默认只允许 HTTPS 公网端点；同时对字面 IP 与 DNS 解析结果做
 * 私有/环回/链路本地/保留地址校验，并禁止自动跟随重定向，避免 SSRF 绕过。
 * 本机私有 LLM 仅可由部署者显式设置 MOZHOU_ALLOW_PRIVATE_LLM=1 开启。
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { defaultProviderSettingsManager } from './providerSettings.js'
import type { OpenAiStreamChunk, ResolvedEndpoint } from './types.js'
export type { OpenAiStreamChunk, ResolvedEndpoint } from './types.js'

interface LookupAddress {
  readonly address: string
  readonly family: number
}

type LookupAll = (hostname: string) => Promise<readonly LookupAddress[]>

function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/^\[|\]$/g, '')
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a = 0, b = 0] = parts

  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && (b === 0 || b === 168)) return true
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true
  if (a === 203 && b === 0) return true
  if (a >= 224) return true
  return false
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = normalizeAddress(address)
  if (normalized === '::' || normalized === '::1') return true

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1] !== undefined) return isPrivateOrReservedIpv4(mapped[1])

  // URL 解析器会把点分映射形式（::ffff:127.0.0.1）规范化为十六进制（::ffff:7f00:1），
  // 因此嵌入 IPv4 的十六进制形式也必须还原成 v4 再判定（含 ::ffff:0:/96 转换段与 NAT64 段）。
  const hexMapped = normalized.match(/^(?:::ffff:(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hexMapped?.[1] !== undefined && hexMapped[2] !== undefined) {
    const high = Number.parseInt(hexMapped[1], 16)
    const low = Number.parseInt(hexMapped[2], 16)
    const embeddedV4 = `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
    return isPrivateOrReservedIpv4(embeddedV4)
  }

  const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16)
  if (Number.isNaN(firstGroup)) return true
  if ((firstGroup & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((firstGroup & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((firstGroup & 0xff00) === 0xff00) return true // multicast
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8::') return true // documentation
  if (normalized.startsWith('100:')) return true // 100::/64 discard-only (conservative)
  return false
}

function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = normalizeAddress(address)
  const family = isIP(normalized)
  if (family === 4) return isPrivateOrReservedIpv4(normalized)
  if (family === 6) return isPrivateOrReservedIpv6(normalized)
  return true
}

function assertProtocol(target: URL, allowPrivateNetwork: boolean): void {
  if (allowPrivateNetwork) {
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error(`SSRF 门禁：仅允许 http/https 上游，实际为 ${target.protocol}`)
    }
    return
  }
  if (target.protocol !== 'https:') {
    throw new Error('SSRF 门禁：公网模型端点必须使用 HTTPS')
  }
}

/**
 * 出站端点基址的**同步** SSRF 门禁：协议白名单 + 字面 IP / 本机名判定。
 * DNS 解析结果那一半由 `assertSafeRemoteTarget` 在真正发请求前补做（发请求前必过）。
 *
 * 复用点（唯一一处端点校验实现，勿另写一套）：
 *   - BYOK 端点：`resolveChatEndpoint`（本文件下方）调用本函数；
 *   - 配置注册表端点：`llm/tierRouting.ts` 的 `resolveTierEndpoint` 调用本函数；
 *   - 真正出站前：`streamOpenAiChat` / `testConnection` 仍调 `assertSafeRemoteTarget` 兜底。
 * 配置来源（文件）不是可信输入，因此必须走同一门禁；`allowPrivateNetwork` 只能由
 * 部署者环境变量（MOZHOU_ALLOW_PRIVATE_LLM）授权，配置文件本身无权设置。
 */
export function assertSafeEndpointUrl(baseUrl: string, allowPrivateNetwork = false): URL {
  const target = new URL(baseUrl)
  assertProtocol(target, allowPrivateNetwork)
  if (allowPrivateNetwork) return target

  const hostname = normalizeAddress(target.hostname)
  if (isIP(hostname) !== 0 && isPrivateOrReservedAddress(hostname)) {
    throw new Error(`SSRF 门禁：拒绝调用私有/环回/保留地址 ${hostname}`)
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`SSRF 门禁：拒绝调用本地主机名 ${hostname}`)
  }
  return target
}

/**
 * 校验一个真实出站目标。默认 lookup 注入仅用于测试；生产使用 Node DNS。
 * 任何解析结果落入私有/保留地址即整体拒绝（fail closed）。
 */
export async function assertSafeRemoteTarget(
  target: URL,
  lookupAll: LookupAll = async (hostname) => lookup(hostname, { all: true, verbatim: true }),
  allowPrivateNetwork = false,
): Promise<void> {
  assertProtocol(target, allowPrivateNetwork)
  if (allowPrivateNetwork) return

  const hostname = normalizeAddress(target.hostname)
  if (isIP(hostname) !== 0) {
    if (isPrivateOrReservedAddress(hostname)) {
      throw new Error(`SSRF 门禁：拒绝调用私有/环回/保留地址 ${hostname}`)
    }
    return
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`SSRF 门禁：拒绝调用本地主机名 ${hostname}`)
  }

  const addresses = await lookupAll(hostname)
  if (addresses.length === 0) {
    throw new Error(`SSRF 门禁：DNS 未解析出可验证地址 ${hostname}`)
  }
  const blocked = addresses.find((entry) => isPrivateOrReservedAddress(entry.address))
  if (blocked !== undefined) {
    throw new Error(`SSRF 门禁：${hostname} 解析到私有/环回/保留地址 ${blocked.address}`)
  }
}

export function resolveChatEndpoint(env: NodeJS.ProcessEnv = process.env, userId?: string): ResolvedEndpoint | null {
  const userEndpoint = defaultProviderSettingsManager.resolveEndpointForUser(userId, env)
  if (!userEndpoint || !userEndpoint.apiKey) return null

  if (userEndpoint.baseUrl) {
    assertSafeEndpointUrl(userEndpoint.baseUrl, userEndpoint.allowPrivateNetwork === true)
  }
  return userEndpoint
}

/** 把上游给的标量安全转成文本（对象走 JSON，避免 [object Object]）。 */
function scalarText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value) ?? ''
}

/**
 * 发起真实 OpenAI-compatible Chat Completions 流式请求，逐 delta 产出。
 * 仅在已配置真实 Key 且显式非 mock 时调用；网络错误按流式错误语义上抛。
 * externalSignal（C2·T04）：HTTP 请求断开/显式 cancel 从中止到底层 fetch——
 * 取消后的延迟 chunk 不再产出、不继续付费重试。
 */
export async function* streamOpenAiChat(
  endpoint: ResolvedEndpoint,
  prompt: string,
  systemPrompt: string,
  externalSignal?: AbortSignal,
): AsyncGenerator<OpenAiStreamChunk> {
  const base = endpoint.baseUrl || 'https://api.deepseek.com'
  const url = base.replace(/\/$/, '') + '/chat/completions'
  const target = new URL(url)
  await assertSafeRemoteTarget(target, undefined, endpoint.allowPrivateNetwork === true)

  const controller = new AbortController()
  // T07: 180s 总时限与取消信号绑定
  const totalTimeout = setTimeout(() => controller.abort(new Error('REQUEST_TIMEOUT: total timeout 180s exceeded')), 180_000)
  const onExternalAbort = (): void => {
    controller.abort()
  }
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: true,
        temperature: 0.85,
      }),
      signal: controller.signal,
      redirect: 'manual',
    })

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`上游拒绝：为防止 SSRF，墨舟不会自动跟随 HTTP 重定向（${response.status}）`)
    }
    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '')
      throw new Error(`上游 ${response.status}: ${errText.slice(0, 200)}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let lineEnd: number
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd).trim()
        buffer = buffer.slice(lineEnd + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          controller.abort()
          return
        }
        let chunk: {
          choices?: { delta?: { content?: string }; finish_reason?: string }[]
          error?: { message?: unknown; code?: unknown; type?: unknown }
        }
        try {
          chunk = JSON.parse(payload) as typeof chunk
        } catch {
          // 上游 SSE 可能包含心跳/非 JSON 行；忽略单行，不放宽目标地址门禁。
          continue
        }
        // 上游可能把错误塞进 HTTP 200 的 SSE 流（限流/内容拦截等）。若不显式抛出，
        // 表现就是「零 delta 的静默空输出」——调用方无法区分「模型没说话」与
        // 「上游拒绝」。此处必须抛，让失败可诊断。
        if (chunk.error !== undefined && chunk.error !== null) {
          const message = scalarText(chunk.error.message).slice(0, 200) || 'unknown upstream error'
          const rawCode = scalarText(chunk.error.code)
          const code = rawCode.length === 0 ? '' : ` (${rawCode})`
          throw new Error(`上游流内错误${code}: ${message}`)
        }
        const choice = chunk.choices?.[0]
        if (choice) {
          const delta = choice.delta?.content ?? ''
          if (delta) yield { delta, finishReason: choice.finish_reason }
        }
      }
    }
  } finally {
    clearTimeout(totalTimeout)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

export interface TestConnectionResult {
  readonly ok: boolean
  readonly model: string
  readonly latencyMs: number
  readonly error?: string | undefined
}

/**
 * T07 “测试连接”：用一个最小无私密输入请求（max_tokens: 1），回显模型名/延迟/脱敏错误；
 * 真实调用端点而非仅 ping URL。
 */
export async function testConnection(endpoint: ResolvedEndpoint): Promise<TestConnectionResult> {
  const start = Date.now()
  try {
    const base = endpoint.baseUrl || 'https://api.deepseek.com'
    const url = base.replace(/\/$/, '') + '/chat/completions'
    const target = new URL(url)
    await assertSafeRemoteTarget(target, undefined, endpoint.allowPrivateNetwork === true)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('CONNECTION_TIMEOUT: 20s exceeded')), 20_000)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${endpoint.apiKey}`,
        },
        body: JSON.stringify({
          model: endpoint.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: controller.signal,
        redirect: 'manual',
      })

      const latencyMs = Date.now() - start
      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        return {
          ok: false,
          model: endpoint.model,
          latencyMs,
          error: `HTTP ${response.status}: ${errText.slice(0, 150)}`,
        }
      }
      return {
        ok: true,
        model: endpoint.model,
        latencyMs,
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      model: endpoint.model,
      latencyMs,
      error: (err as Error).message.slice(0, 150),
    }
  }
}
