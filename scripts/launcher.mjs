#!/usr/bin/env node
/**
 * 墨舟 (Novel OS) 商业发行版统一启动器。
 * 负责环境自检、按需构建、启动正式 Node HTTP 服务、自动打开浏览器与优雅退出。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const webDistDir = join(rootDir, 'apps', 'web', 'dist')
const serverEntry = join(rootDir, 'apps/web/dist-server/productionServer.js')
const port = process.env.PORT || '5173'
// 安全默认：发行版仅本机可达。容器内部可显式 HOST=0.0.0.0，并由宿主端口映射限制访问面。
const host = process.env.HOST || '127.0.0.1'

process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'

console.log('\x1b[36m%s\x1b[0m', `
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   墨舟 (Novel OS) — 本地优先的长篇小说 AI 创作系统             ║
  ║                                                               ║
  ║   • 访问地址:  http://localhost:${port}                         ║
  ║   • 运行模式:  Production Node Server                         ║
  ║   • 状态:      正在启动服务...                                 ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
`)

if (!existsSync(webDistDir) || !existsSync(serverEntry)) {
  console.log('ℹ 检测到生产产物缺失，正在执行完整生产构建...')
  const buildProcess = spawn('pnpm', ['--filter', '@mozhou/web', 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  })

  buildProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error('生产构建失败，请检查编译日志。')
      process.exit(code ?? 1)
    }
    startServer()
  })
} else {
  startServer()
}

function startServer() {
  console.log(`墨舟本地服务启动中: http://localhost:${port}\n`)

  const server = spawn(process.execPath, [serverEntry], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, PORT: port, HOST: host },
  })

  server.on('exit', (code, signal) => {
    if (code !== 0 && signal === null) {
      console.error(`墨舟服务异常退出，code=${String(code)}`)
      process.exit(code ?? 1)
    }
  })

  if (process.env.MOZHOU_NO_OPEN !== '1') {
    setTimeout(() => {
      const url = `http://localhost:${port}`
      const openCmd =
        process.platform === 'win32'
          ? `start "" "${url}"`
          : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`
      spawn(openCmd, { shell: true, stdio: 'ignore' })
    }, 1200)
  }

  const cleanExit = () => {
    server.kill('SIGTERM')
  }

  process.on('SIGINT', cleanExit)
  process.on('SIGTERM', cleanExit)
}
