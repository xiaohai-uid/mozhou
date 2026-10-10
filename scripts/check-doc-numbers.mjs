#!/usr/bin/env node
/**
 * check-doc-numbers.mjs —— 扫描文档里的「裸数字断言」，只报不拦。
 *
 * 背景：2026-10-10 的两轮「声称 vs 现实」审计共清出 15 处陈旧声称，**几乎全是数字**——
 * 测试数 848/910/856（实测 2368）、具名导出 194→204 与 67→78、行数 3.6万/2.8万、
 * 以及根 README 里本仓自己认定不可达的「<40MB 内存」。数字写进文档就必然漂移，而没有任何
 * 检查在管它。
 *
 * 本脚本的判据：一行里出现「可验证的规模数字」，但**同一行与相邻一行都没有**日期
 * （YYYY-MM-DD）或命令指针（`pnpm test` / `pnpm run …` / 「实测」），即视为裸数字。
 *
 * 为什么只报不拦（exit 0）：阈值还没定。先让它把漂移**可见**，观察一轮再决定要不要升级成门；
 * 直接阻断会在每次数字变化时挡住无关提交。要当门用可加 `--strict`（有发现即 exit 1）。
 *
 * 用法：node scripts/check-doc-numbers.mjs [--strict]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')

/**
 * 扫描范围：**描述现状的活文档**。
 *
 * 刻意排除两类：
 * - 生成物（`docs/architecture.md`、`docs/term-map.md`）——由生成器与 `--check` 管，不重复管；
 * - 历史报告（`docs/changes/**`、`docs/*report*.md`、`docs/*audit*.md`、文件名带日期的
 *   `docs/*.md`）——它们记的是**当时**的实测值，按今天的数字重判是误报。第一版脚本扫了
 *   全部 `docs/*.md`，7 处发现全部落在 2026-08 的审计报告里，就是这个原因。
 */
const LIVING_DOCS = ['docs/gates.md', 'docs/windows-local-install.md']

function targets() {
  const out = []
  const push = (p) => {
    if (existsSync(join(root, p))) out.push(p)
  }
  push('README.md')
  push('apps/web/README.md')
  push('apps/web/MOBILE_UI_BRIEF.md')
  for (const dir of ['packages']) {
    const base = join(root, dir)
    if (!existsSync(base)) continue
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory()) push(`${dir}/${e.name}/README.md`)
    }
  }
  for (const p of LIVING_DOCS) push(p)
  return out
}

/** 裸数字的形态：规模类断言（不是行号、不是价格、不是版本号）。 */
const PATTERNS = [
  /\b\d[\d,]{2,}\s*(?:个|项|条)?\s*(?:测试|用例)/, // N 个测试 / N 条用例
  /\b\d[\d,]{2,}\s*(?:个|条)\s*(?:具名导出|导出|命名导出)/, // N 个具名导出
  /\b\d[\d,]{2,}\s*个?文件\s*\/\s*\d[\d,]{2,}/, // N 个文件 / M
  /\b\d+(?:\.\d+)?\s*万行/, // N 万行
  /\b\d[\d,]{2,}\s*行代码/, // N 行代码
]

const HAS_ANCHOR = /(\d{4}-\d{2}-\d{2}|pnpm (?:run )?[a-z0-9:*-]+|实测|measured)/i

const findings = []
for (const rel of targets()) {
  const lines = readFileSync(join(root, rel), 'utf8').split('\n')
  lines.forEach((line, idx) => {
    if (!PATTERNS.some((re) => re.test(line))) return
    const window = [lines[idx - 1] ?? '', line, lines[idx + 1] ?? ''].join('\n')
    if (HAS_ANCHOR.test(window)) return
    findings.push(`${rel}:${idx + 1}  ${line.trim().slice(0, 120)}`)
  })
}

if (findings.length === 0) {
  console.log(`PASS 未发现裸数字断言（已扫 ${targets().length} 个文档）`)
  process.exit(0)
}
console.log(`发现 ${findings.length} 处裸数字断言（规模数字旁边既无日期也无命令指针）：`)
for (const f of findings) console.log('  - ' + f)
console.log('\n处置建议：改成「以 <命令> 实测为准（YYYY-MM-DD 实测 N）」——数字会随提交漂移，')
console.log('不要在文档里固化。本检查默认只报不拦（exit 0）；加 --strict 可当门用。')
process.exit(strict ? 1 : 0)
