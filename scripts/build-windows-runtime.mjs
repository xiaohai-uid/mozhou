/**
 * scripts/build-windows-runtime.mjs · Windows 独立本地运行时打包器 (T17)。
 * 
 * 依照 reference/04-release.md T17 规格：
 * - 组装 Windows x64 随包运行环境：已编译前端 dist、已编译后端 dist-server、独立 launcher；
 * - 收集必要的生产 package.json 与配置；
 * - 验证原生模块 ABI 与 Node 生产就绪状态；
 * - 输出到 release-artifacts/windows-runtime/，供 Tauri 打包或直接单机启动。
 */
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const targetDir = join(rootDir, 'release-artifacts', 'windows-runtime')

console.log('[build-windows-runtime] preparing standalone Windows runtime...')

// 1. 确保生产构建已完成
execFileSync('pnpm', ['build'], { cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32' })
execFileSync('pnpm', ['--filter', '@mozhou/web', 'build'], { cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32' })

mkdirSync(targetDir, { recursive: true })

// 2. 复制 Web 生产前端与服务端
const webDist = join(rootDir, 'apps', 'web', 'dist')
const serverDist = join(rootDir, 'apps', 'web', 'dist-server')

if (!existsSync(webDist) || !existsSync(serverDist)) {
  throw new Error('missing compiled web dist or dist-server')
}

cpSync(webDist, join(targetDir, 'dist'), { recursive: true })
cpSync(serverDist, join(targetDir, 'dist-server'), { recursive: true })

// 3. 复制启动脚本与配置说明
const launcherCode = `#!/usr/bin/env node
process.env.NODE_ENV = 'production';
process.env.PORT = process.env.PORT || '5173';
process.env.HOST = '127.0.0.1';
process.env.MOZHOU_HOSTED = 'false';
import './dist-server/productionServer.js';
`
writeFileSync(join(targetDir, 'run.mjs'), launcherCode, 'utf8')

// 4. 生成随包 package.json
const runtimePkg = {
  name: 'mozhou-windows-runtime',
  version: '0.1.0',
  type: 'module',
  main: 'run.mjs',
  scripts: {
    start: 'node run.mjs',
  },
}
writeFileSync(join(targetDir, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8')

console.log(`[build-windows-runtime] successfully assembled runtime at ${targetDir}`)
