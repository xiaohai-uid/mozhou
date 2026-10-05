/**
 * 墨舟正式版定价目录与公开模型（T02 冻结 · 唯一真源）。
 *
 * 移入 shared/：供 UI 与 server 共享引用，完全 browser-safe，不接触支付验签与数据库存储。
 */
export type PlanId = 'pro_monthly' | 'max_monthly'
export type Currency = 'CNY'

export const CATALOG_VERSION = '2026-09-15.1'

/** Pro 解锁的全部高级软件能力（服务端裁决唯一来源）；Max 在 Pro 之上增加官方调用额度。 */
export const PRO_ENTITLEMENT_KEYS = [
  'style-distill',
  'novel-breakdown',
  'storyboard',
  'skills-library',
  'material-search',
  'web-search',
  'rankings',
  'deep-review',
  'task-center',
] as const

/** 永不因付费到期/退款锁死的基础能力（SPEC：阅读、手动编辑、导出、备份永远可用）。 */
export const BASIC_ALWAYS_AVAILABLE = ['create-book', 'read', 'write', 'export-own', 'backup-restore'] as const

export interface MonthlyPlan {
  readonly planId: PlanId
  readonly name: string
  readonly amountFen: number
  readonly currency: Currency
  readonly entitlementKeys: readonly string[]
}

export interface ManagedBudget {
  /** 每月模型成本经营保护上限（分）。初始建议 1500；T18 实测后重估并更换版本。 */
  readonly modelBudgetFenPerMonth: number
  /** T18 实测的单次调用 p95 成本（分）。null = 尚无真实成本数据，禁止销售。 */
  readonly p95CallFen: number | null
  /** 每任务最多上游尝试次数（结构化修复另受 3 次总尝试限制）。 */
  readonly maxRetries: number
  /** 单请求最大输入 tokens（最坏成本计算上界）。 */
  readonly maxInputTokensPerCall: number
  /** 单请求最大输出 tokens（最坏成本计算上界）。 */
  readonly maxOutputTokensPerCall: number
  /** T18 实测单价（分/百万 tokens）。null = 未实测。 */
  readonly pricePerMTokenFen: number | null
}

export interface BillingCatalog {
  readonly version: string
  readonly currency: Currency
  readonly basicAlwaysAvailable: readonly string[]
  readonly pro: MonthlyPlan
  readonly max: MonthlyPlan
  readonly managed: {
    readonly sellable: boolean
    readonly includedCallsPerMonth: number | null
    readonly worstCasePerCallFen: number | null
    readonly budget: ManagedBudget
  }
}

const BUDGET: ManagedBudget = {
  modelBudgetFenPerMonth: 1500,
  p95CallFen: null,
  maxRetries: 3,
  maxInputTokensPerCall: 32_000,
  maxOutputTokensPerCall: 8_000,
  pricePerMTokenFen: null,
}

export const billingCatalog: BillingCatalog = Object.freeze({
  version: CATALOG_VERSION,
  currency: 'CNY',
  basicAlwaysAvailable: Object.freeze([...BASIC_ALWAYS_AVAILABLE]),
  pro: Object.freeze({
    planId: 'pro_monthly',
    name: '墨舟 Pro 月费',
    amountFen: 1900,
    currency: 'CNY',
    entitlementKeys: Object.freeze([...PRO_ENTITLEMENT_KEYS]),
  }),
  max: Object.freeze({
    planId: 'max_monthly',
    name: '墨舟 Max 月费',
    amountFen: 3900,
    currency: 'CNY',
    entitlementKeys: Object.freeze([...PRO_ENTITLEMENT_KEYS, 'managed-model-quota']),
  }),
  managed: Object.freeze({
    sellable: false,
    includedCallsPerMonth: null,
    worstCasePerCallFen: null,
    budget: Object.freeze({ ...BUDGET }),
  }),
})
