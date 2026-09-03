#!/usr/bin/env node
/**
 * 墨舟 (Novel OS) 生产/分发版统一启动器。
 * 具备环境自检、零额外配置依赖守卫、自动打开浏览器与优雅退出能力。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const webDistDir = join(rootDir, 'apps', 'web', 'dist')
const port = process.env.PORT || '5173'
// 安全默认：发行版仅本机可达。需要 LAN/容器暴露时必须显式设置 HOST。
const host = process.env.HOST || '127.0.0.1'

process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'

console.log('\x1b[36m%s\x1b[0m', `
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   🌊 墨舟 (Novel OS) — 生产级 AI 辅助长篇小说创作操作系统       ║
  ║                                                               ║
  ║   • 访问地址:  http://localhost:${port}                          ║
  ║   • 运行模式:  Production (Vite Preview / API Middleware)      ║
  ║   • 状态:      正在启动服务...                                 ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
`)

if (!existsSync(webDistDir)) {
  console.log('ℹ 首次运行：检测到前端产物未编译，正在执行生产构建...')
  const buildProcess = spawn('pnpm', ['--filter', '@mozhou/web', 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  })

  buildProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error('❌ 前端生产构建失败，请检查编译日志。')
      process.exit(code ?? 1)
    }
    startServer()
  })
} else {
  startServer()
}

function startServer() {
  console.log(`🚀 墨舟本地服务已就绪: http://localhost:${port}\n`)

  const server = spawn('pnpm', ['--filter', '@mozhou/web', 'preview', '--port', port, '--host', host], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  })

  if (process.env.MOZHOU_NO_OPEN !== '1') {
    setTimeout(() => {
      const url = `http://localhost:${port}`
      const openCmd =
        process.platform === 'win32'
          ? `start ${url}`
          : process.platform === 'darwin'
            ? `open ${url}`
            : `xdg-open ${url}`
      spawn(openCmd, { shell: true, stdio: 'ignore' })
    }, 1500)
  }

  const cleanExit = () => {
    console.log('\n🛑 正在停止墨舟服务...')
    server.kill()
    process.exit(0)
  }

  process.on('SIGINT', cleanExit)
  process.on('SIGTERM', cleanExit)
}
