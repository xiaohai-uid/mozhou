/**
 * 端侧爬虫 SSRF 校验回归用例（缺陷 B1）。
 *
 * 背景：`isSafePublicUrl` 此前仅对去括号后的 host 做字符串/前缀判定，未还原
 * IPv6 中嵌入的 IPv4。`/api/crawler.extract` 是 public 路由且直接把请求体
 * `url` 透传给 `smartExtractContent`，因此 `http://[::ffff:169.254.169.254]/`
 * 这类云元数据地址会被放行并发出真实请求。
 *
 * 本用例锁定：IPv4 映射（::ffff:）、转换段（::ffff:0:）与 NAT64（64:ff9b::）
 * 形式必须与裸 IPv4 判定一致；同时保留既有公网地址的放行行为。
 */
import { describe, expect, it } from 'vitest'
import { fetchText, isSafePublicUrl } from './provider-utils.js'

describe('isSafePublicUrl · IPv4 映射/转换形式的 IPv6 必须与裸 IPv4 判定一致', () => {
  // URL 解析器会把 ::ffff:127.0.0.1 规范化为 ::ffff:7f00:1，故两种写法都要覆盖。
  const privateMapped = [
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[::ffff:10.0.0.5]/',
    'http://[::ffff:192.168.1.1]/',
    'http://[::ffff:172.16.0.1]/',
    'http://[::ffff:100.64.0.1]/',
    'http://[0:0:0:0:0:ffff:7f00:1]/',
    'http://[::ffff:0:127.0.0.1]/',
    'http://[::ffff:0:7f00:1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[64:ff9b::a9fe:a9fe]/',
  ]

  for (const url of privateMapped) {
    it(`拒绝 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(false)
    })
  }

  const publicAddresses = [
    'http://8.8.8.8/',
    'http://1.1.1.1/',
    'https://example.com/',
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    'http://[2001:4860:4860::8888]/',
    'http://[::ffff:808:808]/', // ::ffff:8.8.8.8，公网，应放行
    'http://172.32.0.1/', // 紧邻 172.16/12 之外
    'http://100.63.0.1/', // 紧邻 CGNAT 100.64/10 之下
    'http://100.128.0.1/', // 紧邻 CGNAT 100.64/10 之上
    // 掩码收紧对照：这三段此前被 /16 整段误拦，现只拦各自的文档 /24，其余是真实公网。
    'http://192.0.1.1/', // 192.0.0/24 与 192.0.2/24 之间
    'http://198.51.1.1/', // 198.51.100/24 之外
    'http://203.0.1.1/', // 203.0.113/24 之外
  ]

  for (const url of publicAddresses) {
    it(`放行 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(true)
    })
  }
})

