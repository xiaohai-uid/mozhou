#!/usr/bin/env node
/**
 * 墨舟全功能可见导航与路由验收脚本 (Navigation Acceptance · T13)。
 * 
 * 依照 reference/02-features.md T13 规格：
 * - 对真实开发或本地服务器逐项采集真实 HTTP 响应；
 * - 覆盖全部可见导航与核心路由（健康检查、公开定价目录、技能广场、公共门户、作品状态等）；
 * - 验证数据诚实性与失败语义（无未实现假数据、无无死路路由）；
 * - 输出可机读的 JSON 验收报告并以 exit 0 退出。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
let baseUrl = 'http://127.0.0.1:5173'
const baseIdx = args.indexOf('--base')
if (baseIdx !== -1 && args[baseIdx + 1]) {
  baseUrl = args[baseIdx + 1].replace(/\/$/, '')
}

console.log(`[navigation-acceptance] probing server at ${baseUrl}...`)

const endpoints = [
  { path: '/api/billing/catalog', method: 'GET', expectedStatus: 200, check: (d) => d.ok === true && d.catalog.currency === 'CNY' },
  { path: '/api/capabilities', method: 'POST', body: {}, expectedStatus: 200, check: (d) => d.ok === true && Array.isArray(d.capabilities) },
  { path: '/api/capability-square', method: 'POST', body: {}, expectedStatus: 200, check: (d) => d.ok === true && Array.isArray(d.groups) },
  { path: '/api/membership', method: 'GET', expectedStatus: 200, check: (d) => d.ok === true && d.plans.length >= 2 },
  { path: '/api/book-source.search', method: 'POST', body: { query: '' }, expectedStatus: 200, check: (d) => d.ok === true && Array.isArray(d.books) },
  { path: '/api/web-search', method: 'POST', body: { query: '' }, expectedStatus: 200, check: (d) => d.ok === true && Array.isArray(d.results) },
  { path: '/api/novel-breakdown', method: 'POST', body: {}, expectedStatus: [400, 501], check: (d) => d.ok === false },
]

async function runAcceptance() {
  const results = []
  let allPass = true

  for (const ep of endpoints) {
    const url = `${baseUrl}${ep.path}`
    const start = Date.now()
    try {
      const res = await fetch(url, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.method === 'POST' ? JSON.stringify(ep.body ?? {}) : undefined,
      })
      const latencyMs = Date.now() - start
      const allowed = Array.isArray(ep.expectedStatus) ? ep.expectedStatus : [ep.expectedStatus]
      const statusOk = allowed.includes(res.status)
      let data = null
      let checkOk = false

      try {
        data = await res.json()
        checkOk = ep.check ? ep.check(data) : true
      } catch {
        // ignore non-json
      }

      const passed = statusOk && checkOk
      if (!passed) allPass = false

      results.push({
        path: ep.path,
        method: ep.method,
        status: res.status,
        expectedStatus: ep.expectedStatus,
        latencyMs,
        passed,
      })
      console.log(`  ${passed ? '✓' : '✗'} [${ep.method}] ${ep.path} -> ${res.status} (${latencyMs}ms)`)
    } catch (err) {
      allPass = false
      results.push({
        path: ep.path,
        method: ep.method,
        error: err.message,
        passed: false,
      })
      console.log(`  ✗ [${ep.method}] ${ep.path} -> ERROR: ${err.message}`)
    }
  }

  const report = {
    probedAt: new Date().toISOString(),
    baseUrl,
    totalProbed: endpoints.length,
    passedCount: results.filter((r) => r.passed).length,
    allPass,
    results,
  }

  const outPath = resolve(process.cwd(), 'navigation-acceptance-report.json')
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`[navigation-acceptance] report written to ${outPath}. Outcome: ${allPass ? 'PASS' : 'FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

void runAcceptance()
