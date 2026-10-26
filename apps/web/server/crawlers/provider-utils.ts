/**
 * 端侧爬虫网络请求与安全过滤工具。
 * 遵循系统安全规范：仅允许 http/https，严格过滤 localhost/环回/私有地址与 30x 重定向绕过。
 *
 * host 的私有/保留判定已抽到 `../ssrfGuard.js`（与 LLM 出站共用同一实现，避免两侧
 * 网段清单再次漂移）。本文件只保留爬虫侧策略：协议白名单、域名后缀过滤、重定向逐跳复检。
 *
 * DNS rebinding（已修）：`isSafePublicUrl` 只看 URL 里的**字面 host**；公网域名解析到
 * 私网地址本函数无法识别。因此 `fetchText` 在每跳发请求前**解析并校验全部地址**，
 * 再用 `net/pinnedHttp` 把连接固定到同一份已验证结果（lookup 注入），
 * 使「校验用的解析结果」与「实际连接的解析结果」同源；Host/SNI/证书仍按原域名。
 */
import { isIP } from 'node:net'
import {
  extractEmbeddedIpv4,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  normalizeAddress,
} from '../ssrfGuard.js'
import { pinnedRequest, type PinnedAddress } from '../net/pinnedHttp.js'
import { defaultAddressLookup, resolvePublicAddresses, type AddressLookup } from '../net/publicTarget.js'
import { abortReason } from '../net/abortWait.js'

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

/** fetchText 的注入缝（**仅测试用**）：DNS 与传输缺省走 Node DNS / pinnedRequest。 */
export interface FetchTextDeps {
  readonly lookupAll?: AddressLookup | undefined
  readonly request?: typeof pinnedRequest | undefined
}

/**
 * 逐跳的地址校验（爬虫策略层）：字面 host 预检 + 本机/私有后缀过滤，再交给共享内核
 * 解析并逐条校验全部地址（`net/publicTarget.resolvePublicAddresses`）。
 * 字面 IP 端点返回空数组（字面判定已由 isSafePublicUrl 完成，无需 lookup 注入）。
 */
async function resolveVerifiedTarget(parsed: URL, lookupAll: AddressLookup, signal: AbortSignal): Promise<readonly PinnedAddress[]> {
  const hostname = normalizeAddress(parsed.hostname)
  if (isIP(hostname) !== 0) return []
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    throw new Error('SECURITY_REJECT: 目标域名为本机/私有后缀，已被安全策略拦截')
  }
  return await resolvePublicAddresses(hostname, lookupAll, signal)
}

export async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redirectCount = 0,
  deps?: FetchTextDeps,
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  if (!isSafePublicUrl(url)) {
    return {
      ok: false,
      status: 400,
      body: '',
      error: 'SECURITY_REJECT: 目标 URL 为私有/非安全地址，已被安全策略拦截',
    }
  }

  const lookupAll = deps?.lookupAll ?? defaultAddressLookup
  const request = deps?.request ?? pinnedRequest
  const ctrl = new AbortController()
  const deadline = Date.now() + timeoutMs
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const parsed = new URL(url)
    // 字面 host 之外再解析校验全部地址，并把连接固定到同一份结果（防 DNS rebinding）。
    // 每一跳（含重定向目标）都走这一步。
    const addresses = await resolveVerifiedTarget(parsed, lookupAll, ctrl.signal)
    const response = await request(parsed, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
      // 重定向不自动跟随（与 fetch 的 redirect:'manual' 同语义），逐跳重新校验
      ...(addresses.length === 0 ? {} : { addresses }),
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
      const location = response.headers.get('location')
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
      // 跳转前释放当前连接；仅同 origin 保留凭据，跨 origin 不传播敏感请求头。
      ctrl.abort()
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw abortReason(ctrl.signal)
      const sameOrigin = new URL(nextUrl).origin === parsed.origin
      const nextHeaders = sameOrigin ? headers : Object.fromEntries(
        Object.entries(headers).filter(([name]) => ![
          'authorization', 'proxy-authorization', 'cookie', 'cookie2', 'x-api-key', 'api-key',
        ].includes(name.toLowerCase())),
      )
      return await fetchText(nextUrl, nextHeaders, remainingMs, redirectCount + 1, deps)
    }

    const body = await response.text()
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
    ctrl.abort() // 释放本跳连接
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
