#!/usr/bin/env node
/**
 * scripts/pnpm.mjs —— 程序化调用 pnpm 的转发器。
 *
 * 为什么需要它：Windows 上 pnpm 是 `.cmd` 垫片，Node 用 spawn/spawnSync 且不带 shell
 * 时解析不到可执行文件。2026-10-22 动态工作流实测：`world.run("pnpm", ["test"])`
 * 直接 `spawn C:\Users\<user>\AppData\Roaming\npm\pnpm ENOENT`，五项修复全部落盘后
 * 整轮在最后一步崩掉。AGENTS.md 原先只指向 `node scripts/ci-gate.mjs`，而那只覆盖门
 * 任务，覆盖不到 `--filter @mozhou/web typecheck` 这类任意命令。
 *
 * 用法：node scripts/pnpm.mjs <pnpm 参数…>
 * 退出码：原样透传 pnpm 的退出码；启动失败时打印原因并退出 1。
 *
 * 安全：`shell: true` 是为了解析 `.cmd` 垫片，因此每个参数都先做双引号包裹与转义，
 * 避免参数里的空格或元字符被 shell 重新解释。
 */
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)

if (argv.length === 0) {
  console.error('[pnpm] 用法：node scripts/pnpm.mjs <pnpm 参数…>')
  process.exit(1)
}

/** 双引号包裹并转义内部双引号，供 shell 解析（Windows cmd 与 POSIX sh 都适用）。 */
function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

const command = ['pnpm', ...argv].map(quote).join(' ')
const result = spawnSync(command, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

if (result.error) {
  console.error(`[pnpm] 启动失败：${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
