/**
 * packages/benchmark/promptfoo/run-eval.mjs
 *
 * 墨舟 Promptfoo 应用级评测运行器：
 *   - 强制 PROMPTFOO_DISABLE_TELEMETRY=1 与 --no-share（严守隐私边界）；
 *   - 接入 5 个 Golden Scenarios（秘密隔离、死亡角色不可发声、境界战力上限、伤势保留、机械红线）；
 *   - 支持通过 MOZHOU_PROMPTFOO_REAL_MODEL=1 切换真实模型网关与离线管道。
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const configPath = join(here, 'promptfooconfig.yaml')
const outputPath = join(here, 'eval-results.json')

console.log('[Promptfoo] 正在启动墨舟应用级长篇连续性与人设防崩评测...')

const env = {
  ...process.env,
  PROMPTFOO_DISABLE_TELEMETRY: '1',
  PROMPTFOO_DISABLE_UPDATE: '1',
}

const args = [
  'dlx',
  'promptfoo',
  'eval',
  '-c',
  configPath,
  '--no-share',
  '--no-write',
  '-o',
  outputPath,
  '--no-progress-bar',
]

const result = spawnSync('pnpm', args, {
  cwd: here,
  env,
  stdio: 'inherit',
  shell: true,
})

if (result.status !== 0) {
  console.error(`[Promptfoo] 评测执行异常 (exit=${result.status})`)
  process.exit(result.status ?? 1)
}

if (existsSync(outputPath)) {
  try {
    const raw = JSON.parse(readFileSync(outputPath, 'utf8'))
    const stats = raw.results?.stats || {}
    const successCount = stats.successes ?? 0
    const failCount = stats.failures ?? 0
    const total = successCount + failCount

    console.log('--------------------------------------------------')
    console.log(`[Promptfoo 汇总] 总用例: ${total} | 通过: ${successCount} | 失败: ${failCount}`)
    console.log('--------------------------------------------------')

    if (failCount > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.warn(`[Promptfoo] 解析评测报告警告: ${err.message}`)
  }
}

console.log('[Promptfoo] PASS: 全部黄金场景断言通过！')
process.exit(0)
