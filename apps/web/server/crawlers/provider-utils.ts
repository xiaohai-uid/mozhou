/**
 * 端侧爬虫网络请求与安全过滤工具。
 * 遵循系统安全规范：仅允许 http/https，严格过滤 localhost/环回/私有地址与 30x 重定向绕过。
 *
 * host 的私有/保留判定已抽到 `../ssrfGuard.js`（与 LLM 出站共用同一实现，避免两侧
 * 网段清单再次漂移）。本文件只保留爬虫侧策略：协议白名单、域名后缀过滤、重定向逐跳复检。
 *
 * 边界声明（不要误读为已修复）：`isSafePublicUrl` 只看 URL 里的**字面 host**，
 * 不做 DNS 解析。公网域名解析到私网地址（DNS rebinding）本函数无法识别，
 * 防护必须落在发起请求的那一层——连接前解析域名并二次校验解析结果，
 * 或按解析后的 IP 直连并禁止重定向到私网（本文件的重定向已逐跳复检字面 host，
 * 但仍不覆盖域名解析结果）。
 */
import {
  extractEmbeddedIpv4,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
} from '../ssrfGuard.js'

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

    // IPv4 映射/转换形式的 IPv6 先还原为 IPv4 再判定，否则环回、私网与
    // 云元数据地址（如 ::ffff:127.0.0.1、::ffff:a9fe:a9fe）会绕过下方校验。
    const embeddedV4 = extractEmbeddedIpv4(host)
    if (embeddedV4 !== null && isPrivateOrReservedIpv4(embeddedV4)) {
      return false
    }

    // IPv6 字面量按数值位段判定（含 ULA、链路本地、环回、IPv4 映射/转换、6to4、
    // NAT64、文档段等）。
    if (isPrivateOrReservedIpv6(host)) {
      return false
    }

    // 裸 IPv4：交给数值判定。此前的正则前缀清单只覆盖 127./10./192.168./172.16-31./
    // 169.254./100.64-127.，漏掉 0.0.0.0/8、组播 224.0.0.0/4、保留 240.0.0.0/4 等
    // （实测 http://0.1.2.3/ 与 http://224.0.0.1/ 曾被放行）。URL 解析器已把 1–3 段、
    // 八进制与十六进制形式规范化为点分四段，故这里只认点分四段。
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return !isPrivateOrReservedIpv4(host)
    }

    // 过滤 localhost 与私有域名后缀
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan')
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
