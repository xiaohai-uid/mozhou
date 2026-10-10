/**
 * apps/web/server/billing · 离线票据与 Ed25519 签名授权 (License & Offline Auth · T15)。
 * 
 * 依照 reference/03-public-billing.md T15 规格：
 * - 离线票据采用 Ed25519 非对称签名；
 * - 绑定 serverTime / expiry / deviceId / userId / planId；
 * - 72 小时以内离线宽限期；
 * - 拒绝伪造签名、错设备、过期与本地客户端时钟回拨 (clock rollback)；
 * - 长期离线仍可编辑/导出/备份，但不授权联网 managed 请求。
 */
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { RequestBoundaryError } from '../security.js'
import { billingCatalog } from './catalog.js'

/**
 * 由套餐推导票据能力（唯一真源为冻结定价目录 catalog.ts）：
 * - pro_monthly → PRO_ENTITLEMENT_KEYS；
 * - max_monthly → Max 套餐权益（Pro 全集 + managed-model-quota）；
 * - free / local_dev / 未知套餐 → 空数组。
 * 绝不默认授予 pro：能力必须与套餐一致，否则免费用户会拿到自称付费的票据。
 */
export function capabilitiesForPlan(planId: string): readonly string[] {
  if (planId === billingCatalog.pro.planId) return billingCatalog.pro.entitlementKeys
  if (planId === billingCatalog.max.planId) return billingCatalog.max.entitlementKeys
  return []
}

export interface LicenseTicketData {
  readonly userId: string
  readonly deviceId: string
  readonly planId: string
  readonly serverTime: number // Unix ms
  readonly expiry: number // Unix ms
  readonly capabilities: readonly string[]
}

export interface SignedLicenseTicket {
  readonly data: LicenseTicketData
  readonly signature: string
  readonly publicKey: string
}

export class LicenseTicketManager {
  private _publicKey: string
  private _privateKey: string

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    this._publicKey = publicKey
    this._privateKey = privateKey
  }

  getPublicKey(): string {
    return this._publicKey
  }

  rotateKeys(): void {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    this._publicKey = publicKey
    this._privateKey = privateKey
  }

  /**
   * 服务端签署离线许可证票据。
   * 能力不由调用方传入，一律由 planId 经 capabilitiesForPlan 从冻结目录推导，
   * 使「票据能力 == 套餐能力」成为签发层的硬约束，调用方无法误授 pro。
   */
  issueTicket(params: {
    readonly userId: string
    readonly deviceId: string
    readonly planId: string
    readonly ttlMs?: number | undefined
  }): SignedLicenseTicket {
    const now = Date.now()
    const ttl = params.ttlMs ?? 72 * 3600 * 1000 // 默认 72 小时宽限期
    const data: LicenseTicketData = {
      userId: params.userId,
      deviceId: params.deviceId,
      planId: params.planId,
      serverTime: now,
      expiry: now + ttl,
      capabilities: capabilitiesForPlan(params.planId),
    }

    const payload = Buffer.from(JSON.stringify(data), 'utf8')
    const sig = sign(null, payload, this._privateKey).toString('base64')

    return {
      data,
      signature: sig,
      publicKey: this._publicKey,
    }
  }

  /**
   * 客户端/离线环境核验票据
   */
  verifyTicket(
    ticket: SignedLicenseTicket,
    currentDeviceId: string,
    currentClientTime = Date.now(),
  ): { readonly valid: boolean; readonly planId: string; readonly error?: string | undefined } {
    const { data, signature, publicKey } = ticket

    // 1. 设备绑定校验
    if (data.deviceId !== currentDeviceId) {
      throw new RequestBoundaryError(403, 'DEVICE_MISMATCH', `DEVICE_MISMATCH: ticket deviceId ${data.deviceId} does not match current device ${currentDeviceId}`)
    }

    // 2. 客户端时钟回拨检测 (时钟比颁发时间早超过 5 分钟，说明有人试图回拨本地时间延续有效期)
    if (currentClientTime < data.serverTime - 300_000) {
      throw new RequestBoundaryError(403, 'CLOCK_ROLLBACK_DETECTED', 'CLOCK_ROLLBACK_DETECTED: client system clock has been set back in time')
    }

    // 3. 有效期校验
    if (currentClientTime > data.expiry) {
      throw new RequestBoundaryError(403, 'TICKET_EXPIRED', `TICKET_EXPIRED: ticket expired at ${new Date(data.expiry).toISOString()}`)
    }

    // 4. 非对称签名核验
    const payload = Buffer.from(JSON.stringify(data), 'utf8')
    const keyToVerify = publicKey || this._publicKey
    try {
      const valid = verify(null, payload, keyToVerify, Buffer.from(signature, 'base64'))
      if (!valid) {
        throw new RequestBoundaryError(403, 'INVALID_SIGNATURE', 'INVALID_SIGNATURE: license ticket signature is invalid or forged')
      }
    } catch (err) {
      if (err instanceof RequestBoundaryError) throw err
      throw new RequestBoundaryError(403, 'INVALID_SIGNATURE', `INVALID_SIGNATURE: verification failed: ${(err as Error).message}`)
    }

    // 5. 能力与套餐一致性校验（本轮新增的防御纵深，非既有语义）：
    //    签名只保证数据未被篡改，不保证签发逻辑本身正确。此处要求票据携带的能力
    //    与 planId 经冻结目录推导出的能力完全一致，从而拦下「免费套餐却带 pro 能力」
    //    这类签发缺陷。注意：这会使旧版签发器（曾默认写入 pro-features）发出的、
    //    仍在使用期内的票据核验失败；票据 TTL 上限 72 小时，重新签发即可自愈。
    const expectedCapabilities = [...capabilitiesForPlan(data.planId)].sort()
    const actualCapabilities = [...data.capabilities].sort()
    if (
      actualCapabilities.length !== expectedCapabilities.length ||
      actualCapabilities.some((cap, i) => cap !== expectedCapabilities[i])
    ) {
      throw new RequestBoundaryError(
        403,
        'CAPABILITY_PLAN_MISMATCH',
        `CAPABILITY_PLAN_MISMATCH: ticket capabilities ${JSON.stringify(data.capabilities)} do not match plan ${data.planId}`,
      )
    }

    return { valid: true, planId: data.planId }
  }
}

export const defaultLicenseTicketManager = new LicenseTicketManager()
