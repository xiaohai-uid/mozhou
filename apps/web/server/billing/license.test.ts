// @vitest-environment node
/**
 * 离线票据与 Ed25519 签名核验测试 (T15 · LicenseTicketManager)。
 */
import { describe, expect, it } from 'vitest'
import { LicenseTicketManager } from './license.js'

describe('LicenseTicketManager 离线票据与签名防伪 (T15)', () => {
  it('正常签署与 72h 内离线核验通过', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_pro_author',
      deviceId: 'device_win_laptop_001',
      planId: 'pro_monthly',
    })

    expect(ticket.signature.length).toBeGreaterThan(30)
    expect(ticket.publicKey).toContain('PUBLIC KEY')

    const result = manager.verifyTicket(ticket, 'device_win_laptop_001')
    expect(result.valid).toBe(true)
    expect(result.planId).toBe('pro_monthly')
  })

  it('设备不匹配 (错设备) → 抛出 DEVICE_MISMATCH 拒绝', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_pro_author',
      deviceId: 'device_correct_1',
      planId: 'pro_monthly',
    })

    expect(() => {
      manager.verifyTicket(ticket, 'device_alien_2')
    }).toThrow(/DEVICE_MISMATCH/)
  })

  it('伪造签名或篡改 payload → 抛出 INVALID_SIGNATURE 拒绝', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_legit',
      deviceId: 'device_001',
      planId: 'pro_monthly',
    })

    // 篡改计划等级为 max_monthly
    const forgedTicket = {
      ...ticket,
      data: {
        ...ticket.data,
        planId: 'max_monthly',
      },
    }

    expect(() => {
      manager.verifyTicket(forgedTicket, 'device_001')
    }).toThrow(/INVALID_SIGNATURE/)
  })

  it('票据过期 → 抛出 TICKET_EXPIRED 拒绝', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_expired',
      deviceId: 'device_001',
      planId: 'pro_monthly',
      ttlMs: 1000, // 1 秒过期
    })

    // 模拟 5 秒后核验
    expect(() => {
      manager.verifyTicket(ticket, 'device_001', Date.now() + 5000)
    }).toThrow(/TICKET_EXPIRED/)
  })

  it('客户端时钟回拨欺诈检测 → 抛出 CLOCK_ROLLBACK_DETECTED 拒绝', () => {
    const manager = new LicenseTicketManager()
    const now = Date.now()
    const ticket = manager.issueTicket({
      userId: 'usr_cheater',
      deviceId: 'device_001',
      planId: 'pro_monthly',
    })

    // 客户端故意将本地系统时间倒拨 1 小时试图延期
    const pastTime = now - 3600 * 1000
    expect(() => {
      manager.verifyTicket(ticket, 'device_001', pastTime)
    }).toThrow(/CLOCK_ROLLBACK_DETECTED/)
  })
})
