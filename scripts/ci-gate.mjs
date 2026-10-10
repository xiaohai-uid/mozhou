// CI 验证门包装器：workflow 沙盒无法直启 pnpm——Windows 上 pnpm 是 .cmd shim，
// Node 无 shell 的 spawnSync 解析到无扩展名文件报 ENOENT、直启 .cmd 报 EINVAL。
// 统一经此入口：内部 execSync 带 shell，cmd.exe 能解析 pnpm.cmd。
// 任务集对齐 .github/workflows/ci.yml 的 novel-os job：build / lint / test（2026-10-05
// 补 lint——本地只跑 build+test 漏掉 lint，导致推送门在 CI 的静态检查步被拦）。
// 2026-10-10 补齐推送前本地门的覆盖面：此前只覆盖 build/lint/test/graph-check，而 CI 与
// graph-gate.yml 还跑文档门、静态导入环与重复度——它们都不在任何本地路径上，于是「门在但
// 没人跑」的那一类问题（生成物陈旧到 HEAD 过不了自己的 CI、重复度门假绿空转）能一路活到
// HEAD。doc-gates / import-cycles / duplication 三个任务补上这个缺口。
// 用法：node scripts/ci-gate.mjs build|lint|test|graph-check|doc-gates|import-cycles|duplication
import { execSync } from 'node:child_process'

const task = process.argv[2]
const commands = {
  build: 'pnpm build',
  lint: 'pnpm lint',
  test: 'pnpm test',
  'graph-check': 'pnpm graph:check',
  // 与 ci.yml 的「Doc gates」步骤同集；gen-* 两个 --check 判生成物是否与已提交状态一致
  'doc-gates':
    'node scripts/verify-glossary.mjs && node scripts/verify-gates-contract.mjs && node scripts/verify-package-readmes.mjs && node scripts/gen-architecture.mjs --check && node scripts/gen-term-map.mjs --check && node scripts/check-gates-ci-column.mjs && node scripts/check-doc-numbers.mjs',
  // graph-gate.yml 的静态环 job（不依赖 GitNexus 索引，与 graph-check 是两回事）
  'import-cycles': 'node scripts/check-import-cycles.mjs',
  // graph-gate.yml 的重复度 job；经 npx 现场取 jscpd，需要网络
  duplication: 'pnpm duplication',
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
