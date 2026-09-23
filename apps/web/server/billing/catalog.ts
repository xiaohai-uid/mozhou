/**
 * 墨舟正式版定价目录（T02 冻结 · 唯一真源）：
 * - 价格只在此处保存一次：pro_monthly=1900 / max_monthly=3900 / CNY。
 *   UI、账单、额度全部从 /api/billing/catalog（或本目录导出）读取，客户端不可覆盖价款。
 * - 基础能力（建书/阅读/手写/导出自己的作品/备份恢复）永远可用，不挂在任何付费权益下。
 * - Max 的官方调用额度：p95CallFen 未实测（null）时 includedCallsPerMonth=null、
 *   sellable=false——本 catalog 的消费方一律不得对外销售 Max；T18 用真实成本
 *   替换参数并变更 CATALOG_VERSION 后重新验证。严禁把任何竞品数字直接当最终额度。
 * - 每月模型成本上限 1500 分只是初始经营保护建议（proposed_defaults），不是销售承诺。
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

export interface MaxIncludedCallsInput {
  readonly priceFen: number
  readonly feeFen: number
  readonly taxReserveFen: number
  readonly infraReserveFen: number
  readonly modelBudgetFen: number
  readonly p95CallFen: number
}

/**
 * 封顶官方调用次数 = 可花模型预算 ÷ p95 单次成本（向下取整）。
 * 未实测成本（p95CallFen<=0）或无可花余量时直接拒绝，绝不出 0 或负额度销售。
 * 该公式只在 T18 提供真实成本参数后进入 catalog 并对外销售。
 */
export function maxIncludedCalls(input: MaxIncludedCallsInput): number {
  const { priceFen, feeFen, taxReserveFen, infraReserveFen, modelBudgetFen, p95CallFen } = input
  for (const v of [priceFen, feeFen, taxReserveFen, infraReserveFen, modelBudgetFen, p95CallFen]) {
    if (!Number.isFinite(v) || v < 0) throw new Error('INVALID_COST_INPUT')
  }
  if (p95CallFen <= 0) throw new Error('MISSING_REAL_COST')
  const spendable = Math.min(modelBudgetFen, priceFen - feeFen - taxReserveFen - infraReserveFen)
  if (spendable <= 0) throw new Error('NO_POSITIVE_MARGIN')
  return Math.floor(spendable / p95CallFen)
}

/** 单请求最坏成本（分）：按最大输入+输出 tokens × 单价 × (1+最大重试次数) 上界估算。 */
export function worstCasePerCallFen(budget: ManagedBudget): number {
  const { pricePerMTokenFen, maxInputTokensPerCall, maxOutputTokensPerCall, maxRetries } = budget
  if (pricePerMTokenFen === null || pricePerMTokenFen < 0) throw new Error('MISSING_REAL_COST')
  const tokens = maxInputTokensPerCall + maxOutputTokensPerCall
  return ((tokens / 1_000_000) * pricePerMTokenFen * (1 + maxRetries) * 100) / 100
}

/** 未实测成本时拒绝对外销售：构造可售 managed 段（抛错或返回不可售 catalog）。 */
export function buildSellableManaged(budget: ManagedBudget, input: MaxIncludedCallsInput): Pick<BillingCatalog, 'managed'> {
  const calls = maxIncludedCalls(input)
  const worst = worstCasePerCallFen(budget)
  const spendable = Math.min(input.modelBudgetFen, input.priceFen - input.feeFen - input.taxReserveFen - input.infraReserveFen)
  if (worst > spendable) throw new Error('WORST_CASE_EXCEEDS_MARGIN')
  return {
    managed: Object.freeze({
      sellable: true,
      includedCallsPerMonth: calls,
      worstCasePerCallFen: worst,
      budget: Object.freeze({ ...budget }),
    }),
  }
}

/**
 * 权益周期：UTC 自然月，月末钳制（1月31日开档 → 2月末 23:59:59Z）。
 * 规则：start + 1 个日历月；若该日不存在（如 2月31日）则钳制到该月最后一天。
 * 同一订单（同 planId + 同 start）周期确定不变——订单权益不重复延长。
 */
export function monthPeriodEnd(startIso: string): string {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) throw new Error('INVALID_PERIOD_START')
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth() // 0-based
  const day = start.getUTCDate()
  // 下月最后一天（month+2 月的第 0 日 = 下月最后一日）；day 溢出则钳制
  const nextMonthLastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate()
  const endDay = Math.min(day, nextMonthLastDay)
  return new Date(Date.UTC(year, month + 1, endDay, 23, 59, 59)).toISOString()
}

/** 同订单（planId + start）的固定周期三元组：周期不因重复请求变化。 */
export function orderPeriodFor(planId: PlanId, startIso: string): Readonly<{ periodStart: string; periodEnd: string; priceVersion: string }> {
  return Object.freeze({ periodStart: startIso, periodEnd: monthPeriodEnd(startIso), priceVersion: CATALOG_VERSION })
}