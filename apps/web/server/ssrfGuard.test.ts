/**
 * 共享 host 分类（`ssrfGuard.ts`）回归用例。
 *
 * 背景：`llm/openaiStream.ts` 与 `crawlers/provider-utils.ts` 曾各写一份网段判定，
 * LLM 侧漏掉 6to4 `2002::/16`、NAT64 本地用途 `64:ff9b:1::/48`、已废弃 IPv4 兼容
 * `::/96` 与文档段 `3fff::/20`，导致 `POST /api/llm/settings` 的任意 baseUrl 可借这些
 * 形式打内网或云元数据。本用例锁定共享判定对这些形式一律拒绝，同时公网地址仍放行。
 */
import { describe, expect, it } from 'vitest'
import {
  isPrivateOrReservedAddress,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  normalizeAddress,
} from './ssrfGuard.js'

describe('isPrivateOrReservedIpv4 · 私有/保留网段按数值判定', () => {
  const blocked = [
    '0.0.0.0',
    '0.1.2.3', // 0.0.0.0/8
    '10.0.0.5', // 10/8
    '127.0.0.1', // 127/8
    '127.255.255.254',
    '100.64.0.1', // 100.64/10 CGNAT
    '100.127.255.255',
    '169.254.169.254', // 169.254/16 链路本地（云元数据）
    '172.16.0.1', // 172.16/12
    '172.31.255.255',
    '192.0.0.1', // 192.0.0/24
    '192.168.1.1', // 192.168/16
    '198.18.0.1', // 198.18/15 基准测试
    '198.19.255.255',
    '198.51.100.7', // 198.51.100/24 TEST-NET-2
    '203.0.113.7', // 203.0.113/24 TEST-NET-3
    '224.0.0.1', // 224/4 组播
    '239.1.2.3',
    '240.0.0.1', // 240/4 保留
    '255.255.255.255', // 广播
  ]
  for (const address of blocked) {
    it(`拒绝 ${address}`, () => {
      expect(isPrivateOrReservedIpv4(address)).toBe(true)
    })
  }

  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // 紧邻 172.16/12 之外
    '100.63.0.1', // 紧邻 CGNAT 之下
    '100.128.0.1', // 紧邻 CGNAT 之上
    '198.20.0.1', // 紧邻 198.18/15 之外
    '223.255.255.255', // 组播段之下
  ]
  for (const address of allowed) {
    it(`放行 ${address}`, () => {
      expect(isPrivateOrReservedIpv4(address)).toBe(false)
    })
  }

  it('非点分四段/越界一律视为不安全', () => {
    expect(isPrivateOrReservedIpv4('8.8.8')).toBe(true)
    expect(isPrivateOrReservedIpv4('8.8.8.8.8')).toBe(true)
    expect(isPrivateOrReservedIpv4('256.1.1.1')).toBe(true)
    expect(isPrivateOrReservedIpv4('not-an-ip')).toBe(true)
    expect(isPrivateOrReservedIpv4('')).toBe(true)
  })
})

describe('isPrivateOrReservedIpv6 · 本轮新覆盖的四种形式必须拒绝', () => {
  // 第三轮独立复核报出的高危项：这四种形式在 LLM 侧旧判定上被放行。
  const newForms: [string, string][] = [
    ['2002:7f00:1::', '6to4 2002::/16 嵌入 127.0.0.1'],
    ['64:ff9b:1::a9fe:a9fe', 'NAT64 本地用途 64:ff9b:1::/48 嵌入 169.254.169.254'],
    ['::7f00:1', '已废弃 IPv4 兼容 ::/96 嵌入 127.0.0.1'],
    ['3fff::1', '文档段 3fff::/20'],
  ]
  for (const [address, why] of newForms) {
    it(`拒绝 ${address}（${why}）`, () => {
      expect(isPrivateOrReservedIpv6(address)).toBe(true)
    })
  }

  const blocked = [
    '::', // 未指定
    '::1', // 环回
    '::ffff:7f00:1', // IPv4 映射 127.0.0.1
    '::ffff:a9fe:a9fe', // IPv4 映射 169.254.169.254
    '::ffff:0:7f00:1', // ::ffff:0:/96 转换段
    '64:ff9b::7f00:1', // NAT64 64:ff9b::/96 嵌入环回
    '64:ff9b::a9fe:a9fe', // NAT64 嵌入云元数据
    'fc12::1', // ULA fc00::/7
    'fd12:3456::1',
    'fe80::1', // 链路本地 fe80::/10
    'fe90::1',
    'ff02::1', // 组播 ff00::/8
    '2001:db8::1', // 文档段 2001:db8::/32
    '100::1', // 丢弃前缀 100::/64
  ]
  for (const address of blocked) {
    it(`拒绝 ${address}`, () => {
      expect(isPrivateOrReservedIpv6(address)).toBe(true)
    })
  }

  const allowed = [
    '2606:4700::1111', // Cloudflare
    '2001:4860:4860::8888', // Google DNS
    '2a00:1450:4001:800::200e',
    '::ffff:808:808', // ::ffff:8.8.8.8 公网映射
    '64:ff9b::808:808', // 公网 IPv4 的 NAT64
  ]
  for (const address of allowed) {
    it(`放行 ${address}`, () => {
      expect(isPrivateOrReservedIpv6(address)).toBe(false)
    })
  }
})

describe('isPrivateOrReservedAddress · 统一出口（含方括号与畸形输入）', () => {
  it('带方括号的字面 host 与裸 host 判定一致', () => {
    expect(isPrivateOrReservedAddress('[2002:7f00:1::]')).toBe(true)
    expect(isPrivateOrReservedAddress('2002:7f00:1::')).toBe(true)
    expect(isPrivateOrReservedAddress('[2606:4700::1111]')).toBe(false)
    expect(isPrivateOrReservedAddress('2606:4700::1111')).toBe(false)
  })

  it('公网 IPv4/IPv6 放行，畸形输入一律拒绝（fail closed）', () => {
    expect(isPrivateOrReservedAddress('8.8.8.8')).toBe(false)
    expect(isPrivateOrReservedAddress('127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedAddress('not-an-ip')).toBe(true)
    expect(isPrivateOrReservedAddress('')).toBe(true)
    expect(isPrivateOrReservedAddress('example.com')).toBe(true)
  })

  it('normalizeAddress 去方括号并转小写', () => {
    expect(normalizeAddress('[2002:7F00:1::]')).toBe('2002:7f00:1::')
    expect(normalizeAddress('8.8.8.8')).toBe('8.8.8.8')
  })
})
