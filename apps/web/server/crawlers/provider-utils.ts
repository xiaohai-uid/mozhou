/**
 * 端侧爬虫网络请求与安全过滤工具。
 * 遵循系统安全规范：仅允许 http/https，严格过滤 localhost/环回/私有地址与 30x 重定向绕过。
 */

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

/** IPv4 私有/保留网段判定（点分十进制；非四段或越界一律视为不安全）。 */
function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }
  const [a = 0, b = 0] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    a >= 224
  )
}

/**
 * 还原 IPv6 字面量中嵌入的 IPv4 地址（返回点分十进制；无嵌入则返回 null）。
 *
 * URL 解析器会把点分映射形式（`::ffff:127.0.0.1`）规范化为十六进制
 * （`::ffff:7f00:1`），因此点分与十六进制两种形式都必须覆盖；同时覆盖
 * `::ffff:0:0/96` 转换段与 `64:ff9b::/96` NAT64 段。缺少还原时，环回、
 * 私网与云元数据地址会以 IPv4 映射形式绕过下方校验。
 */
function extractEmbeddedIpv4(host: string): string | null {
  const dotted = host.match(/^(?:::ffff:(?:0:)?|64:ff9b::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted?.[1] !== undefined) {
    return dotted[1]
  }
  const hex = host.match(/^(?:::ffff:(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex?.[1] !== undefined && hex[2] !== undefined) {
    const high = Number.parseInt(hex[1], 16)
    const low = Number.parseInt(hex[2], 16)
    return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
  }
  return null
}

export function isSafePublicUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    const rawHost = parsed.hostname.toLowerCase()
    const host = rawHost.replace(/^\[|\]$/g, '') // 去除 IPv6 括号包裹

    // IPv4 映射/转换形式的 IPv6 先还原为 IPv4 再判定，否则环回、私网与
    // 云元数据地址（如 ::ffff:127.0.0.1、::ffff:a9fe:a9fe）会绕过下方校验。
    const embeddedV4 = extractEmbeddedIpv4(host)
    if (embeddedV4 !== null && isPrivateOrReservedIpv4(embeddedV4)) {
      return false
    }

    // 过滤 localhost、环回、未指定与私有/保留地址
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '::' ||
      host.startsWith('0:0:') ||
      host.startsWith('fe80:') ||
      host.startsWith('fc00:') ||
      host.startsWith('fd00:') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(host)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redirectCount = 0,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  if (!isSafePublicUrl(url)) {
    return {
      ok: false,
      status: 400,
      body: '',
      error: 'SECURITY_REJECT: 目标 URL 为私有/非安全地址，已被安全策略拦截',
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers,
      signal: ctrl.signal,
      redirect: 'manual', // 手动处理重定向，严格重新校验目标 Location 防 SSRF 绕过
    })

    // 处理 3xx 重定向
    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 307 ||
      response.status === 308
    ) {
      if (redirectCount >= MAX_REDIRECTS) {
        return {
          ok: false,
          status: response.status,
          body: '',
          error: 'REDIRECT_LIMIT_EXCEEDED: 超过最大重定向次数限制',
        }
      }
      const location = response.headers.get('Location')
      if (!location) {
        return {
          ok: false,
          status: response.status,
          body: '',
          error: 'REDIRECT_LOCATION_MISSING: 重定向未提供 Location 头部',
        }
      }
      const nextUrl = new URL(location, url).toString()
      if (!isSafePublicUrl(nextUrl)) {
        return {
          ok: false,
          status: 400,
          body: '',
          error: 'SECURITY_REJECT: 重定向目标为私有/非安全地址，已被安全策略拦截',
        }
      }
      return fetchText(nextUrl, headers, timeoutMs, redirectCount + 1)
    }

    const body = await response.text()
    return { ok: response.ok, status: response.status ?? 0, body }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}
