/**
 * 端侧爬虫网络请求与安全过滤工具。
 * 遵循系统安全规范：仅允许 http/https，严格过滤 localhost/环回/私有地址与 30x 重定向绕过。
 *
 * 边界声明（不要误读为已修复）：`isSafePublicUrl` 只看 URL 里的**字面 host**，
 * 不做 DNS 解析。公网域名解析到私网地址（DNS rebinding）本函数无法识别，
 * 防护必须落在发起请求的那一层——连接前解析域名并二次校验解析结果，
 * 或按解析后的 IP 直连并禁止重定向到私网（本文件的重定向已逐跳复检字面 host，
 * 但仍不覆盖域名解析结果）。
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

/**
 * 把 IPv6 字面量解析为 8 个 16 位分组（数值），非法返回 null。
 * 处理 `::` 压缩、zone id（`%eth0`）与末段 IPv4 尾段（如 `::ffff:127.0.0.1`）。
 */
function parseIpv6Groups(address: string): number[] | null {
  const zoneIndex = address.indexOf('%')
  const host = zoneIndex === -1 ? address : address.slice(0, zoneIndex)
  if (!host.includes(':')) {
    return null
  }
  const doubleColon = host.indexOf('::')
  if (doubleColon !== -1 && host.indexOf('::', doubleColon + 1) !== -1) {
    return null // 出现多个 `::` 非法
  }

  const expand = (segment: string): number[] | null => {
    if (segment === '') {
      return []
    }
    const raw = segment.split(':')
    const groups: number[] = []
    for (let i = 0; i < raw.length; i += 1) {
      const part = raw[i] ?? ''
      if (part === '') {
        return null
      }
      if (part.includes('.')) {
        if (i !== raw.length - 1) {
          return null // 点分 IPv4 只能出现在末段
        }
        const octets = part.split('.').map((value) => Number.parseInt(value, 10))
        if (
          octets.length !== 4 ||
          octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
        ) {
          return null
        }
        const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = octets
        groups.push((o0 << 8) | o1, (o2 << 8) | o3)
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) {
          return null
        }
        groups.push(Number.parseInt(part, 16))
      }
    }
    return groups
  }

  if (doubleColon === -1) {
    const groups = expand(host)
    return groups !== null && groups.length === 8 ? groups : null
  }
  const head = expand(host.slice(0, doubleColon))
  const tail = expand(host.slice(doubleColon + 2))
  if (head === null || tail === null) {
    return null
  }
  const fill = 8 - head.length - tail.length
  if (fill < 1) {
    return null // `::` 必须至少压缩一个全零分组
  }
  return [...head, ...new Array<number>(fill).fill(0), ...tail]
}

/** 8 个 16 位分组 → 16 字节。 */
function ipv6GroupsToBytes(groups: number[]): number[] {
  const bytes: number[] = []
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff)
  }
  return bytes
}

/** 把 16 字节末四字节按点分十进制还原，供 IPv4 判定复用。 */
function bytesToDottedIpv4(bytes: number[], offset: number): string {
  return `${bytes[offset] ?? 0}.${bytes[offset + 1] ?? 0}.${bytes[offset + 2] ?? 0}.${bytes[offset + 3] ?? 0}`
}

/**
 * IPv6 私有/保留判定：解析为数值后按**位段范围**判断，不做字面前缀匹配
 * （前缀匹配会漏掉 `fc12::1`、`fd12:3456::1`、`fe90::1` 等同网段地址）。
 * 依据：RFC 4291（地址结构）、RFC 4193（ULA fc00::/7）、RFC 4291 §2.5.6
 * （链路本地 fe80::/10）、RFC 4291（环回 ::1、未指定 ::）、RFC 4291 §2.5.5.2
 * （IPv4 映射 ::ffff:0:0/96）、RFC 6052（NAT64 64:ff9b::/96）、RFC 3056（6to4
 * 2002::/16 嵌入 IPv4）、RFC 6666（丢弃前缀 100::/64）、RFC 3849 与 RFC 9637
 * （文档段 2001:db8::/32、3fff::/20）、RFC 4291 §2.7（组播 ff00::/8）。
 * 非 IPv6 字面量（无 `:`）返回 false，交由其它规则处理。
 */
function isPrivateOrReservedIpv6(address: string): boolean {
  const groups = parseIpv6Groups(address)
  if (groups === null) {
    return false
  }
  const bytes = ipv6GroupsToBytes(groups)

  // 未指定 :: 与环回 ::1
  if (bytes.every((byte) => byte === 0)) {
    return true
  }
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) {
    return true
  }
  // 已废弃的 IPv4 兼容段 ::/96（::x.x.x.x，不含已处理的 :: 与 ::1）
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return isPrivateOrReservedIpv4(bytesToDottedIpv4(bytes, 12))
  }
  // ULA fc00::/7（fc00–fdff）
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) {
    return true
  }
  // 链路本地 fe80::/10（fe80–febf）
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) {
    return true
  }
  // 组播 ff00::/8：不是合法单播目标
  if (bytes[0] === 0xff) {
    return true
  }
  // IPv4 映射 ::ffff:0:0/96
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateOrReservedIpv4(bytesToDottedIpv4(bytes, 12))
  }
  // NAT64 本地用途前缀 64:ff9b:1::/48（RFC 8215）：整段视为不安全（翻译器前缀，
  // 爬虫没有理由穿过它；其 /48 内的嵌入 IPv4 形式点分与十六进制并存，整段拒绝更稳）。
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes[4] === 0x00 &&
    bytes[5] === 0x01
  ) {
    return true
  }
  // NAT64 64:ff9b::/96
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isPrivateOrReservedIpv4(bytesToDottedIpv4(bytes, 12))
  }
  // 6to4 2002::/16：嵌入的 IPv4 为私网时同样拦截
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateOrReservedIpv4(bytesToDottedIpv4(bytes, 2))
  }
  // 文档段 2001:db8::/32
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true
  }
  // 文档段 3fff::/20（RFC 9637）
  if (bytes[0] === 0x3f && ((bytes[1] ?? 0) & 0xf0) === 0xf0) {
    return true
  }
  // 丢弃前缀 100::/64（RFC 6666）
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes.slice(2, 8).every((byte) => byte === 0)) {
    return true
  }
  return false
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

    // IPv6 字面量按数值位段判定（含 ULA、链路本地、环回、IPv4 映射/转换等）。
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
