// CI 验证门包装器：workflow 沙盒无法直启 pnpm——Windows 上 pnpm 是 .cmd shim，
// Node 无 shell 的 spawnSync 解析到无扩展名文件报 ENOENT、直启 .cmd 报 EINVAL。
// 统一经此入口：内部 execSync 带 shell，cmd.exe 能解析 pnpm.cmd。
// 用法：node scripts/ci-gate.mjs build|test|graph-check
import { execSync } from 'node:child_process'

const task = process.argv[2]
const commands = {
  build: 'pnpm build',
  test: 'pnpm test',
  'graph-check': 'pnpm graph:check',
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
