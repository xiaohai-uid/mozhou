#!/usr/bin/env node
/**
 * install-hooks.mjs —— 激活本仓的提交钩子。
 *
 * 钩子本体在 `.githooks/pre-commit`（仓库内、随代码版本化，是唯一真源）。本脚本只做激活：
 * 把**仓库级** `core.hooksPath` 指向 `.githooks/`。
 *
 * 为什么不用 `.git/hooks/`：本机全局 gitconfig 设了 `core.hooksPath`（用户的机器级钩子目录），
 * Git 会完全忽略 `.git/hooks/`。2026-10-10 实测——装在 `.git/hooks/pre-commit` 的钩子
 * 在 `git commit` 时没有执行（探针提交顺利落盘），而 `.githooks/pre-commit` 会先把机器级
 * 钩子链式调用回来，两边的检查都不丢。
 *
 * 用法：
 *   node scripts/install-hooks.mjs     # 激活（幂等）
 *   git config --unset core.hooksPath  # 撤销：回到只用机器级钩子
 *   git commit --no-verify             # 单次跳过（自担风险）
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
/** 读一个可能未设置的配置项：未设置时 git 退出 1，这里返回空串而不是抛错。 */
const gitConfigGet = (...args) => {
  try {
    return execFileSync('git', ['-C', root, 'config', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const hookFile = join(root, '.githooks', 'pre-commit')
if (!existsSync(hookFile)) {
  console.error(`FAIL 找不到钩子本体：${hookFile}（它应当随仓库版本化）`)
  process.exit(1)
}

const globalHooksPath = gitConfigGet('--global', '--get', 'core.hooksPath')
const localHooksPath = gitConfigGet('--local', '--get', 'core.hooksPath')

if (localHooksPath === '.githooks') {
  console.log('仓库级 core.hooksPath 已指向 .githooks（幂等，无需改动）')
} else {
  if (localHooksPath !== '') {
    console.error(`FAIL 仓库级 core.hooksPath 已是 "${localHooksPath}"——不覆盖既有设置。请先自行处理。`)
    process.exit(1)
  }
  git('config', '--local', 'core.hooksPath', '.githooks')
  console.log('已设置仓库级 core.hooksPath = .githooks')
}

if (globalHooksPath !== '') {
  console.log(`机器级钩子：${globalHooksPath} —— 本仓钩子会先链式调用它，机器级检查不受影响`)
} else {
  console.log('未检测到机器级 core.hooksPath——本仓钩子独立运行')
}
console.log('撤销：git config --unset core.hooksPath　单次跳过：git commit --no-verify')
