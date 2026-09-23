/**
 * 端侧爬虫网络请求与安全过滤工具。
 * 遵循系统安全规范：仅允许 http/https，严格过滤 localhost/环回/私有地址与 30x 重定向绕过。
 */

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

export function isSafePublicUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    const rawHost = parsed.hostname.toLowerCase()
    const host = rawHost.replace(/^\[|\]$/g, '') // 去除 IPv6 括号包裹

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
