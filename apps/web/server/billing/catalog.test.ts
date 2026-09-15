import { describe, expect, it } from 'vitest'
import {
  billingCatalog,
  buildSellableManaged,
  CATALOG_VERSION,
  maxIncludedCalls,
  monthPeriodEnd,
  orderPeriodFor,
  worstCasePerCallFen,
  type ManagedBudget,
} from './catalog.js'

describe('billingCatalog（T02 冻结）', () => {
  it('19/39 价格固定为 1900/3900 分 CNY，且目录整体不可被客户端覆盖', () => {
    expect(billingCatalog.pro.planId).toBe('pro_monthly')
    expect(billingCatalog.pro.amountFen).toBe(1900)
    expect(billingCatalog.max.planId).toBe('max_monthly')
    expect(billingCatalog.max.amountFen).toBe(3900)
    expect(billingCatalog.currency).toBe('CNY')
    expect(Object.isFrozen(billingCatalog)).toBe(true)
    expect(Object.isFrozen(billingCatalog.pro)).toBe(true)
    expect(Object.isFrozen(billingCatalog.max)).toBe(true)
  })

  it('删除永久/团队占位商品：目录只有 free 基础 + pro_monthly + max_monthly 两个付费档', () => {
    const entries = [billingCatalog.pro, billingCatalog.max]
    for (const plan of entries) {
      expect(plan.planId).not.toMatch(/lifetime|team/)
      expect(plan.currency).toBe('CNY')
    }
  })

  it('基础能力（阅读/手动编辑/导出/备份）不在任何付费 entitlementKeys 中——到期不锁死作品', () => {
    const paid = new Set([...billingCatalog.pro.entitlementKeys, ...billingCatalog.max.entitlementKeys])
    for (const key of billingCatalog.basicAlwaysAvailable) {
      expect(paid.has(key), `基础能力 ${key} 不应出现在付费权益中`).toBe(false)
    }
    expect(billingCatalog.basicAlwaysAvailable).toContain('read')
    expect(billingCatalog.basicAlwaysAvailable).toContain('write')
    expect(billingCatalog.basicAlwaysAvailable).toContain('export-own')
    expect(billingCatalog.basicAlwaysAvailable).toContain('backup-restore')
  })

  it('Max 在 Pro 之上增加 managed-model-quota 权益', () => {
    expect(billingCatalog.max.entitlementKeys).toContain('managed-model-quota')
    const proOnly = billingCatalog.pro.entitlementKeys
    expect(proOnly).not.toContain('managed-model-quota')
  })

  it('未实测成本时 Max 不可售：includedCallsPerMonth=null、sellable=false、版本可追溯', () => {
    expect(billingCatalog.managed.sellable).toBe(false)
    expect(billingCatalog.managed.includedCallsPerMonth).toBeNull()
    expect(billingCatalog.managed.worstCasePerCallFen).toBeNull()
    expect(billingCatalog.managed.budget.p95CallFen).toBeNull()
    expect(billingCatalog.version).toBe(CATALOG_VERSION)
  })

  it('每月模型成本上限初始为 1500 分经营保护建议（非销售承诺），且带最坏成本上界参数', () => {
    expect(billingCatalog.managed.budget.modelBudgetFenPerMonth).toBe(1500)
    expect(billingCatalog.managed.budget.maxRetries).toBeGreaterThanOrEqual(1)
    expect(billingCatalog.managed.budget.maxInputTokensPerCall).toBeGreaterThan(0)
    expect(billingCatalog.managed.budget.maxOutputTokensPerCall).toBeGreaterThan(0)
  })
})

describe('maxIncludedCalls（成本合同纯计算）', () => {
  it('fixture：价格3900、总预留1000、模型预算1500、p95成本5分 → 300次', () => {
    expect(
      maxIncludedCalls({ priceFen: 3900, feeFen: 500, taxReserveFen: 200, infraReserveFen: 300, modelBudgetFen: 1500, p95CallFen: 5 }),
    ).toBe(300)
  })

  it('负数/NaN/Infinity 成本输入一律拒绝', () => {
    expect(() =>
      maxIncludedCalls({ priceFen: -1, feeFen: 0, taxReserveFen: 0, infraReserveFen: 0, modelBudgetFen: 100, p95CallFen: 1 }),
    ).toThrow('INVALID_COST_INPUT')
    expect(() =>
      maxIncludedCalls({ priceFen: 3900, feeFen: Number.NaN, taxReserveFen: 0, infraReserveFen: 0, modelBudgetFen: 100, p95CallFen: 1 }),
    ).toThrow('INVALID_COST_INPUT')
    expect(() =>
      maxIncludedCalls({ priceFen: 3900, feeFen: 0, taxReserveFen: 0, infraReserveFen: 0, modelBudgetFen: Number.POSITIVE_INFINITY, p95CallFen: 1 }),
    ).toThrow('INVALID_COST_INPUT')
    expect(() =>
      maxIncludedCalls({ priceFen: 3900, feeFen: 0, taxReserveFen: 0, infraReserveFen: 0, modelBudgetFen: 100, p95CallFen: -2 }),
    ).toThrow('INVALID_COST_INPUT')
  })

  it('p95 成本为 0 或缺失 → MISSING_REAL_COST（无实测数据不销售）', () => {
    expect(() =>
      maxIncludedCalls({ priceFen: 3900, feeFen: 0, taxReserveFen: 0, infraReserveFen: 0, modelBudgetFen: 100, p95CallFen: 0 }),
    ).toThrow('MISSING_REAL_COST')
  })

  it('售价扣预留后无可花余量 → NO_POSITIVE_MARGIN', () => {
    expect(() =>
      maxIncludedCalls({ priceFen: 500, feeFen: 300, taxReserveFen: 200, infraReserveFen: 200, modelBudgetFen: 100, p95CallFen: 5 }),
    ).toThrow('NO_POSITIVE_MARGIN')
  })

  it('模型预算低于售价-预留时以模型预算为可花上限', () => {
    expect(
      maxIncludedCalls({ priceFen: 3900, feeFen: 300, taxReserveFen: 100, infraReserveFen: 100, modelBudgetFen: 1000, p95CallFen: 5 }),
    ).toBe(200) // min(1000, 3400)/5
  })
})

