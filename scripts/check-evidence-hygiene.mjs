#!/usr/bin/env node
/**
 * check-evidence-hygiene.mjs —— 验收/证据脚本的两条确定性卫生规则。
 *
 * 为什么要有它：2026-10-12 的会话里，这两类问题都不是「没人知道」，而是「知道但没人拦」，
 * 而且都真实制造过错误结论：
 *
 *   1. 短 HEAD 标识源码。六个脚本用 `git rev-parse --short HEAD` 当 sourceCommit，
 *      而仓内 scripts/release/lib/source-stamp.mjs 早已实现「脏工作区加 -dirty」的规则
 *      （该文件头部记着发布审计两次栽在「产物内容与戳的提交不对应」：90b45a1、06a5069）。
 *      短 HEAD 会把「跑的是未提交源码」记成干净提交的证明。
 *
 *   2. 写死的成功结论。scripts/verify-longform-e2e.mjs 曾有 `status: 'PASS'` 字面量，
 *      而它同时把 restartOk / compactionVerified 只记成布尔字段、不进通过条件；历史证据
 *      evidence/longform-journey/2026-10-06T13-41-19-856Z/summary.json 就是
 *      `status:"PASS"` 配 `compactionVerified:false`。这正是「门存在但没在判定」。
 *
 * 规则边界（刻意收窄，避免误报）：
 *   - 只禁**成功**字面量 `PASS`。`BLOCKED` / `FAILED` 写在失败分支里是保守的（只会让结论
 *     更严，不会假绿）；`VERIFIED` 在 verify-*-journey.mjs 里位于 try 断言链内、失败即抛转
 *     catch，属控制流派生，不在此列。要收紧这条规则，先确认替换掉的是同一个失效模式。
 *   - 只查 scripts/ 下的 .mjs。scripts/release/lib/source-stamp.mjs 自身是实现处，豁免。
 *
 * 退出码：0 干净；1 命中；2 环境错误。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAMP_IMPL = 'scripts/release/lib/source-stamp.mjs'

const SHORT_HEAD = /rev-parse\s+--short\s+HEAD/
const LITERAL_PASS = /status\s*:\s*['"]PASS['"]/i
const LITERAL_SUBCHECK_PASSED = /\brecordCheck\s*\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*,\s*['"](?:passed|PASS)['"]/i

/** 递归收集 scripts/ 下的 .mjs（跳过 node_modules）。 */
function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) collect(full, out)
    else if (entry.endsWith('.mjs')) out.push(full)
  }
  return out
}

let files
try {
  files = collect(join(root, 'scripts'), [])
} catch (error) {
  console.error(`环境错误：无法读取 scripts/ —— ${error.message}`)
  process.exit(2)
}

const violations = []
for (const full of files) {
  const rel = relative(root, full).replace(/\\/g, '/')
  const lines = readFileSync(full, 'utf8').split('\n')
  let inBlockComment = false
  lines.forEach((line, index) => {
    // 跳过注释：本文件与其他脚本的头部注释会引用这两个模式来说明规则，
    // 那不是在用它。注释里漏报可以接受，误报会让人直接关掉这道门。
    const trimmed = line.trim()
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      return
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

    if (rel !== STAMP_IMPL && SHORT_HEAD.test(line)) {
      violations.push(`${rel}:${index + 1} 用短 HEAD 标识源码 —— 改用 scripts/release/lib/source-stamp.mjs 的 readSourceStamp（脏工作区须带 -dirty）`)
    }
    if (LITERAL_PASS.test(line)) {
      violations.push(`${rel}:${index + 1} 把成功结论写成字面量 'PASS' —— 结论必须由断言派生，失败以非零退出`)
    }
    if (LITERAL_SUBCHECK_PASSED.test(line)) {
      violations.push(`${rel}:${index + 1} 在 recordCheck 中把检查项结果硬编码为字面量 'passed' —— 子项检查结论必须由真值条件派生（如 isOk ? 'passed' : 'failed'）`)
    }
  })
}

if (violations.length > 0) {
  console.error('FAIL 证据卫生检查未通过：')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

/**
 * 证据文件本身也要查：summary.json 与 result.json 的 status 必须由全部必需结果派生。
 * 历史反例 evidence/longform-journey 曾写 status=PASS 但 compactionVerified=false；
 * 2026-10-18 作者旅程曾有 status=VERIFIED 但存在 failed 子项的假通过。
 * 无证据目录（干净检出 / CI 首次运行前）时跳过，不制造假红。
 */
const evidenceRoot = join(root, 'evidence', 'longform-journey')
let evidenceChecked = 0
const warnings = []
if (existsSync(evidenceRoot)) {
  for (const entry of readdirSync(evidenceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const summary = join(evidenceRoot, entry.name, 'summary.json')
    if (!existsSync(summary)) continue
    evidenceChecked += 1
    const relSummary = relative(root, summary).replace(/\\/g, '/')
    try {
      const record = JSON.parse(readFileSync(summary, 'utf8'))
      if (record.status === 'PASS') {
        for (const field of ['compactionVerified', 'genrePresetVerified', 'restartConsistent']) {
          if (record[field] !== true) {
            violations.push(`${relSummary} status=PASS 但 ${field} 不是 true —— 成功结论必须由全部必需结果派生`)
          }
        }
        if (typeof record.sourceCommit !== 'string' || /^[0-9a-f]{7,12}$/i.test(record.sourceCommit)) {
          warnings.push(`${relSummary} 使用短 HEAD（${String(record.sourceCommit)}）—— 新证据应使用 readSourceStamp 的完整摘要`)
        }
      }
    } catch (error) {
      violations.push(`${relSummary} 无法解析：${error.message}`)
    }
  }
}

const authorJourneyRoot = join(root, 'evidence', 'windows-author-journey')
if (existsSync(authorJourneyRoot)) {
  for (const entry of readdirSync(authorJourneyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const resultJson = join(authorJourneyRoot, entry.name, 'result.json')
    if (!existsSync(resultJson)) continue
    evidenceChecked += 1
    const relResult = relative(root, resultJson).replace(/\\/g, '/')
    try {
      const record = JSON.parse(readFileSync(resultJson, 'utf8'))
      if (record.status === 'VERIFIED') {
        if (record.summary && typeof record.summary.failed === 'number' && record.summary.failed > 0) {
          violations.push(`${relResult} status=VERIFIED 但 summary.failed=${record.summary.failed} —— 成功结论与失败子项自相矛盾`)
        }
        if (Array.isArray(record.checks)) {
          const failedChecks = record.checks.filter((c) => c.verdict === 'failed')
          if (failedChecks.length > 0) {
            violations.push(`${relResult} status=VERIFIED 但存在 ${failedChecks.length} 个 failed 检查项 —— 成功结论与检查明细矛盾`)
          }
        }
      }
    } catch (error) {
      violations.push(`${relResult} 无法解析：${error.message}`)
    }
  }
}

if (violations.length > 0) {
  console.error('FAIL 证据卫生检查未通过：')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
for (const w of warnings) console.warn(`WARN ${w}`)

console.log(`PASS 证据卫生检查：${files.length} 个脚本，无短 HEAD、无写死 PASS/passed 结论；${evidenceChecked} 份证据无自相矛盾。`)
