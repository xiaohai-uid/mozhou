// CI 验证门包装器：workflow 沙盒无法直启 pnpm——Windows 上 pnpm 是 .cmd shim，
// Node 无 shell 的 spawnSync 解析到无扩展名文件报 ENOENT、直启 .cmd 报 EINVAL。
// 统一经此入口：内部 execSync 带 shell，cmd.exe 能解析 pnpm.cmd。
// 任务集对齐 .github/workflows/ci.yml 的 novel-os job：build / lint / test（2026-10-05
// 补 lint——本地只跑 build+test 漏掉 lint，导致推送门在 CI 的静态检查步被拦）。
// 2026-10-10 补齐推送前本地门的覆盖面：此前只覆盖 build/lint/test/graph-check，而 CI 与
// graph-gate.yml 还跑文档门、静态导入环与重复度——它们都不在任何本地路径上，于是「门在但
// 没人跑」的那一类问题（生成物陈旧到 HEAD 过不了自己的 CI、重复度门假绿空转）能一路活到
// HEAD。doc-gates / import-cycles / duplication 三个任务补上这个缺口。
// 2026-10-12 复盘再补两条：evidence-hygiene（禁短 HEAD 与写死的 PASS 结论）与
// build-freshness（陈旧 dist/dist-server 会制造假失败——本次会话的崩溃就是它造的）。
// 这两条同样属于「知道但没人拦」，且都不在 CI 视野内（CI 是干净检出 + 现场构建）。
// 2026-10-18 补齐性能与白名单门：perf-smoke（K6 冒烟）与 lint-whitelist（对账检查）。
// 2026-10-18 补：desktop-journey（Playwright Electron 桌面端端到端旅程与 Trace 回归）。
// 用法：node scripts/ci-gate.mjs build|lint|test|graph-check|doc-gates|import-cycles|duplication|evidence-hygiene|build-freshness|perf-smoke|lint-whitelist|desktop-journey
import { execSync } from 'node:child_process'

const task = process.argv[2]
const commands = {
  build: 'pnpm build',
  lint: 'pnpm lint',
  test: 'pnpm run test:coverage:packages && pnpm run test:coverage:web',
  'graph-check': 'pnpm graph:check',
  // 与 ci.yml 的「Doc gates」步骤同集；gen-* 两个 --check 判生成物是否与已提交状态一致
  'doc-gates':
    'node scripts/verify-glossary.mjs && node scripts/verify-gates-contract.mjs && node scripts/verify-package-readmes.mjs && node scripts/gen-architecture.mjs --check && node scripts/gen-term-map.mjs --check && node scripts/check-gates-ci-column.mjs && node scripts/check-doc-numbers.mjs && node scripts/check-doc-paths.mjs',
  // graph-gate.yml 的静态环 job（不依赖 GitNexus 索引，与 graph-check 是两回事）
  'import-cycles': 'node scripts/check-import-cycles.mjs',
  // graph-gate.yml 的重复度 job；经 npx 现场取 jscpd，需要网络
  duplication: 'pnpm duplication',
  // 证据脚本卫生：禁 `rev-parse --short HEAD` 与写死的成功结论 'PASS'
  'evidence-hygiene': 'node scripts/check-evidence-hygiene.mjs',
  // 生产产物是否落后于源码（dist/ 是忽略项，索引型新鲜度检查看不到它）
  'build-freshness': 'node scripts/check-build-freshness.mjs',
  // 2026-10-18 补：K6 性能冒烟门（10 VU / 30s，打只读三端点）
  'perf-smoke': 'pnpm perf:smoke',
  // 2026-10-18 补：eslint 白名单对账门（秒级扫描测试目录与上限）
  'lint-whitelist': 'node scripts/check-lint-whitelist.mjs',
  // 2026-10-18 补：Playwright Electron 桌面端端到端旅程回归与失败 Trace 回放门
  'desktop-journey': 'pnpm verify:desktop-journey',
}
const cmd = commands[task]
if (cmd === undefined) {
  console.error(`unknown task: ${String(task)}（可选：${Object.keys(commands).join(' / ')}）`)
  process.exit(2)
}
try {
  execSync(cmd, { stdio: 'inherit', shell: true })
} catch (error) {
  process.exit(error.status ?? 1)
}
