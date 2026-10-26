#!/usr/bin/env node
/**
 * check-doc-paths.mjs —— 核对代理必读文档里的路径与命令是否仍然存在。
 *
 * 背景：2026-10-17 的只读文档审计确认了三类可机械发现的腐化：
 * - `apps/web/DESIGN.md` 仍用 `/mnt/c/...` WSL 绝对路径（仓库已在 Windows `C:\zcode`）；
 * - `GLOSSARY.md` 与 `PROJECT-MAP.md` 引用的报告已移入 `docs/archive/`，旧路径找不到；
 * - 文档里的 `node scripts/*.mjs` 与 `pnpm run <script>` 没有统一核对。
 * 语义漂移（例如 Tauri 与 Electron 的权威冲突）不在本脚本能力内，仍需人工审计。
 *
 * 扫描范围只含**描述现状的活文档**。历史报告（`docs/changes/`、`docs/audit/`、
 * `docs/handoff/`、`docs/plans/`、`docs/specs/`、`specs/`、`.scratch/`、`docs/archive/`）
 * 与 `PROJECT-MAP.md` 刻意排除：它们记录的是当时路径，包括已删除的文件。
 *
 * 判据：
 * 1. 反引号里的仓库相对路径必须存在（按文档目录与仓库根解析）；
 * 2. 不允许 `/mnt/`、`/Users/`、`/home/` 与未登记的盘符绝对路径；
 * 3. `node scripts/*.mjs` 必须存在，`pnpm run <script>` 必须在 package.json 中。
 *
 * 用法：node scripts/check-doc-paths.mjs [--warn]
 * 默认发现即 exit 1；`--warn` 只报告并以 exit 0 结束。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const warnOnly = process.argv.includes('--warn')

const LIVING_DOCS = [
  'AGENTS.md',
  'README.md',
  'GLOSSARY.md',
  'CODING_STANDARDS.md',
  'docs/development.md',
  'docs/gates.md',
  'docs/deployment.md',
  'docs/install.md',
  'docs/user-guide.md',
  'docs/windows-local-install.md',
  'docs/agents/issue-tracker.md',
  'docs/agents/triage-labels.md',
  'docs/agents/domain.md',
  'apps/web/DESIGN.md',
  'apps/web/README.md',
  'apps/web/MOBILE_UI_BRIEF.md',
  'desktop/README.md',
]

function targets() {
  const out = []
  const push = (p) => {
    if (existsSync(join(root, p))) out.push(p)
  }
  for (const p of LIVING_DOCS) push(p)
  const packages = join(root, 'packages')
  if (existsSync(packages)) {
    for (const e of readdirSync(packages, { withFileTypes: true })) {
      if (e.isDirectory()) push(`packages/${e.name}/README.md`)
    }
  }
  return out
}

const REPO_PREFIXES = [
  'apps/',
  'packages/',
  'docs/',
  'scripts/',
  'desktop/',
  'src-tauri/',
  'specs/',
  '.scratch/',
  '.github/',
  '.githooks/',
  '.gitnexus/',
]

/** 允许出现的绝对路径：共享规则链接与 Git Bash 的 sh 路径。 */
const ALLOWED_ABSOLUTE = [
  'C:\\Users\\a1691\\.zcode\\AGENTS.md',
  'C:\\zcode\\AGENTS.md',
  'C:\\Program Files\\Git\\bin',
  'C:\\Users\\...',
]

const rootScripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}

const PLACEHOLDER = /(?:<[^>]*>|\{[^}]*\}|\b\d*[A-Z]{2,}\b|\b\d+[A-Z]\b|\.\.\.)/

function isCandidate(token) {
  if (!token || /\s/.test(token)) return false
  if (/[*|$]/.test(token)) return false
  if (PLACEHOLDER.test(token)) return false
  if (token.startsWith('./') || token.startsWith('../')) return true
  return REPO_PREFIXES.some((prefix) => token.startsWith(prefix))
}

function stripToken(raw) {
  return raw
    .trim()
    .replace(/[),.;:]+$/, '')
    .replace(/:\d+(?:[-,]\d+)*$/, '')
}

function resolveToken(token, docDir) {
  if (token.startsWith('./') || token.startsWith('../')) {
    return [normalize(join(root, docDir, token))]
  }
  return [normalize(join(root, token)), normalize(join(root, docDir, token))]
}

const findings = []

for (const rel of targets()) {
  const docDir = dirname(rel)
  const lines = readFileSync(join(root, rel), 'utf8').split('\n')

  lines.forEach((line, index) => {
    const lineNo = index + 1

    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const token = stripToken(match[1])
      if (!isCandidate(token)) continue
      if (!resolveToken(token, docDir).some((p) => existsSync(p))) {
        findings.push(`${rel}:${lineNo}  路径不存在: ${token}`)
      }
    }

    if (/\/mnt\/[a-z]\//.test(line) || /\/Users\//.test(line) || /\/home\//.test(line) || /[A-Za-z]:\\/.test(line)) {
      if (!ALLOWED_ABSOLUTE.some((allowed) => line.includes(allowed))) {
        findings.push(`${rel}:${lineNo}  绝对路径未登记: ${line.trim().slice(0, 120)}`)
      }
    }

    for (const match of line.matchAll(/`node (scripts\/[^`\s]+\.mjs)`/g)) {
      if (match[1].includes('*')) continue
      if (!existsSync(join(root, match[1]))) {
        findings.push(`${rel}:${lineNo}  脚本不存在: ${match[1]}`)
      }
    }

    for (const match of line.matchAll(/`pnpm run ([a-zA-Z0-9:_-]+)`/g)) {
      if (!(match[1] in rootScripts)) {
        findings.push(`${rel}:${lineNo}  package.json 无脚本: ${match[1]}`)
      }
    }
  })
}

if (findings.length === 0) {
  console.log(`PASS 文档路径与命令一致（已扫 ${targets().length} 个活文档）`)
  process.exit(0)
}

console.log(`发现 ${findings.length} 处文档路径/命令问题：`)
for (const finding of findings) console.log('  - ' + finding)
console.log('\n处置：改指实际路径，或把历史引用移入 docs/archive/ 的归档路径。')
process.exit(warnOnly ? 0 : 1)
