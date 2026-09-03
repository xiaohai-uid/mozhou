/**
 * apps/web/server/llm · 真实 LLM 流式代理（OpenAI-compatible / DeepSeek / GLM）。
 *
 * 安全约束：默认只允许 HTTPS 公网端点；同时对字面 IP 与 DNS 解析结果做
 * 私有/环回/链路本地/保留地址校验，并禁止自动跟随重定向，避免 SSRF 绕过。
 * 本机私有 LLM 仅可由部署者显式设置 MOZHOU_ALLOW_PRIVATE_LLM=1 开启。
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export interface OpenAiStreamChunk {
  readonly delta: string
  readonly finishReason?: string | undefined
}

/** 从 provider 解析出的真实上游端点。 */
export interface ResolvedEndpoint {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly allowPrivateNetwork?: boolean | undefined
}

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

export function resolveChatEndpoint(env: NodeJS.ProcessEnv): ResolvedEndpoint | null {
  const apiKey = env['MOZHOU_API_KEY'] ?? env['DEEPSEEK_API_KEY'] ?? env['OPENAI_API_KEY'] ?? ''
  const baseUrl = env['MOZHOU_API_BASE'] ?? env['DEEPSEEK_API_BASE'] ?? env['OPENAI_API_BASE'] ?? ''
  const model = env['MOZHOU_MODEL'] ?? env['DEEPSEEK_MODEL'] ?? 'deepseek-chat'
  const allowPrivateNetwork = env['MOZHOU_ALLOW_PRIVATE_LLM'] === '1'

  if (!apiKey) return null
  if (baseUrl) {
    const target = new URL(baseUrl)
    assertProtocol(target, allowPrivateNetwork)
    const hostname = normalizeAddress(target.hostname)
    if (!allowPrivateNetwork && isIP(hostname) !== 0 && isPrivateOrReservedAddress(hostname)) {
      throw new Error(`SSRF 门禁：拒绝调用私有/环回/保留地址 ${hostname}`)
    }
    if (!allowPrivateNetwork && (hostname === 'localhost' || hostname.endsWith('.localhost'))) {
      throw new Error(`SSRF 门禁：拒绝调用本地主机名 ${hostname}`)
    }
  }
  return { baseUrl, apiKey, model, allowPrivateNetwork }
}

/**
 * 发起真实 OpenAI-compatible Chat Completions 流式请求，逐 delta 产出。
 * 仅在已配置真实 Key 且显式非 mock 时调用；网络错误按流式错误语义上抛。
 */
export async function* streamOpenAiChat(
  endpoint: ResolvedEndpoint,
  prompt: string,
  systemPrompt: string,
): AsyncGenerator<OpenAiStreamChunk> {
  const base = endpoint.baseUrl || 'https://api.deepseek.com'
  const url = base.replace(/\/$/, '') + '/chat/completions'
  const target = new URL(url)
  await assertSafeRemoteTarget(target, undefined, endpoint.allowPrivateNetwork === true)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

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
        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[]
          }
          const choice = chunk.choices?.[0]
          if (choice) {
            const delta = choice.delta?.content ?? ''
            if (delta) yield { delta, finishReason: choice.finish_reason }
          }
        } catch {
          // 上游 SSE 可能包含心跳/非 JSON 行；忽略单行，不放宽目标地址门禁。
        }
      }
    }
  } finally {
    clearTimeout(timeout)
  }
}
