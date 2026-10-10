// @vitest-environment node
/**
 * 离线票据与 Ed25519 签名核验测试 (T15 · LicenseTicketManager)。
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { LicenseTicketManager, capabilitiesForPlan, type SignedLicenseTicket } from './license.js'
import { billingCatalog, PRO_ENTITLEMENT_KEYS } from './catalog.js'
import { RequestBoundaryError } from '../security.js'

/**
 * 白盒取服务端真实私钥，用于构造「签名有效但数据不一致」的票据，模拟签发层缺陷/旧版
 * 签发器，从而测到能力一致性校验与字段类型守卫。修复「验签只认服务端公钥」后，这些
 * 防御已无法通过公开 API 触发（issueTicket 派生的能力恒与 planId 自洽），故必须白盒。
 */
function serverPrivateKey(manager: LicenseTicketManager): string {
  return (manager as unknown as { _privateKey: string })._privateKey
}


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

  it('免费套餐票据不含任何 pro 能力（不再默认授予 pro-features）', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_free_author',
      deviceId: 'device_001',
      planId: 'free',
    })

    expect(ticket.data.planId).toBe('free')
    expect(ticket.data.capabilities).toEqual([])
    expect(ticket.data.capabilities).not.toContain('pro-features')
    // 自洽票据仍可通过核验
    expect(manager.verifyTicket(ticket, 'device_001').valid).toBe(true)
  })

  it('Pro 套餐票据能力等于冻结目录的 PRO_ENTITLEMENT_KEYS', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_pro_author',
      deviceId: 'device_001',
      planId: 'pro_monthly',
    })

    expect([...ticket.data.capabilities].sort()).toEqual([...PRO_ENTITLEMENT_KEYS].sort())
    expect(manager.verifyTicket(ticket, 'device_001').valid).toBe(true)
  })

  it('Max 套餐票据能力含 Pro 全集与 managed-model-quota', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_max_author',
      deviceId: 'device_001',
      planId: 'max_monthly',
    })

    expect([...ticket.data.capabilities].sort()).toEqual(
      [...billingCatalog.max.entitlementKeys].sort(),
    )
    expect(ticket.data.capabilities).toContain('managed-model-quota')
    expect(manager.verifyTicket(ticket, 'device_001').valid).toBe(true)
  })

  it('未知/本地开发套餐不获得任何能力', () => {
    const manager = new LicenseTicketManager()
    const ticket = manager.issueTicket({
      userId: 'usr_local',
      deviceId: 'device_001',
      planId: 'local_dev',
    })

    expect(ticket.data.capabilities).toEqual([])
  })

  it('能力与套餐不一致的票据在核验时被拒（CAPABILITY_PLAN_MISMATCH）', () => {
    const manager = new LicenseTicketManager()
    // 用服务端真实私钥签署一张「free 套餐却带 pro 能力」的票据，模拟签发层缺陷/旧版
    // 签发器：签名本身有效，但能力与 planId 不一致，必须被一致性校验拦下。
    // 修复「验签只认服务端公钥」后，这里必须白盒取真私钥——否则会先被 INVALID_SIGNATURE
    // 拦下，测不到这道防御。
    const data = {
      userId: 'usr_free_author',
      deviceId: 'device_001',
      planId: 'free',
      serverTime: Date.now(),
      expiry: Date.now() + 3600 * 1000,
      capabilities: ['pro-features'],
    }
    const signature = sign(null, Buffer.from(JSON.stringify(data), 'utf8'), serverPrivateKey(manager)).toString('base64')

    expect(() => {
      manager.verifyTicket({ data, signature, publicKey: manager.getPublicKey() }, 'device_001')
    }).toThrow(/CAPABILITY_PLAN_MISMATCH/)
  })

  it('畸形 capabilities（非数组 / 字符串 / 缺字段 / 含非字符串元素）一律 403，而非 TypeError', () => {
    const manager = new LicenseTicketManager()
    // 用服务端真实私钥签名，使签名校验通过、真正走到能力字段比较那一步；
    // 否则会先在签名环节被 INVALID_SIGNATURE 拦下，测不到类型守卫。
    const signWith = (capabilities: unknown): SignedLicenseTicket => {
      const data = {
        userId: 'usr_malformed',
        deviceId: 'device_001',
        planId: 'free',
        serverTime: Date.now(),
        expiry: Date.now() + 3600 * 1000,
        capabilities,
      }
      const signature = sign(null, Buffer.from(JSON.stringify(data), 'utf8'), serverPrivateKey(manager)).toString('base64')
      return { data, signature, publicKey: manager.getPublicKey() } as unknown as SignedLicenseTicket
    }

    for (const caps of [123, 'pro-features', undefined, ['pro-features', 42]]) {
      let caught: unknown
      try {
        manager.verifyTicket(signWith(caps), 'device_001')
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(RequestBoundaryError)
      expect((caught as RequestBoundaryError).status).toBe(403)
      expect((caught as Error).message).toMatch(/CAPABILITY_PLAN_MISMATCH/)
    }
  })

  it('自签票据（自带公钥）一律拒绝：服务端验签只认自己的公钥', () => {
    const manager = new LicenseTicketManager()
    // 攻击者用自生成密钥对签发一张 max_monthly 票据：capabilities 与 planId 自洽，
    // 能通过第 5 步能力一致性校验。若验签采信票据携带的 publicKey，这张伪造票据就会被
    // 接受——签名票据的全部意义随之失效（任何人都能自签任意套餐）。
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const data = {
      userId: 'usr_attacker',
      deviceId: 'device_001',
      planId: 'max_monthly',
      serverTime: Date.now(),
      expiry: Date.now() + 3600 * 1000,
      capabilities: [...capabilitiesForPlan('max_monthly')],
    }
    const signature = sign(null, Buffer.from(JSON.stringify(data), 'utf8'), privateKey).toString('base64')

    expect(() => {
      manager.verifyTicket({ data, signature, publicKey }, 'device_001')
    }).toThrow(/INVALID_SIGNATURE/)
  })

  it('服务端自签发的票据仍通过核验（含 free 套餐 capabilities: [] 的空数组）', () => {
    const manager = new LicenseTicketManager()
    for (const planId of ['free', 'pro_monthly', 'max_monthly'] as const) {
      const ticket = manager.issueTicket({ userId: 'usr_self', deviceId: 'device_001', planId })
      const result = manager.verifyTicket(ticket, 'device_001')
      expect(result.valid).toBe(true)
      expect(result.planId).toBe(planId)
    }

    // 空能力数组是合法票据，不能被「字段类型守卫」或能力比较误伤
    const freeTicket = manager.issueTicket({ userId: 'usr_free_self', deviceId: 'device_001', planId: 'free' })
    expect(freeTicket.data.capabilities).toEqual([])
    expect(manager.verifyTicket(freeTicket, 'device_001').valid).toBe(true)
  })
})
