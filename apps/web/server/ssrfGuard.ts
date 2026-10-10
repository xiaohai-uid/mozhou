/**
 * 出站目标主机分类（SSRF 共享判定）。
 *
 * 为什么单独一个模块：同一类判定此前在 `llm/openaiStream.ts` 与
 * `crawlers/provider-utils.ts` 各写一份，两侧网段清单并不一致——LLM 侧漏掉
 * 6to4 `2002::/16`、NAT64 本地用途 `64:ff9b:1::/48`、已废弃 IPv4 兼容 `::/96`
 * 与文档段 `3fff::/20`，而爬虫侧（提交 f2f1a68）已按数值位段修正。漂移的根因
 * 是两份实现，故把「host 是否私有/保留/不可达」抽成这里唯一的纯函数，两处共用，
 * 不再各写一套。
 *
 * 判定只处理**字面 host**。域名解析到私网地址（DNS rebinding）不在本层能力内：
 * 解析发生在发起请求的那一层，防护必须落在那里——连接前解析域名并二次校验解析
 * 结果，或按解析后的 IP 直连并禁止重定向到私网。本模块给出的是「这个字面地址能
 * 不能去」的判定，不是「这次请求最终去了哪」的保证。
 *
 * IPv6 一律解析为 16 字节后按**数值位段**判断，不做字面前缀匹配（前缀匹配会漏掉
 * `fc12::1`、`fe90::1`、`2002:7f00:1::` 等同网段地址）。依据：RFC 4291（地址结构、
 * 环回 ::1、未指定 ::、IPv4 映射 ::ffff:0:0/96、组播 ff00::/8）、RFC 4193（ULA
 * fc00::/7）、RFC 4291 §2.5.6（链路本地 fe80::/10）、RFC 6052（NAT64 64:ff9b::/96）、
 * RFC 8215（NAT64 本地用途 64:ff9b:1::/48）、RFC 3056（6to4 2002::/16 嵌入 IPv4）、
 * RFC 6666（丢弃前缀 100::/64）、RFC 3849 与 RFC 9637（文档段 2001:db8::/32、
 * 3fff::/20）、RFC 1918/6598/5735/3927 等（IPv4 私有、CGNAT、保留、链路本地）。
 */
import { isIP } from 'node:net'

/**
 * IPv4 私有/保留网段判定（点分十进制；非四段或越界一律视为不安全，fail closed）。
 *
 * 覆盖：`0.0.0.0/8`、`10/8`、`127/8`、`100.64/10`（CGNAT）、`169.254/16`（链路本地，
 * 含云元数据 169.254.169.254）、`172.16/12`、`192.168/16`、`192.0.0/24`（IETF 协议
 * 分配）、`192.0.2/24`（TEST-NET-1）、`198.18/15`（基准测试）、`198.51.100/24`
 * （TEST-NET-2）、`203.0.113/24`（TEST-NET-3）、组播 `224/4` 与保留 `240/4`（`a >= 224`）。
 *
 * 掩码必须与上列文档段**逐段对齐**：`192.0.0.0/24`、`192.0.2.0/24`、`198.51.100.0/24`、
 * `203.0.113.0/24` 都只拦各自 /24，不得放大到 /16。此前 `192.0.0.0/16`、`198.51.0.0/16`、
 * `203.0.0.0/16` 整段被拒，把真实公网地址（如 `192.0.1.1`、`198.51.1.1`、`203.0.1.1`）
 * 一并误拦，导致爬虫/LLM 出站打不到合法目标；现收紧为 /24（`198.18/15` 本就精确）。
 */
export function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }
  const [a = 0, b = 0, c = 0] = parts
  return (
    a === 0 || // 0.0.0.0/8「本网络」
    a === 10 || // 10/8 私有
    a === 127 || // 127/8 环回
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || // 169.254/16 链路本地
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 私有
    (a === 192 && b === 168) || // 192.168/16 私有
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0/24 IETF + 192.0.2/24 TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // 198.18/15 基准测试
    (a === 198 && b === 51 && c === 100) || // 198.51.100/24 TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113/24 TEST-NET-3
    a >= 224 // 224/4 组播 + 240/4 保留
  )
}

/**
 * 还原 IPv6 字面量中嵌入的 IPv4 地址（返回点分十进制；无嵌入则返回 null）。
 *
 * URL 解析器会把点分映射形式（`::ffff:127.0.0.1`）规范化为十六进制
 * （`::ffff:7f00:1`），因此点分与十六进制两种形式都必须覆盖；同时覆盖
 * `::ffff:0:0/96` 转换段与 `64:ff9b::/96` NAT64 段。
 */
export function extractEmbeddedIpv4(host: string): string | null {
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
export function parseIpv6Groups(address: string): number[] | null {
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
export function ipv6GroupsToBytes(groups: number[]): number[] {
  const bytes: number[] = []
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff)
  }
  return bytes
}

/** 把 16 字节中自 offset 起的四字节按点分十进制还原，供 IPv4 判定复用。 */
function bytesToDottedIpv4(bytes: number[], offset: number): string {
  return `${bytes[offset] ?? 0}.${bytes[offset + 1] ?? 0}.${bytes[offset + 2] ?? 0}.${bytes[offset + 3] ?? 0}`
}

/**
 * IPv6 私有/保留判定：解析为数值后按**位段范围**判断。
 * 非 IPv6 字面量（无 `:` 或解析失败）返回 false，交由调用方其它规则处理。
 */
export function isPrivateOrReservedIpv6(address: string): boolean {
  // 先按**字面形式**还原嵌入的 IPv4：URL 解析器会把 `::ffff:0:127.0.0.1` 规范化为
  // `::ffff:0:7f00:1`（比 `::ffff:0:0/96` 多一个全零分组），该形态的字节前缀不落入
  // 下方映射段判定，只靠数值位段会漏；字面还原与位段判定互为补充，两者都保留。
  const embedded = extractEmbeddedIpv4(address)
  if (embedded !== null && isPrivateOrReservedIpv4(embedded)) {
    return true
  }

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
  // 没有理由穿过它；其 /48 内的嵌入 IPv4 形式点分与十六进制并存，整段拒绝更稳）。
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
  // 6to4 2002::/16：嵌入的 IPv4（第 2–5 字节）为私网/保留时同样拦截
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

/** 去掉方括号并转小写，得到可交给 `isIP` 的裸 host。 */
export function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/^\[|\]$/g, '')
}

/**
 * host 分类统一出口：字面 IPv4/IPv6 落入私有/保留段返回 true；
 * **非点分四段、非合法 IPv6 的畸形输入一律返回 true**（fail closed）。
 */
export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = normalizeAddress(address)
  const family = isIP(normalized)
  if (family === 4) return isPrivateOrReservedIpv4(normalized)
  if (family === 6) return isPrivateOrReservedIpv6(normalized)
  return true
}
