#!/usr/bin/env node
/**
 * scripts/check-lint-whitelist.mjs
 *
 * 机械对账门：确保 apps/web/server 下所有测试目录和孤儿目录
 * 均在 eslint.config.js 的 allowDefaultProject 中显式登记，
 * 且白名单匹配文件数不超阈值。
 *
 * 背景（2026-10-18 复盘发现一）：
 * typescript-eslint 的 projectService 只读 tsconfig.json，不自动发现
 * tsconfig.server.json。未被前端传递引用的 server 目录（如 agent/、recycle/）
 * 和所有 server 下各级目录的 *.test.ts 必须在 allowDefaultProject 逐目录登记。
 * 此脚本将「新目录登记白名单」由人肉记忆变成确定性检查。
 *
 * 校验规则：
 *   1. 覆盖率：apps/web/server 下每一个含有 *.test.ts 的目录，必须在 allowDefaultProject 中有对应条目；
 *   2. 新鲜度：allowDefaultProject 中的每一条规则必须至少匹配一个真实存在的文件（无死规则）；
 *   3. 阈值：实际匹配总文件数不得超过 maximumDefaultProjectFileMatchCount 配置值（防触顶暴死）。
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 发现缺口或超阈值
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const configPath = join(repoRoot, 'eslint.config.js')
if (!existsSync(configPath)) {
  console.error('[check-lint-whitelist] FAIL: eslint.config.js 不存在')
  process.exit(1)
}

const configSrc = readFileSync(configPath, 'utf8')

// 1. 提取 allowDefaultProject 列表
const allowMatch = configSrc.match(/allowDefaultProject:\s*\[([\s\S]*?)\]/)
if (!allowMatch || !allowMatch[1]) {
  console.error('[check-lint-whitelist] FAIL: 未能在 eslint.config.js 中解析到 allowDefaultProject')
  process.exit(1)
}

const whitelistPatterns = allowMatch[1]
  .split('\n')
  .map((l) => l.trim().replace(/^['"]|['"],?$/g, ''))
  .filter((l) => l && !l.startsWith('//'))

// 2. 提取当前配置的最大匹配数上限
const limitMatch = configSrc.match(/maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING:\s*(\d+)/)
const maxLimit = limitMatch && limitMatch[1] ? Number(limitMatch[1]) : 140

let failed = false

// 检查 1：找出 apps/web/server 下所有含 *.test.ts 的目录，核对是否都在白名单中
const serverDir = join(repoRoot, 'apps', 'web', 'server')
const testDirs = new Set()

function findTestDirs(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      findTestDirs(full)
    } else if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      const relDir = relative(repoRoot, dir).replace(/\\/g, '/')
      testDirs.add(relDir)
    }
  }
}

findTestDirs(serverDir)

const missingTestDirs = []
for (const td of testDirs) {
  // 预期模式：td/*.test.ts 或 td/*.ts
  const hasCoverage = whitelistPatterns.some((p) => {
    const pDir = p.replace(/\/\*.*$/, '')
    return pDir === td
  })
  if (!hasCoverage) {
    missingTestDirs.push(td)
  }
}

if (missingTestDirs.length > 0) {
  console.error(`[check-lint-whitelist] FAIL: 发现 ${missingTestDirs.length} 个测试目录未在 allowDefaultProject 中登记：`)
  for (const d of missingTestDirs) {
    console.error(`  - ${d}/*.test.ts`)
  }
  failed = true
}

// 检查 2 & 3：计算实际匹配文件总数，并检查死规则
let totalMatched = 0
const deadPatterns = []

function matchPattern(pat) {
  const norm = pat.replace(/\\/g, '/')
  const dirPart = norm.includes('*') ? norm.slice(0, norm.indexOf('*')).replace(/\/[^/]*$/, '') : dirname(norm)
  const fullDir = join(repoRoot, dirPart)
  if (!existsSync(fullDir)) return []

  const filePart = norm.slice(dirPart.length + 1)
  const isWildcard = filePart.includes('*')
  if (!isWildcard) {
    return existsSync(join(repoRoot, norm)) ? [norm] : []
  }

  const re = new RegExp('^' + filePart.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  const matched = []
  for (const entry of readdirSync(fullDir)) {
    if (re.test(entry)) {
      matched.push(join(dirPart, entry).replace(/\\/g, '/'))
    }
  }
  return matched
}

for (const pat of whitelistPatterns) {
  const matches = matchPattern(pat)
  if (matches.length === 0) {
    deadPatterns.push(pat)
  }
  totalMatched += matches.length
}

if (deadPatterns.length > 0) {
  console.error(`[check-lint-whitelist] WARN: 发现 ${deadPatterns.length} 条白名单规则未匹配任何现有文件（死规则）：`)
  for (const p of deadPatterns) {
    console.error(`  - ${p}`)
  }
  // 死规则作为警告，暂不阻断，避免破坏现有配置
}

console.log(`[check-lint-whitelist] 当前 allowDefaultProject 规则数: ${whitelistPatterns.length}`)
console.log(`[check-lint-whitelist] 实际匹配文件数: ${totalMatched} / 上限: ${maxLimit}`)

if (totalMatched > maxLimit) {
  console.error(`[check-lint-whitelist] FAIL: 实际匹配文件数 (${totalMatched}) 超过配置上限 (${maxLimit})！`)
  console.error(`  请在 eslint.config.js 中上调 maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING 至 ${totalMatched + 15} 以上。`)
  failed = true
}

// 检查 4：防双重发现陷阱。apps/web/server 下的生产代码（非 *.test.ts）若已被 api.ts 引用，
// 则严禁在 allowDefaultProject 中用 *.ts 登记，否则 typescript-eslint projectService 会报
// "was included by allowDefaultProject but also was found in the project service"。
const apiTsPath = join(repoRoot, 'apps', 'web', 'server', 'api.ts')
if (existsSync(apiTsPath)) {
  const apiSrc = readFileSync(apiTsPath, 'utf8')
  const doubleIncludeRisks = []
  for (const pat of whitelistPatterns) {
    if (pat.startsWith('apps/web/server/') && pat.endsWith('/*.ts') && !pat.endsWith('/*.test.ts')) {
      if (pat.includes('test-support') || pat.endsWith('productionServer.ts') || pat.endsWith('observability.ts')) continue
      const dir = pat.replace(/\/\*\.ts$/, '')
      const dirBase = dir.split('/').pop()
      if (dirBase && (apiSrc.includes(`/${dirBase}/`) || apiSrc.includes(`/${dirBase}.`))) {
        doubleIncludeRisks.push({ pattern: pat, dirBase, dir })
      }
    }
  }
  if (doubleIncludeRisks.length > 0) {
    console.error(`[check-lint-whitelist] FAIL: 发现 ${doubleIncludeRisks.length} 条白名单规则存在双重发现风险（源码已被 api.ts 引用，请收窄为 *.test.ts）：`)
    for (const item of doubleIncludeRisks) {
      console.error(`  - ${item.pattern} -> 应改为 ${item.dir}/*.test.ts`)
    }
    failed = true
  }
}

if (failed) {
  console.error('\n[check-lint-whitelist] 对账未通过。请更新 eslint.config.js。')
  process.exit(1)
}

console.log('[check-lint-whitelist] PASS: 白名单对账全部通过，无漏登记测试目录，未超上限。')
process.exit(0)
