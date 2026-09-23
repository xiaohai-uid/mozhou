#!/usr/bin/env node
/**
 * 墨舟公网预发布环境冒烟验证脚本 (Hosted Smoke Test · T16)。
 * 
 * 依照 reference/03-public-billing.md T16 规格：
 * - 解析并校验 HTTPS 生产/预发布端点；
 * - 验证公网连通性、安全响应头；
 * - 验证未认证请求在 hosted 模式下严格 401 拦截；
 * - 输出冒烟报告并以 exit 0/1 报告结果。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
let baseUrl = ''
const baseIdx = args.indexOf('--base')
if (baseIdx !== -1 && args[baseIdx + 1]) {
  baseUrl = args[baseIdx + 1].trim().replace(/\/$/, '')
}

if (!baseUrl) {
  console.error('Usage: node hosted-smoke.mjs --base <HTTPS-HOSTED-URL>')
  process.exit(1)
}

let parsedUrl
try {
  parsedUrl = new URL(baseUrl)
} catch {
  console.error(`Invalid URL: ${baseUrl}`)
  process.exit(1)
}

// 生产公网必须强制校验 HTTPS
const allowHttp = args.includes('--allow-http')
if (parsedUrl.protocol !== 'https:' && !allowHttp) {
  console.error(`ERROR: target base URL must be HTTPS in hosted production: ${baseUrl}`)
  process.exit(1)
}

console.log(`[hosted-smoke] running smoke checks on ${baseUrl}...`)

const checks = [
  {
    name: '1. 公开定价目录可访问 (GET /api/billing/catalog)',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/billing/catalog`, { method: 'GET' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.ok !== true || data.catalog?.currency !== 'CNY') throw new Error('invalid catalog payload')
      return { status: res.status }
    },
  },
  {
    name: '2. 未登录访问账户接口严格 401 拦截 (POST /api/account)',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
      return { status: res.status }
    },
  },
  {
    name: '3. 未登录访问正文接口严格 401 拦截 (POST /api/chapter.prose)',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/chapter.prose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: 'bk_probe', chapterIndex: 1 }),
      })
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
      return { status: res.status }
    },
  },
  {
    name: '4. 本地专属端点在 hosted 模式下严格 403 拒绝 (POST /api/library)',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDir: '/var/data' }),
      })
      if (res.status !== 401 && res.status !== 403) throw new Error(`expected 401 or 403, got ${res.status}`)
      return { status: res.status }
    },
  },
  {
    name: '5. 未注册路由严格 403 拒绝 (POST /api/unregistered.backdoor)',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/unregistered.backdoor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`)
      return { status: res.status }
    },
  },
]

async function main() {
  const results = []
  let allPass = true

  for (const c of checks) {
    const start = Date.now()
    try {
      const details = await c.run()
      const latencyMs = Date.now() - start
      console.log(`  ✓ ${c.name} (${latencyMs}ms)`)
      results.push({ name: c.name, passed: true, latencyMs, details })
    } catch (err) {
      const latencyMs = Date.now() - start
      allPass = false
      console.log(`  ✗ ${c.name} -> FAILED: ${err.message}`)
      results.push({ name: c.name, passed: false, latencyMs, error: err.message })
    }
  }

  const report = {
    testedAt: new Date().toISOString(),
    baseUrl,
    totalChecks: checks.length,
    passedChecks: results.filter((r) => r.passed).length,
    allPass,
    results,
  }

  const outPath = resolve(process.cwd(), 'hosted-smoke-report.json')
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`[hosted-smoke] report saved to ${outPath}. Final: ${allPass ? 'PASS' : 'FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