describe('isSafePublicUrl · 既有私网/环回/协议判定不回退', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://127.1.2.3/',
    'http://[::1]/',
    'http://[::]/',
    'http://localhost/',
    'http://foo.local/',
    'http://svc.internal/',
    'http://nas.lan/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://169.254.169.254/',
    'http://100.64.0.1/',
    // 文档/基准段只拦各自的 /24 与 /15（收紧后仍必须拦，防「修过度拦截」修成漏拦）
    'http://192.0.0.1/', // 192.0.0/24 IETF 协议分配
    'http://192.0.2.1/', // 192.0.2/24 TEST-NET-1
    'http://198.51.100.1/', // 198.51.100/24 TEST-NET-2
    'http://203.0.113.1/', // 203.0.113/24 TEST-NET-3
    'http://198.18.0.1/', // 198.18/15 基准测试
    'http://[fe80::1]/',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ]

  for (const url of blocked) {
    it(`拒绝 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(false)
    })
  }

  it('拒绝非法 URL 文本', () => {
    expect(isSafePublicUrl('not a url')).toBe(false)
    expect(isSafePublicUrl('')).toBe(false)
  })
})

describe('fetchText · 不安全目标在发起请求前被拦截', () => {
  it('返回 400 与 SECURITY_REJECT，不产生网络请求', async () => {
    const result = await fetchText('http://[::ffff:169.254.169.254]/latest/meta-data/', {})
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error ?? '').toContain('SECURITY_REJECT')
  })
})

/**
 * 残余缺陷 B2：IPv6 判定此前用字面前缀 `fc00:`/`fd00:`/`fe80:`，只能命中
 * 恰好以这四个字符开头的写法。`fc12::1`、`fd12:3456::1`、`fe90::1` 同属
 * ULA（fc00::/7）与链路本地（fe80::/10）却被放行。改用数值位段判定后，
 * 同网段内任意取值都必须拒绝，公网 IPv6 仍放行。
 */
describe('isSafePublicUrl · IPv6 按数值位段判定（同网段任意取值不得漏放）', () => {
  const blockedIpv6 = [
    'http://[fc12::1]/', // ULA fc00::/7，字面前缀 `fc00:` 漏放
    'http://[fd12:3456::1]/', // ULA 上界侧，`fd00:` 漏放
    'http://[fcff::]/', // ULA 段内
    'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/', // ULA 段上界
    'http://[fe80::1]/', // 链路本地 fe80::/10
    'http://[fe90::1]/', // 链路本地段内，`fe80:` 漏放
    'http://[febf::1]/', // 链路本地段上界
    'http://[::1]/', // 环回
    'http://[::]/', // 未指定
    'http://[::ffff:127.0.0.1]/', // IPv4 映射（B1 不得回退）
    'http://[::7f00:1]/', // 已废弃 IPv4 兼容 ::127.0.0.1
    'http://[2001:db8::1]/', // 文档段
    'http://[ff02::1]/', // 组播
  ]

  for (const url of blockedIpv6) {
    it(`拒绝 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(false)
    })
  }

  const publicIpv6 = [
    'http://[2606:4700::1111]/', // Cloudflare
    'http://[2404:6800:4003::1]/', // 公网
    'http://[2001:4860:4860::8888]/', // Google DNS
    'http://[2a00:1450:4001:800::200e]/', // 公网
    'http://[::ffff:808:808]/', // ::ffff:8.8.8.8，公网映射
  ]

  for (const url of publicIpv6) {
    it(`放行 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(true)
    })
  }
})

/**
 * 残余缺陷 B3（2026-10-10 第二轮对抗复核）：裸 IPv4 走的是**正则前缀清单**，只覆盖
 * 127./10./192.168./172.16-31./169.254./100.64-127.，于是 `0.0.0.0/8`（除精确的
 * 0.0.0.0）、组播 `224.0.0.0/4`、保留 `240.0.0.0/4` 被放行；NAT64 本地用途前缀
 * `64:ff9b:1::/48`（RFC 8215）也不在判定内。现改为裸 IPv4 交给数值判定，
 * 并把 `64:ff9b:1::/48` 整段拒绝。
 */
describe('isSafePublicUrl · 保留段/组播/翻译器前缀（裸 IPv4 交给数值判定）', () => {
  const blockedResidual = [
    'http://0.1.2.3/', // 0.0.0.0/8（此前只拦精确的 0.0.0.0）
    'http://0.255.255.255/',
    'http://224.0.0.1/', // 组播 224.0.0.0/4
    'http://239.1.2.3/', // 组播段内
    'http://240.0.0.1/', // 保留 240.0.0.0/4
    'http://255.255.255.255/', // 广播
    'http://[64:ff9b:1::7f00:1]/', // NAT64 本地用途 64:ff9b:1::/48
    'http://[64:ff9b:1::1]/',
  ]

  for (const url of blockedResidual) {
    it(`拒绝 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(false)
    })
  }

  const allowedControl = [
    'http://8.8.8.8/', // 公网 IPv4 仍放行
    'http://1.1.1.1/',
    'http://[64:ff9b::808:808]/', // 公网 IPv4 的 NAT64（well-known 前缀）仍放行
    'http://[2606:4700::1111]/', // 公网 IPv6
  ]

  for (const url of allowedControl) {
    it(`放行 ${url}`, () => {
      expect(isSafePublicUrl(url)).toBe(true)
    })
  }
})
