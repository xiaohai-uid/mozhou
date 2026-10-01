/**
 * 真实模型测试的**显式入口**（整改 T02）。
 *
 * 为什么要有这个 runner，而不是直接在 package.json 里写 vitest 命令：
 *   "pnpm test:real-model" 本身就是那个显式动作。若脚本只负责跑 vitest 而不负责
 *   校验配置，那么在**没配任何 key** 的机器上它会把全部用例 skip 掉并 exit 0——
 *   正是整改要消灭的那种"绿灯冒充跑过"。所以本 runner 承担三件事：
 *
 *   1. 强制 MOZHOU_RUN_REAL_MODEL_TESTS=1（子进程内），即"你既然点了这个入口，
 *      就等于显式启用了真实模型"；
 *   2. 启动前就校验 MOZHOU_API_KEY / MOZHOU_API_BASE / MOZHOU_MODEL 三项是否齐全，
 *      缺任一项 ⇒ 打印**缺哪个变量名**并 exit 1（绝不回显凭据值）；
 *   3. 只跑与上游直接相关的目标文件，其余 Web 用例由普通 pnpm test 覆盖。
 *
 * 凭据纪律：本文件不读任何本机配置文件、不猜端口、不提供默认模型名、不打印 key、
 * 不把 key 写进子进程命令行（只走 env 继承）。费用由点这个入口的人承担。
 *
 * 退出码：子进程（vitest）的退出码原样透传 ⇒ 上游不可达/鉴权失败同样非零。
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const REAL_MODEL_ENABLE_VAR = 'MOZHOU_RUN_REAL_MODEL_TESTS'
export const REAL_MODEL_CREDENTIAL_VARS = ['MOZHOU_API_KEY', 'MOZHOU_API_BASE', 'MOZHOU_MODEL']

/**
 * 与上游直接相关的目标文件。注意 storyboard/generate.test.ts 也在内：
 * 它的"真机冒烟"用例整改前会在检测到任一 BYOK key 时自动发真实请求
 * （见该文件内注释），因此必须和 *.realModel.test.ts 走同一个显式入口。
 */
export const REAL_MODEL_TEST_FILES = [
  'server/routes/namingRoutes.realModel.test.ts',
  'server/routes/pipelineRoutes.firstChapter.realModel.test.ts',
  'server/routes/realModel.featureSweep.test.ts',
  'server/storyboard/generate.test.ts',
]

export function missingRealModelVars(env = process.env) {
  return REAL_MODEL_CREDENTIAL_VARS.filter((name) => (env[name] ?? '').trim().length === 0)
}

function main() {
  const missing = missingRealModelVars()
  if (missing.length > 0) {
    process.stderr.write(
      '真实模型测试入口拒绝启动：缺少必需配置 ' + missing.join('、') + '。\n' +
        '这些值必须由你显式提供；本脚本不会自动发现本机凭据，也不会回退到任何默认模型。\n' +
        '若只是要跑不需要上游的测试，请直接用 pnpm test（默认零真实模型调用）。\n',
    )
    process.exit(1)
  }

  const args = [
    '--filter',
    '@mozhou/web',
    'exec',
    'vitest',
    'run',
    ...REAL_MODEL_TEST_FILES,
  ]
  process.stdout.write(
    '执行真实模型测试（' + REAL_MODEL_ENABLE_VAR + '=1）：' + REAL_MODEL_TEST_FILES.length + ' 个目标文件。\n' +
      '注意：这会真实调用你配置的上游并产生费用。\n',
  )

  // 凭据只经 env 继承传给子进程，不出现在 argv 里，因此不会出现在进程列表/日志中。
  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, [REAL_MODEL_ENABLE_VAR]: '1' },
  })
  if (result.error) {
    process.stderr.write('无法启动 pnpm：' + result.error.message + '\n')
    process.exit(1)
  }
  process.exit(typeof result.status === 'number' ? result.status : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}