describe('最坏成本上界（T02 经营保护）', () => {
  const realBudget: ManagedBudget = {
    modelBudgetFenPerMonth: 1500,
    p95CallFen: 5,
    maxRetries: 2,
    maxInputTokensPerCall: 32_000,
    maxOutputTokensPerCall: 8_000,
    pricePerMTokenFen: 5, // 5 分/百万 tokens（示意；T18 用真实值）
  }

  it('按最大 tokens × 单价 × (1+重试上界) 计算，绝不低于单次成本', () => {
    const worst = worstCasePerCallFen(realBudget)
    // (32000+8000)/1e6 * 5 * 3 = 0.6 分
    expect(worst).toBeCloseTo(0.6, 10)
    expect(worst).toBeGreaterThan(0)
  })

  it('p95 未实测时最坏成本计算拒绝（不产生可售数值）', () => {
    expect(() => worstCasePerCallFen({ ...realBudget, pricePerMTokenFen: null })).toThrow('MISSING_REAL_COST')
  })

  it('最坏成本超过可花余量时不可售（WORST_CASE_EXCEEDS_MARGIN）', () => {
    expect(() =>
      buildSellableManaged(
        { ...realBudget, pricePerMTokenFen: 50_000 }, // 每百万 tokens 50000 分 → 最坏 0.04*50000*3=6000 分 > 余量 1500
        { priceFen: 3900, feeFen: 300, taxReserveFen: 100, infraReserveFen: 100, modelBudgetFen: 1500, p95CallFen: 5 },
      ),
    ).toThrow('WORST_CASE_EXCEEDS_MARGIN')
  })

  it('实测成本齐备且最坏成本可覆盖时才能构造可售 managed 段', () => {
    const sellable = buildSellableManaged(
      realBudget,
      { priceFen: 3900, feeFen: 300, taxReserveFen: 100, infraReserveFen: 100, modelBudgetFen: 1500, p95CallFen: 5 },
    )
    expect(sellable.managed.sellable).toBe(true)
    expect(sellable.managed.includedCallsPerMonth).toBe(300)
    expect(sellable.managed.worstCasePerCallFen).toBeCloseTo(0.6, 10)
  })
})

describe('月末续费与同订单固定周期（C4 period 合同）', () => {
  it('1月31日开档 → 2月28日 23:59:59Z 结束（非闰年月末钳制）', () => {
    expect(monthPeriodEnd('2026-01-31T12:00:00Z')).toBe('2026-02-28T23:59:59.000Z')
  })

  it('闰年 2 月按 29 天钳制', () => {
    expect(monthPeriodEnd('2024-01-31T00:00:00Z')).toBe('2024-02-29T23:59:59.000Z')
  })

  it('12 月开档跨年：下月同日结束', () => {
    expect(monthPeriodEnd('2026-12-15T00:00:00Z')).toBe('2027-01-15T23:59:59.000Z')
  })

  it('月中开档不钳制（15日 → 次月15日）', () => {
    expect(monthPeriodEnd('2026-09-15T00:00:00Z')).toBe('2026-10-15T23:59:59.000Z')
  })

  it('同一订单（同 planId + start）周期三元组确定不变——权益不重复延长', () => {
    const a = orderPeriodFor('max_monthly', '2026-09-15T00:00:00Z')
    const b = orderPeriodFor('max_monthly', '2026-09-15T00:00:00Z')
    expect(a).toEqual(b)
    expect(a.periodEnd).toBe('2026-10-15T23:59:59.000Z')
    expect(a.priceVersion).toBe(CATALOG_VERSION)
    // 不同订单（不同 start）不得有相同周期
    const c = orderPeriodFor('max_monthly', '2026-10-15T00:00:00Z')
    expect(c.periodStart).not.toBe(a.periodStart)
  })

  it('非法开始时间拒绝', () => {
    expect(() => monthPeriodEnd('not-a-date')).toThrow('INVALID_PERIOD_START')
  })
})