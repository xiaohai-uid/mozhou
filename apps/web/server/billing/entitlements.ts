/**
 * apps/web/server/billing · 统一权益判定与能力访问控制 (Entitlements · T15)。
 * 
 * 依照 reference/03-public-billing.md T15 规格：
 * - 单一 capability → requiredEntitlement 映射；
 * - 基础能力（建书、手写、阅读、导出、备份恢复）恒久免费开放，永不锁死；
 * - 高级能力（分镜、风格蒸馏、小说拆解、深度审查等）必须服务端实时核验有效会期权益；
 * - 严禁信任客户端提交的 localStorage.vip / plan 标识。
 */
import { defaultBillingStore, BillingStore } from './store.js'
import {
  BASIC_ALWAYS_AVAILABLE,
  PRO_ENTITLEMENT_KEYS,
} from './catalog.js'
import { RequestBoundaryError } from '../security.js'
import { defaultBookAccessManager } from '../bookAccess.js'

export const CAPABILITY_ENTITLEMENT_MAP: Readonly<Record<string, string>> = Object.freeze({
  'storyboard': 'storyboard',
  'style-distill': 'style-distill',
  'novel-breakdown': 'novel-breakdown',
  'deep-review': 'deep-review',
  'skills-library': 'skills-library',
  'material-search': 'material-search',
  'web-search': 'web-search',
  'rankings': 'rankings',
  'task-center': 'task-center',
  'managed-model-quota': 'managed-model-quota',
})

/**
 * 判断指定能力是否为永不锁死的基础能力。
 */
export function isBasicAlwaysAvailable(capability: string): boolean {
  return (BASIC_ALWAYS_AVAILABLE as readonly string[]).includes(capability)
}

export interface EntitlementCheckResult {
  readonly entitled: boolean
  readonly planId: string | null
  readonly capability: string
  readonly reason?: string | undefined
}

export class EntitlementManager {
  checkUserEntitled(
    userId: string,
    capability: string,
    store: BillingStore = defaultBillingStore,
  ): EntitlementCheckResult {
    // 1. 基础能力永远放行
    if (isBasicAlwaysAvailable(capability)) {
      return { entitled: true, planId: 'free', capability }
    }

    const requiredEntitlement = CAPABILITY_ENTITLEMENT_MAP[capability]
    if (!requiredEntitlement) {
      // 未知能力默认拒绝
      return { entitled: false, planId: null, capability, reason: `unknown capability: ${capability}` }
    }

    // 2. 本地单机开发模式：非 hosted 模式下允许本地免费探索
    if (!defaultBookAccessManager.isHostedMode()) {
      return { entitled: true, planId: 'local_dev', capability }
    }

    if (!userId || userId === 'anonymous') {
      return { entitled: false, planId: null, capability, reason: 'authentication required' }
    }

    // 3. 查询用户当前的有效履约记录
    const grant = store.getActiveGrantForUser(userId)
    if (!grant) {
      return {
        entitled: false,
        planId: 'free',
        capability,
        reason: 'no active subscription grant found for user',
      }
    }

    // 4. 检查用户计划是否覆盖目标权益
    if (grant.planId === 'pro_monthly') {
      const allowed = (PRO_ENTITLEMENT_KEYS as readonly string[]).includes(requiredEntitlement)
      return {
        entitled: allowed,
        planId: grant.planId,
        capability,
        reason: allowed ? undefined : `capability ${capability} requires Max plan`,
      }
    }

    if (grant.planId === 'max_monthly') {
      const allowed =
        (PRO_ENTITLEMENT_KEYS as readonly string[]).includes(requiredEntitlement) ||
        requiredEntitlement === 'managed-model-quota'
      return {
        entitled: allowed,
        planId: grant.planId,
        capability,
        reason: allowed ? undefined : `capability ${capability} not included in Max plan`,
      }
    }

    return {
      entitled: false,
      planId: grant.planId,
      capability,
      reason: `unrecognized plan: ${String(grant.planId)}`,
    }
  }

  assertUserEntitled(
    userId: string,
    capability: string,
    store: BillingStore = defaultBillingStore,
  ): void {
    const result = this.checkUserEntitled(userId, capability, store)
    if (!result.entitled) {
      throw new RequestBoundaryError(
        403,
        'ENTITLEMENT_REQUIRED',
        `ENTITLEMENT_REQUIRED: ${result.reason ?? `capability ${capability} requires active subscription`}`,
      )
    }
  }
}

export const defaultEntitlementManager = new EntitlementManager()
