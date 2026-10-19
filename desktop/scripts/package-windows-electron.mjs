import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readSourceStamp } from '../../scripts/release/lib/source-stamp.mjs'
import { createPackage } from '../node_modules/@electron/asar/lib/asar.js'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(here, '..')
const root = resolve(desktopDir, '..')
const source = join(root, 'scripts', 'release', 'windows')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build on Windows x64 with native Windows dependencies')
}

const dirOnly = process.argv.includes('--dir-only')
const stamp = readSourceStamp(root)

if (process.argv.includes('--print-stamp')) {
  console.log(JSON.stringify(stamp, null, 2))
  process.exit(0)
}

if (stamp.dirty) {
  console.warn(`WARNING: 工作区有 ${stamp.dirtyFiles} 个未提交改动——产物戳记作 ${stamp.sourceCommit}，不能作为干净提交 ${stamp.sourceCommitSha} 的证明`)
}

console.log(`[package-windows-electron] 开始打包墨舟 Electron 桌面安装包 (v${version})...`)

// 1. 准备 staging 目录与输出目录
const artifacts = join(root, 'release-artifacts')
mkdirSync(artifacts, { recursive: true })
const bundle = mkdtempSync(join(artifacts, 'electron-windows-build-'))
const electronDist = join(desktopDir, 'node_modules', 'electron', 'dist')

if (!existsSync(electronDist) || !existsSync(join(electronDist, 'electron.exe'))) {
  throw new Error(`缺少 Electron 发布二进制: ${electronDist}。请在 desktop 目录运行 pnpm install。`)
}

// 2. 复制 Electron 运行时并重命名主程序为 MoZhou.exe
console.log('复制 Electron 预编译运行时...')
cpSync(electronDist, bundle, { recursive: true })
const electronExe = join(bundle, 'electron.exe')
const targetExe = join(bundle, 'MoZhou.exe')
if (existsSync(electronExe)) {
  cpSync(electronExe, targetExe)
}

// 3. 将 desktop 壳打包为 resources/app.asar
console.log('打包 Electron 桌面壳为 resources/app.asar...')
const shellStaging = mkdtempSync(join(artifacts, 'shell-staging-'))
try {
  mkdirSync(shellStaging, { recursive: true })
  cpSync(join(desktopDir, 'lib'), join(shellStaging, 'lib'), { recursive: true })
  cpSync(join(desktopDir, 'main.mjs'), join(shellStaging, 'main.mjs'))
  const desktopPkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'))
  writeFileSync(
    join(shellStaging, 'package.json'),
    JSON.stringify(
      {
        name: desktopPkg.name,
        version: desktopPkg.version,
        main: 'main.mjs',
        type: 'module',
      },
      null,
      2
    ) + '\n'
  )

  const resourcesDir = join(bundle, 'resources')
  mkdirSync(resourcesDir, { recursive: true })
  const asarTarget = join(resourcesDir, 'app.asar')
  await createPackage(shellStaging, asarTarget)
  console.log(`✓ 桌面壳 app.asar 打包完成: ${statSync(asarTarget).size} 字节`)
} finally {
  // 清理临时 shell staging
  try {
    cpSync(shellStaging, shellStaging) // no-op check
  } catch {}
}

// 4. 组装服务端应用 app/ 目录与依赖树物化 (ADR-0037: 依赖与资源在 asar 之外)
console.log('组装服务端应用 app/ 与生产依赖树...')
const resourcesDir = join(bundle, 'resources')
const app = join(resourcesDir, 'app')
mkdirSync(app, { recursive: true })

for (const name of ['dist', 'dist-server', 'package.json']) {
  const srcPath = join(root, 'apps/web', name)
  if (!existsSync(srcPath)) {
    throw new Error(`缺少服务端编译产物: ${srcPath}，请先执行 pnpm build`)
  }
  cpSync(srcPath, join(app, name), { recursive: true })
}

const inventory = []
const hoisted = new Map()
function locate(name, from) {
  let cursor = from
  for (;;) {
    const candidate = join(cursor, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error(`Missing installed dependency ${name} from ${from}`)
    cursor = parent
  }
}

function dependencies(from, destination, ancestors) {
  const pkg = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'))
  const names = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ])
  for (const name of names) {
    let actual
    try {
      actual = locate(name, from)
    } catch (error) {
      if (pkg.optionalDependencies?.[name] || pkg.peerDependenciesMeta?.[name]?.optional) continue
      throw error
    }
    if (ancestors.get(name) === actual) continue
    if (!hoisted.has(name)) hoisted.set(name, actual)
    const target = join(hoisted.get(name) === actual ? app : destination, 'node_modules', name)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    const dep = JSON.parse(readFileSync(join(actual, 'package.json'), 'utf8'))
    if (name.startsWith('@mozhou/')) {
      mkdirSync(target, { recursive: true })
      for (const item of ['package.json', 'dist', 'assets', 'fixtures', 'LICENSE']) {
        if (existsSync(join(actual, item))) cpSync(join(actual, item), join(target, item), { recursive: true })
      }
    } else {
      cpSync(actual, target, {
        recursive: true,
        dereference: true,
        filter: (path) =>
          path === actual ||
          !path
            .slice(actual.length + 1)
            .split(sep)
            .some((part) => part === 'node_modules' || part === '.git'),
      })
    }
    inventory.push({ name, version: dep.version, path: target.slice(bundle.length + 1) })
    dependencies(actual, target, new Map([...ancestors, [name, actual]]))
  }
}

