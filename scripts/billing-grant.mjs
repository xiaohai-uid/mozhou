/**
 * scripts/billing-grant.mjs
 *
 * 墨舟运营 · 员工测试账户会员权益授予脚本（无新 HTTP 端面）。
 *
 * 依据 2026-10-24 发布就绪度评审：权益发放此前唯一入口是真实支付订单
 * （grants_once_per_order 唯一索引履约），员工测试账户没有授权通道。
 * 本脚本复用服务端 BillingStore（dist-server 产物，与 `serve` 同源），
 * 不复制任何定价、周期与 Schema 逻辑。
 *
 * 用法（先构建：pnpm --filter @mozhou/web build）：
 *   node scripts/billing-grant.mjs --user-id usr_xxx --plan max_monthly [--days 30]
 *   node scripts/billing-grant.mjs --email ops@company.com --plan pro_monthly
 *
 * - --email 通过数据根 users/<userId>/profile.json 解析 userId（仅覆盖创建过作品、
 *   本地留有档案的账号）；解析失败时从 Supabase 控制台取 userId 改用 --user-id。
 * - 数据根与生产服务端同口径：MOZHOU_DATA_ROOT 环境变量优先，缺省 <cwd>/.mozhou_data。
 *   必须与目标服务端使用同一数据根，否则授予会写进另一个 billing.sqlite。
 * - 授予记录 order_id 带 manual_ 前缀，可在 billing.sqlite 里检索审计。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))

function fail(message) {
  console.error(`[billing-grant] ${message}`)
  process.exit(2)
}

if (!existsSync(resolve(scriptDir, '../apps/web/dist-server/billing/store.js'))) {
  fail('未找到 apps/web/dist-server/billing/store.js —— 先运行 pnpm --filter @mozhou/web build')
}

const { BillingStore } = await import('../apps/web/dist-server/billing/store.js')
const { resolveDefaultDataRoot } = await import('../apps/web/dist-server/dataRoot.js')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      fail(`参数 ${key} 缺少值`)
    }
    args[key.slice(2)] = value
    i++
  }
  return args
}

function resolveUserIdByEmail(dataRoot, email) {
  const usersDir = join(dataRoot, 'users')
  if (!existsSync(usersDir)) return null
  const normalized = email.trim().toLowerCase()
  for (const entry of readdirSync(usersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const profilePath = join(usersDir, entry.name, 'profile.json')
    if (!existsSync(profilePath)) continue
    try {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
      if (
        typeof profile.email === 'string' &&
        profile.email.trim().toLowerCase() === normalized &&
        typeof profile.id === 'string'
      ) {
        return profile.id
      }
    } catch {
      // 单个档案损坏不阻断扫描
    }
  }
  return null
}

const args = parseArgs(process.argv.slice(2))
const dataRoot = args['data-root'] ? resolve(args['data-root']) : resolveDefaultDataRoot()
const planId = args['plan']
const daysRaw = args['days']
const email = args['email'] ?? null
let userId = args['user-id'] ?? null

if (!userId && !email) {
  fail('必须提供 --user-id 或 --email')
}
if (!planId) {
  fail('必须提供 --plan（pro_monthly | max_monthly）')
}

if (!userId && email) {
  userId = resolveUserIdByEmail(dataRoot, email)
  if (!userId) {
    fail(`数据根 ${dataRoot} 下未找到 email=${email} 的账号档案；请从 Supabase 控制台取 userId 后用 --user-id 重试`)
  }
}

const store = new BillingStore()
store.setDatabasePath(join(dataRoot, 'billing.sqlite'))
try {
  const grant = store.grantManualEntitlement({
    userId,
    planId,
    ...(daysRaw !== undefined ? { durationDays: Number(daysRaw) } : {}),
  })
  console.log('已授予会员权益：')
  console.log(JSON.stringify(grant, null, 2))
  console.log(`数据根：${dataRoot}`)
  console.log('order_id 带 manual_ 前缀 = 运营手动授予，与支付履约单区分；可在 billing.sqlite 按前缀检索审计。')
} catch (err) {
  console.error(`[billing-grant] 授予失败：${err.message}`)
  process.exit(1)
} finally {
  store.close()
}
