#!/usr/bin/env node
/**
 * 墨舟 (Novel OS) 自动化多平台发布包打包脚本。
 * 构建 workspace 与 web dist，打包 Windows/Linux/macOS/Web/Docker 全套安装包。
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const pkgJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
const version = pkgJson.version || '0.1.0'
const artifactsDir = join(rootDir, 'release-artifacts')

console.log(`\n📦 开始构建墨舟 v${version} 发布与安装包...\n`)

process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'

// 1. 确保构建 workspace 和 web
console.log('🔨 [1/5] 编译 packages/* 与 apps/web...')
execSync('pnpm build', { cwd: rootDir, stdio: 'inherit' })
execSync('pnpm --filter @mozhou/web build', { cwd: rootDir, stdio: 'inherit' })

// 2. 清理并准备 release-artifacts 目录
if (existsSync(artifactsDir)) {
  rmSync(artifactsDir, { recursive: true, force: true })
}
mkdirSync(artifactsDir, { recursive: true })

const tempBundleDir = join(artifactsDir, `mozhou-v${version}`)
mkdirSync(tempBundleDir, { recursive: true })

// 3. 复制分发所需核心资产
console.log('📁 [2/5] 收集发布核心资产与启动脚本...')
const filesToCopy = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '启动墨舟.bat',
  'start.sh',
  'Dockerfile',
  'docker-compose.yml',
  'README.md',
]

for (const file of filesToCopy) {
  const src = join(rootDir, file)
  if (existsSync(src)) {
    cpSync(src, join(tempBundleDir, file), { recursive: true })
  }
}

// 复制 scripts 目录
cpSync(join(rootDir, 'scripts'), join(tempBundleDir, 'scripts'), { recursive: true })

// 复制 packages (仅源码及编译 dist 与 package.json)
const packagesDir = join(rootDir, 'packages')
const targetPackagesDir = join(tempBundleDir, 'packages')
mkdirSync(targetPackagesDir, { recursive: true })

const pkgFolders = ['context-compiler', 'data-plane', 'flywheel', 'kernel', 'pipeline', 'quality-engine', 'runtime', 'benchmark']
for (const folder of pkgFolders) {
  const srcPkg = join(packagesDir, folder)
  const destPkg = join(targetPackagesDir, folder)
  if (existsSync(srcPkg)) {
    mkdirSync(destPkg, { recursive: true })
    const files = ['package.json', 'dist', 'assets']
    for (const f of files) {
      const s = join(srcPkg, f)
      if (existsSync(s)) {
        cpSync(s, join(destPkg, f), { recursive: true })
      }
    }
  }
}

// 复制 apps/web (dist, server, package.json, vite.config.ts)
const targetWebDir = join(tempBundleDir, 'apps', 'web')
mkdirSync(targetWebDir, { recursive: true })
const webFiles = ['package.json', 'vite.config.ts', 'dist', 'server']
for (const f of webFiles) {
  const s = join(rootDir, 'apps', 'web', f)
  if (existsSync(s)) {
    cpSync(s, join(targetWebDir, f), { recursive: true })
  }
}

// 生成发布说明
const releaseReadme = `# 🌊 墨舟 (Novel OS) v${version} 生产级独立安装包

墨舟是一款生产级、可商用的长篇小说 AI 辅助创作操作系统。

## 🚀 快速启动指南

### 方式一：Windows 用户（最简一键启动）
1. 双击运行 \`启动墨舟.bat\`；
2. 脚本将自动自检依赖并启动本地创作服务；
3. 默认将在浏览器中自动打开：http://localhost:5173

### 方式二：Linux / macOS 用户
\`\`\`bash
chmod +x start.sh
./start.sh
\`\`\`

### 方式三：Docker 容器一键部署
\`\`\`bash
docker compose up -d
\`\`\`

---
© 2026 墨舟团队 · 保留所有权利
`
writeFileSync(join(tempBundleDir, 'RELEASE_INSTRUCTIONS.md'), releaseReadme, 'utf8')

// 4. 打包各平台压缩包
console.log('🗜️ [3/5] 正在生成各平台安装压缩包...')

try {
  // Web 纯静态产物包
  const webDistName = `mozhou-v${version}-web-dist.tar.gz`
  execSync(`tar --force-local -czf "${join(artifactsDir, webDistName)}" dist`, {
    cwd: join(rootDir, 'apps', 'web'),
    stdio: 'inherit',
  })

  // Windows 绿色免安装包 (.tar.gz)
  const winTarName = `mozhou-v${version}-windows-x64.tar.gz`
  execSync(`tar --force-local -czf "${join(artifactsDir, winTarName)}" "mozhou-v${version}"`, {
    cwd: artifactsDir,
    stdio: 'inherit',
  })

  // Linux 独立包
  const linuxTarName = `mozhou-v${version}-linux-x64.tar.gz`
  execSync(`tar --force-local -czf "${join(artifactsDir, linuxTarName)}" "mozhou-v${version}"`, {
    cwd: artifactsDir,
    stdio: 'inherit',
  })

  // macOS 通用包
  const macTarName = `mozhou-v${version}-darwin-universal.tar.gz`
  execSync(`tar --force-local -czf "${join(artifactsDir, macTarName)}" "mozhou-v${version}"`, {
    cwd: artifactsDir,
    stdio: 'inherit',
  })

  // Docker 快速启动包
  const dockerTarName = `mozhou-v${version}-docker.tar.gz`
  const dockerTemp = join(artifactsDir, 'docker-bundle')
  mkdirSync(dockerTemp, { recursive: true })
  cpSync(join(rootDir, 'Dockerfile'), join(dockerTemp, 'Dockerfile'))
  cpSync(join(rootDir, 'docker-compose.yml'), join(dockerTemp, 'docker-compose.yml'))
  writeFileSync(join(dockerTemp, 'README.md'), '# 墨舟 Docker 部署包\n\n执行 `docker compose up -d` 即可启动服务。', 'utf8')
  execSync(`tar --force-local -czf "${join(artifactsDir, dockerTarName)}" docker-bundle`, {
    cwd: artifactsDir,
    stdio: 'inherit',
  })
  rmSync(dockerTemp, { recursive: true, force: true })

  console.log('✅ [4/5] 压缩包打包成功！')
} catch (err) {
  console.warn('⚠️ 打包命令异常:', err.message)
}

// 5. 输出汇总
console.log('\n🎉 [5/5] 安装包构建完毕！产物清单：')
const artifacts = ['mozhou-v' + version + '-windows-x64.tar.gz', 'mozhou-v' + version + '-linux-x64.tar.gz', 'mozhou-v' + version + '-darwin-universal.tar.gz', 'mozhou-v' + version + '-web-dist.tar.gz', 'mozhou-v' + version + '-docker.tar.gz']

for (const a of artifacts) {
  const p = join(artifactsDir, a)
  if (existsSync(p)) {
    console.log(`  📦 ${a}`)
  }
}
console.log(`\n存放路径: ${artifactsDir}\n`)
