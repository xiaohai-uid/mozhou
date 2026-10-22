import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * 跨浏览器 E2E 冒烟（Chromium / Firefox / WebKit）。
 *
 * 被测对象是**生产服务**（apps/web/dist-server/productionServer.js），不是 Vite dev：
 * 这样断言的是真实静态产物 + 真实安全响应头 + 真实 API 路由。
 *
 * 服务由 e2e/start-server.mjs 起在隔离数据根上（cwd + MOZHOU_DATA_ROOT 都是临时目录），
 * 与开发者本机实例互不影响。
 *
 * 入口是 e2e/run-e2e.mjs（package.json 的 test:e2e）：它先校验产物存在且不陈旧，
 * 不通过就 exit 2，不会让 E2E 对着旧产物通过。
 *
 * 浏览器二进制：pnpm e2e:install（首次或升级 Playwright 后执行）。
 */

// 端口在配置加载期就校验：否则 Number('abc') = NaN 会拼出 `http://127.0.0.1:NaN`，
// 实测先炸成 `TypeError: Invalid URL`，看不出真正原因。run-e2e.mjs 在更早的
// 入口处做同样的检查并保住 exit 2；这里是直调 `playwright test` 时的兜底。
function resolvePort(): number {
  const raw = process.env['MOZHOU_E2E_PORT'] ?? '5310'
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[e2e] MOZHOU_E2E_PORT 非法：${raw}（需为 1–65535 的整数）`)
  }
  return port
}

const PORT = resolvePort()
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // 产物落到系统临时区：仓库根 .gitignore 没有覆盖 Playwright 默认的
  // test-results/ 与 playwright-report/，落仓库会制造未跟踪噪声。
  outputDir: join(tmpdir(), 'mozhou-e2e-results'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    // 命令走仓库根：Playwright 以配置文件所在目录为 cwd 启动它。
    command: 'node e2e/start-server.mjs',
    url: `${BASE_URL}/api/health`,
    // 不复用已有服务：复用会绕过隔离数据根，撞上开发者本机实例。
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
