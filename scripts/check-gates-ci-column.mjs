#!/usr/bin/env node
/**
 * check-gates-ci-column.mjs —— 校验 docs/gates.md 门表格里「在 CI」这一列是否与
 * .github/workflows/ 的实际情况一致。
 *
 * 为什么单独一个脚本：`scripts/verify-gates-contract.mjs` 只拿**硬编码的三个门名**去比对
 * ci.yml，不解析表格的该列。后果是真实的——2026-10-10 第十轮复核发现 duplication 那一行
 * 写着「❌ 未接入」而它早已是 `graph-gate.yml` 的 CI 作业，门一声不响。该文件当时正被另一条
 * 工作线整体重写，故本检查独立成文，将来可合并回去。
 *
 * 双向校验：
 *   - CI 列点名了某个 workflow（如 `✅ graph-gate.yml`）→ 该 workflow 文件必须存在，且包含
 *     该行命令里的主脚本名（`pnpm run X` / `pnpm X` / `node scripts/Y`）。
 *   - CI 列标了 ❌（未接入）→ **任何** workflow 都不许出现该主脚本名；出现了说明这一行过期。
 *
 * 退出码：0 一致；1 有脱节；2 用法/环境错误。
 *
 * 用法：node scripts/check-gates-ci-column.mjs [gates.md 路径]
 *       可选参数便于用改动过的副本做负例探针，不必动仓库里的真文件。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATES = process.argv[2] ? resolve(process.argv[2]) : join(root, 'docs', 'gates.md')
const WF_DIR = join(root, '.github', 'workflows')

if (!existsSync(GATES)) {
  console.error('FAIL docs/gates.md 不存在')
  process.exit(2)
}
if (!existsSync(WF_DIR)) {
  console.error('FAIL .github/workflows/ 不存在')
  process.exit(2)
}

const workflows = new Map()
for (const name of readdirSync(WF_DIR)) {
  if (!/\.ya?ml$/.test(name)) continue
  workflows.set(name, executedCommands(readFileSync(join(WF_DIR, name), 'utf8')))
}

/**
 * 只取 workflow 里**真正执行的命令**：`run:` 的单行与块形式，并跳过块内的 shell 注释。
 * 不能直接全文搜索——注释里提到某个命令（例如 graph-gate.yml 的头部注释解释
 * 「CI 无法跑 pnpm graph:check，因为索引不入库」）会造成误报。
 */
function executedCommands(text) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    const rest = m[2].trim()
    if (rest && !rest.startsWith('|') && !rest.startsWith('>')) {
      out.push(rest)
      continue
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j]
      if (l.trim() === '') continue
      const ind = l.length - l.trimStart().length
      if (ind <= indent) break
      const t = l.trim()
      if (t.startsWith('#')) continue
      out.push(t)
    }
  }
  return out.join('\n')
}

/** 从命令单元里取出主脚本名：优先 `pnpm run X` / `pnpm X`，其次 `node scripts/Y.mjs`。 */
function primaryCommand(cell) {
  const run = cell.match(/`pnpm (?:run )?([a-z0-9:-]+)`/i)
  if (run) return run[1]
  const node = cell.match(/`node (scripts\/[A-Za-z0-9._-]+)`/)
  if (node) return node[1]
  return null
}

const problems = []
const checked = []

const lines = readFileSync(GATES, 'utf8').split('\n')
// 只取「门清单」那张表：表头含「在 CI」的下一行起，到表结束
const headerIdx = lines.findIndex((l) => l.startsWith('| 门 |') && l.includes('在 CI'))
if (headerIdx < 0) {
  console.error('FAIL docs/gates.md 找不到含「在 CI」列的门表格')
  process.exit(2)
}
const header = lines[headerIdx]
const ciCol = header.split('|').length - 2 // 去掉首尾空段后的列数
if (ciCol !== 5) {
  console.error(`FAIL 门表格列数变了（期望 5，实际 ${ciCol}）——本检查需同步更新`)
  process.exit(2)
}

for (let i = headerIdx + 2; i < lines.length; i += 1) {
  const line = lines[i]
  // 该表被空行切成多块（markdown 里等于多个表），所以遇空行只跳过、不停；遇下一个标题才结束
  if (/^#{1,6}\s/.test(line)) break
  if (!line.startsWith('|')) continue
  if (/^\|\s*-{3,}/.test(line)) continue // 分隔行
  const cells = line.split('|').slice(1, -1).map((c) => c.trim())
  if (cells.length !== 5) continue
  const [gate, command, , , ciCell] = cells
  if (gate === '门') continue // 重复表头
  const token = primaryCommand(command)
  if (!token) continue // 非脚本型命令（如 pnpm 标准链），跳过

  const named = [...ciCell.matchAll(/`([A-Za-z0-9._-]+\.ya?ml)`/g)].map((m) => m[1])
  const markedNotWired = /❌/.test(ciCell)

  if (named.length > 0) {
    for (const wf of named) {
      if (!workflows.has(wf)) {
        problems.push(`「${gate}」的 CI 列点名了 ${wf}，但该 workflow 不存在`)
        continue
      }
      if (!workflows.get(wf).includes(token)) {
        problems.push(`「${gate}」的 CI 列说在 ${wf}，但该文件里找不到「${token}」`)
      } else {
        checked.push(`${gate} → ${wf}（${token}）`)
      }
    }
  } else if (markedNotWired) {
    const hits = [...workflows.entries()].filter(([, text]) => text.includes(token)).map(([n]) => n)
    if (hits.length > 0) {
      problems.push(`「${gate}」标为未接入，但「${token}」出现在 ${hits.join('、')}——该行已过期`)
    } else {
      checked.push(`${gate} → 未接入（核对无 workflow 含 ${token}）`)
    }
  }
}

if (problems.length > 0) {
  console.error('FAIL docs/gates.md 的「在 CI」列与 workflows 脱节：')
  for (const p of problems) console.error('  - ' + p)
  console.error(`\n已核对 ${checked.length} 行，发现 ${problems.length} 处脱节。`)
  process.exit(1)
}
console.log(`PASS docs/gates.md「在 CI」列与 workflows 一致（已核对 ${checked.length} 行）`)
for (const c of checked) console.log('  OK ' + c)
