#!/usr/bin/env node
/**
 * 墨舟 (Novel OS) 商业发行版统一启动器。
 * 负责环境自检、按需构建、启动正式 Node HTTP 服务、自动打开浏览器与优雅退出。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const webDistDir = join(rootDir, 'apps', 'web', 'dist')
const serverEntry = join(rootDir, 'apps/web/dist-server/productionServer.js')
const port = process.env.PORT || '5173'
// 安全默认：发行版仅本机可达。容器内部可显式 HOST=0.0.0.0，并由宿主端口映射限制访问面。
const host = process.env.HOST || '127.0.0.1'
// 与服务端 dataRoot.ts:17 同一规则：服务端以 cwd=rootDir 启动，故相对覆盖值按 rootDir 解析。
const dataRootOverride = process.env.MOZHOU_DATA_ROOT?.trim()
const dataRoot = dataRootOverride ? resolve(rootDir, dataRootOverride) : join(rootDir, '.mozhou_data')

/**
 * 本机凭据加密主密钥：与 scripts/release/windows/desktop-server.mjs:8-17 同一套引导。
 *
 * 为什么必须在这里做：本文件正是发行资产 `*-local-runtime.tar.gz` 的文档化入口
 * （启动墨舟.bat:49 / start.sh:35 都调它），而它既不设 NODE_ENV 也不设
 * MOZHOU_SECRET_KEY。服务端 providerSettings.resolveMasterKey 在同一组合下会读取
 * 数据根的 installation.key（缺失则用 CSPRNG 现场生成并落盘）——两侧同一套引导，
 * 谁先启动谁铸造，另一侧读回同一把钥匙，密钥不在源码里。
 *
 * 首次启动铸造 installation.key（48 字节随机、0600），此后沿用同一把钥匙。随机密钥
 * 不在源码里；它与 provider-settings.enc 同处数据根，属同一信任边界（文件权限）。
 * 已由环境变量显式指定 MOZHOU_SECRET_KEY 时一律让位，避免把既有凭据改成不可解密。
 */
function ensureInstallationKey() {
  if (process.env.MOZHOU_SECRET_KEY?.trim()) return
  mkdirSync(dataRoot, { recursive: true })
  const keyFile = join(dataRoot, 'installation.key')
  try {
    writeFileSync(keyFile, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 })
    console.log(`ℹ 已生成本机凭据加密主密钥: ${keyFile}`)
    console.log('  请随书稿一起备份；丢失后已保存的 BYOK 凭据无法解密。')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const key = readFileSync(keyFile, 'utf8').trim()
  if (!/^[0-9a-f]{96}$/.test(key)) {
    throw new Error(
      `凭据加密主密钥文件已损坏: ${keyFile}。请从备份恢复；不要替换它，替换会使既有 BYOK 凭据无法解密。`,
    )
  }
  process.env.MOZHOU_SECRET_KEY = key
}

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

// 产物存在但落后于源码时给出警告：陈旧产物会制造假失败（2026-10-12 实测——工作台因
// dist-server 陈旧而崩在 toFixed，一度被当成产品缺陷）。产物缺失由下面的分支直接构建。
if (existsSync(webDistDir) && existsSync(serverEntry)) {
  try {
    execFileSync(process.execPath, [join(rootDir, 'scripts/check-build-freshness.mjs')], { stdio: 'pipe' })
  } catch {
    console.warn('⚠ 生产产物落后于源码。若行为与源码不符，先执行：pnpm --filter @mozhou/web build\n')
  }
}

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

  ensureInstallationKey()

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