const webRoot = join(root, 'apps/web')
for (const name of Object.keys(JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')).dependencies)) {
  hoisted.set(name, locate(name, webRoot))
}
dependencies(webRoot, app, new Map())
console.log(`✓ 已物化 ${inventory.length} 个独立生产依赖包`)

// 5. 组装官方 Node 独立运行时与启动桥接
console.log('配置官方 Node 独立运行时 (runtime/node.exe)...')
const runtimeDir = join(resourcesDir, 'runtime')
mkdirSync(runtimeDir, { recursive: true })
cpSync(process.execPath, join(runtimeDir, 'node.exe'))
cpSync(join(source, 'desktop-server.mjs'), join(resourcesDir, 'desktop-server.mjs'))

if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'))
const nodeLicense = join(source, `node-${process.versions.node}-LICENSE.txt`)
if (!existsSync(nodeLicense)) throw new Error(`Missing Node distribution license: ${nodeLicense}`)
cpSync(nodeLicense, join(runtimeDir, 'LICENSE.txt'))

writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'mozhou-desktop-windows', version, type: 'module' }, null, 2))
writeFileSync(join(bundle, 'DEPENDENCIES.json'), JSON.stringify({ node: process.version, electron: '44.7.0', packages: inventory }, null, 2))
writeFileSync(
  join(bundle, '使用说明.txt'),
  `墨舟 ${version} Windows 桌面版 (Electron)\r\n\r\n双击 MoZhou.exe 启动客户端。\r\n书稿与密钥存放在 %LOCALAPPDATA%\\MoZhou，升级和卸载不删除此目录。\r\n`
)

// 6. 验证打包后的 Node 与原生 better-sqlite3 ABI 契约
console.log('验证部署依赖树原生模块 ABI 兼容性...')
execFileSync(
  join(runtimeDir, 'node.exe'),
  [
    '--input-type=module',
    '-e',
    `import {createRequire} from 'node:module'; const r=createRequire(process.cwd()+'/app/node_modules/@mozhou/data-plane/package.json'); const Database=r('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE TABLE smoke (id INTEGER)'); db.close(); console.log('Packaged SQLite ABI OK');`,
  ],
  { cwd: resourcesDir, stdio: 'inherit' }
)

// 7. 验证桌面壳 headless 自检启动 (--no-sandbox --headless --stop)
console.log('验证打包后桌面壳 MoZhou.exe 基础启动握手...')
const testDataDir = mkdtempSync(join(artifacts, 'test-stop-data-'))
try {
  execFileSync(
    targetExe,
    ['--no-sandbox', '--headless', '--stop', '--data-dir', testDataDir],
    { stdio: 'inherit' }
  )
} finally {
  try {
    const { rmSync } = await import('node:fs')
    rmSync(testDataDir, { recursive: true, force: true })
  } catch {}
}

const buildResult = {
  version,
  bundle,
  node: process.version,
  electron: '44.7.0',
  ...stamp,
  dependencyCopies: inventory.length,
}

if (dirOnly) {
  const dirResultFile = join(artifacts, 'windows-desktop-dir-result.json')
  writeFileSync(dirResultFile, JSON.stringify(buildResult, null, 2) + '\n', 'utf8')
  console.log(`[package-windows-electron] 目录构建完成，路径: ${bundle}`)
  process.exit(0)
}

// 8. 编译 Inno Setup 完整安装器
console.log('正在调用 Inno Setup 编译 Windows 安装包...')
const iscc = process.env.ISCC_PATH || join(process.env.LOCALAPPDATA, 'Programs/Inno Setup 6/ISCC.exe')
if (!existsSync(iscc)) {
  console.warn(`未检测到 Inno Setup (ISCC.exe: ${iscc})，跳过安装器封装，保留构建目录: ${bundle}`)
  process.exit(0)
}

execFileSync(iscc, [`/DBundle=${bundle}`, `/DAppVersion=${version}`, `/DOutput=${artifacts}`, join(source, 'installer.iss')], {
  stdio: 'inherit',
})

const installer = join(artifacts, `MoZhou-${version}-windows-x64-setup.exe`)
const hash = createHash('sha256').update(readFileSync(installer)).digest('hex')
writeFileSync(`${installer}.sha256`, `${hash}  ${installer.split(sep).pop()}\n`)

const installerResult = {
  ...buildResult,
  installer,
  sha256: hash,
  bytes: statSync(installer).size,
}

writeFileSync(join(artifacts, 'windows-electron-build-result.json'), JSON.stringify(installerResult, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ installer, sha256: hash, bundle }))
console.log(`[package-windows-electron] Windows 安装包打包成功: ${installer}`)
