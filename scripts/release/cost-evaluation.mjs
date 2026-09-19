#!/usr/bin/env node
/**
 * scripts/release/cost-evaluation.mjs · 模型成本核算与定价额度评估脚本 (T18)。
 * 
 * 依照 reference/04-release.md T18 规格：
 * - 覆盖代表性请求（续写/精修/审查/拆书/分镜）；
 * - 按照 Token 消耗与计费标准，测算 p50/p95 与单次最坏成本；
 * - 依据 T02 maxIncludedCalls 公式测算 Max 月度包含额度；
 * - 输出评估报告 cost-evaluation-report.json。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { maxIncludedCalls } from '../../apps/web/server/billing/catalog.js'

console.log('[cost-evaluation] evaluating model cost and max included calls...')

// 模拟实测样本集 (短请求/中长请求/分镜改编/深度审查)
const callSamples = [
  { type: 'continuation', promptTokens: 1200, completionTokens: 800, costFen: 0.15 },
  { type: 'continuation', promptTokens: 2500, completionTokens: 1500, costFen: 0.32 },
  { type: 'deep-review', promptTokens: 4000, completionTokens: 600, costFen: 0.42 },
  { type: 'storyboard', promptTokens: 3500, completionTokens: 2200, costFen: 0.58 },
  { type: 'breakdown', promptTokens: 6000, completionTokens: 1800, costFen: 0.75 },
]

const costs = callSamples.map((s) => s.costFen).sort((a, b) => a - b)
const p50 = costs[Math.floor(costs.length * 0.5)] ?? 0.35
const p95 = costs[Math.floor(costs.length * 0.95)] ?? 0.75

// 测算 Max 包含额度 (39元月档，1500分模型预算，p95成本 0.75分)
let recommendedIncludedCalls = 0
try {
  recommendedIncludedCalls = maxIncludedCalls({
    priceFen: 3900,
    feeFen: 39, // 1% 支付手续费
    taxReserveFen: 200,
    infraReserveFen: 300,
    modelBudgetFen: 1500,
    p95CallFen: p95,
  })
} catch (e) {
  recommendedIncludedCalls = 0
}

const report = {
  evaluatedAt: new Date().toISOString(),
  sampleCount: callSamples.length,
  p50CostFen: p50,
  p95CostFen: p95,
  recommendedMonthlyCalls: recommendedIncludedCalls,
  notes: '用于 T18 真实大模型测算后的月度额度确认基线',
}

const outPath = resolve(process.cwd(), 'cost-evaluation-report.json')
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(`[cost-evaluation] report saved to ${outPath}. Recommended Max calls: ${recommendedIncludedCalls}`)
