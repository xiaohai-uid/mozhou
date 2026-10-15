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
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAMP_IMPL = 'scripts/release/lib/source-stamp.mjs'

const SHORT_HEAD = /rev-parse\s+--short\s+HEAD/
const LITERAL_PASS = /status\s*:\s*['"]PASS['"]/i

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
  })
}

if (violations.length > 0) {
  console.error('FAIL 证据卫生检查未通过：')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

console.log(`PASS 证据卫生检查：${files.length} 个脚本，无短 HEAD、无写死 PASS 结论。`)
