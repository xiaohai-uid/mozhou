#!/usr/bin/env node
/**
 * e2e/run-e2e.mjs —— `pnpm test:e2e` 的入口包装器：先做前置检查，再调 Playwright。
 *
 * 为什么不能直接把 Playwright 当入口（2026-10-21 复核实测）：
 *   1. Playwright 把 webServer 提前退出统一折成「测试失败」——
 *      node_modules/.pnpm/playwright@1.63.0/.../lib/runner/index.js:897 只把退出码拼进
 *      错误文案（`... was not able to start. Exit code: ${code}`），进程退出码仍是 1。
 *      于是 launcher 的 exit 2 到不了调用方，「没测成」与「测了但红」无法区分。
 *   2. 端口非法根本到不了 launcher：config 用 `Number('abc') = NaN` 拼出
 *      `http://127.0.0.1:NaN`，实测先炸成 `TypeError: Invalid URL`。
 *   所以前置检查必须在 Playwright 之外、由本脚本完成：任一前置不成立 → exit 2。
 *
 * 退出码契约：
 *   0 通过 · 1 测试失败（Playwright 透传）· 2 环境阻塞（前置检查未通过）
 *
 * 前置检查（缺一不可）：
 *   1. MOZHOU_E2E_PORT 合法（1–65535 的整数）
 *   2. 生产产物存在（缺失 = 还没构建）
 *   3. 产物不早于源码（scripts/check-build-freshness.mjs）——否则 E2E 会对着旧代码
 *      通过，把「忘记重建」伪装成绿色
 *
 * 注：check-build-freshness.mjs 对「产物未构建」返回 0（它假定 launcher 会构建），
 * 所以第 2 条单独拦缺失，两条组合才完整。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACTS = ['apps/web/dist/index.html', 'apps/web/dist-server/productionServer.js']

/**
 * @param {string} message
 * @param {string} [hint]
 */
function blocked(message, hint) {
  console.error(`[e2e] BLOCKED: ${message}`)
  if (hint !== undefined) console.error(`[e2e] ${hint}`)
  process.exit(2)
}

// 1. 端口：与 playwright.config.ts 的校验同口径，但在这里失败能保住 exit 2。
const rawPort = process.env['MOZHOU_E2E_PORT']
const port = Number(rawPort ?? '5310')
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  blocked(
    `MOZHOU_E2E_PORT 非法：${String(rawPort)}`,
    '需为 1–65535 的整数（不设则用默认 5310）。',
  )
}

// 2. 产物存在。缺失说明没构建，不是测试失败。
const missing = ARTIFACTS.filter((artifact) => !existsSync(join(repoRoot, artifact)))
if (missing.length > 0) {
  blocked(
    `生产产物缺失：${missing.join('、')}`,
    '先执行 pnpm --filter @mozhou/web build',
  )
}

// 3. 产物新鲜度。exit 1 陈旧 / exit 2 环境错误，两者都不该继续跑 E2E。
const freshness = spawnSync(
  process.execPath,
  [join(repoRoot, 'scripts', 'check-build-freshness.mjs')],
  { cwd: repoRoot, stdio: 'inherit' },
)
if (freshness.error !== undefined) {
  blocked(`无法运行 scripts/check-build-freshness.mjs：${freshness.error.message}`)
}
if (freshness.status !== 0) {
  blocked(
    `构建产物新鲜度检查未通过（exit ${String(freshness.status)}）`,
    '陈旧产物会让 E2E 对着旧代码通过。重建：pnpm --filter @mozhou/web build',
  )
}

// 4. 前置都通过，交给 Playwright。直接调 CLI 的 JS 入口，避开 Windows 的 .cmd shim。
const cli = join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js')
if (!existsSync(cli)) {
  blocked('未安装 @playwright/test', '先执行 pnpm install')
}

const run = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
})
if (run.error !== undefined) {
  blocked(`Playwright 启动失败：${run.error.message}`)
}
// 0 通过 / 1 测试失败；被信号终止时 status 为 null，按失败处理。
process.exit(run.status ?? 1)
