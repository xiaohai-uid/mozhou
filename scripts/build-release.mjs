#!/usr/bin/env node
/**
 * 墨舟 (Novel OS) 可发布资产构建器。
 *
 * 只生成实际经过当前仓库构建链验证的三类资产：
 * 1) local-runtime：跨平台 Node 22 本地运行时（不是伪装的原生安装包）；
 * 2) web-dist：纯前端静态产物；
 * 3) docker：基于已编译运行时的本机 Docker 包。
 *
 * 任一构建/复制/压缩失败都会直接失败，禁止“告警后仍发布”。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
/**
 * @param {string} raw
 * @returns {{ version?: string }}
 */
function parsePkg(raw) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(raw)
}
const version = parsePkg(readFileSync(join(rootDir, 'package.json'), 'utf8')).version || '0.1.0'
const artifactsDir = join(rootDir, 'release-artifacts')
const bundleName = `mozhou-v${version}`
const runtimeDir = join(artifactsDir, bundleName)

process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {string} [cwd]
 */
function run(command, args, cwd = rootDir) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env })
}

/**
 * @param {string} path
 * @param {string} label
 */
function requirePath(path, label) {
  if (!existsSync(path)) throw new Error(`release invariant failed: missing ${label}: ${path}`)
}

/**
 * @param {string} relativePath
 * @param {string} [destinationRoot]
 */
function copyIfPresent(relativePath, destinationRoot = runtimeDir) {
  const src = join(rootDir, relativePath)
  if (!existsSync(src)) return
  const dest = join(destinationRoot, relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
}

/**
 * @param {string} dir
 */
function pruneTestArtifacts(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      pruneTestArtifacts(full)
    } else if (/\.test\.(js|d\.ts|js\.map)$/.test(entry) || entry.endsWith('.map')) {
      rmSync(full, { force: true })
    }
  }
}

console.log(`\n[release] building MoZhou v${version}\n`)
run('pnpm', ['build'])
run('pnpm', ['--filter', '@mozhou/web', 'build'])

requirePath(join(rootDir, 'apps/web/dist/index.html'), 'web dist')
requirePath(join(rootDir, 'apps/web/dist-server/productionServer.js'), 'production server')

rmSync(artifactsDir, { recursive: true, force: true })
mkdirSync(runtimeDir, { recursive: true })

for (const file of [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'start.bat',
  '启动墨舟.bat',
  'start.sh',
  'README.md',
  'LICENSE',
]) {
  copyIfPresent(file)
}
copyIfPresent('scripts/launcher.mjs')
copyIfPresent('scripts/check-install-env.mjs')

const packageFolders = ['context-compiler', 'data-plane', 'flywheel', 'kernel', 'pipeline', 'quality-engine', 'runtime', 'benchmark']
for (const folder of packageFolders) {
  for (const item of ['package.json', 'dist', 'assets', 'fixtures']) {
    copyIfPresent(`packages/${folder}/${item}`)
  }
  pruneTestArtifacts(join(runtimeDir, 'packages', folder, 'dist'))
}

for (const item of ['package.json', 'dist', 'dist-server']) {
  copyIfPresent(`apps/web/${item}`)
}

const instructions = `# 墨舟 (Novel OS) v${version} 本地发行版

这是可商用部署的本地优先运行时包。它不冒充 Windows/macOS 原生安装器；当前通用包需要 Node.js 22（CI 固定 22.23.2）与 pnpm 9.15.0。

## 启动

- Windows：运行 \`start.bat\`（或 \`启动墨舟.bat\`）
- Linux/macOS：\`chmod +x start.sh && ./start.sh\`
- 默认地址：\`http://127.0.0.1:5173\`

首次启动会按锁文件安装**生产依赖**。发行包已经包含前端构建产物与正式 Node HTTP 服务，不使用 Vite preview 承担发行流量。

## AI / BYOK

未配置 Key 时，界面必须明确保持演示/未配置状态。真实生成可配置：

- \`MOZHOU_API_KEY\` / \`DEEPSEEK_API_KEY\` / \`OPENAI_API_KEY\`
- \`MOZHOU_API_BASE\`（可选，默认公网端点必须 HTTPS）
- \`MOZHOU_MODEL\`（可选）
- \`MOZHOU_ALLOW_PRIVATE_LLM=1\`：仅当部署者明确需要本机/私网 OpenAI-compatible 服务时启用

## 当前不随此资产宣称的能力

- 云同步/云备份尚未实现；接口会显式返回 NOT_IMPLEMENTED。
- 付费许可证激活尚未实现；不会接受伪许可证密钥。
- 原生 Tauri 安装器/代码签名不包含在本发行资产中。

请使用同一 Release 中的 \`SHA256SUMS.txt\` 与 SPDX SBOM 验证供应链信息。
`
writeFileSync(join(runtimeDir, 'RELEASE_INSTRUCTIONS.md'), instructions, 'utf8')

const runtimeArchive = join(artifactsDir, `${bundleName}-local-runtime.tar.gz`)
run('tar', ['-czf', runtimeArchive, bundleName], artifactsDir)

const webArchive = join(artifactsDir, `${bundleName}-web-dist.tar.gz`)
run('tar', ['-czf', webArchive, '-C', join(rootDir, 'apps', 'web', 'dist'), '.'])

const dockerDir = join(artifactsDir, 'docker-bundle')
const dockerRuntimeDir = join(dockerDir, bundleName)
mkdirSync(dockerDir, { recursive: true })
cpSync(runtimeDir, dockerRuntimeDir, { recursive: true })
writeFileSync(join(dockerDir, 'Dockerfile'), `FROM node:22.23.2-bookworm-slim\nWORKDIR /app\nENV NODE_ENV=production\nENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip\nENV PORT=5173\nENV HOST=0.0.0.0\nRUN npm install -g pnpm@9.15.0\nCOPY --chown=node:node ${bundleName}/ /app/\nRUN pnpm install --prod --frozen-lockfile\nUSER node\nEXPOSE 5173\nCMD ["node", "apps/web/dist-server/productionServer.js"]\n`, 'utf8')
writeFileSync(join(dockerDir, 'docker-compose.yml'), `services:\n  mozhou:\n    build: .\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:\${MOZHOU_PORT:-5173}:5173"\n    environment:\n      NODE_ENV: production\n      ONNXRUNTIME_NODE_INSTALL_CUDA: skip\n      PORT: 5173\n      HOST: 0.0.0.0\n      MOZHOU_API_KEY: \${MOZHOU_API_KEY:-}\n      DEEPSEEK_API_KEY: \${DEEPSEEK_API_KEY:-}\n      OPENAI_API_KEY: \${OPENAI_API_KEY:-}\n`, 'utf8')
writeFileSync(join(dockerDir, 'README.md'), '# 墨舟 Docker 本地发行包\n\n执行 `docker compose up --build -d`。宿主端默认只监听 127.0.0.1。\n', 'utf8')

const dockerArchive = join(artifactsDir, `${bundleName}-docker.tar.gz`)
run('tar', ['-czf', dockerArchive, 'docker-bundle'], artifactsDir)
rmSync(dockerDir, { recursive: true, force: true })
rmSync(runtimeDir, { recursive: true, force: true })

for (const archive of [runtimeArchive, webArchive, dockerArchive]) {
  requirePath(archive, 'release archive')
}

console.log('[release] verified assets:')
console.log(`  ${runtimeArchive}`)
console.log(`  ${webArchive}`)
console.log(`  ${dockerArchive}`)
