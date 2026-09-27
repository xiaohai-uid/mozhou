import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = join(root, 'scripts/release/windows')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build on Windows x64 with native Windows dependencies')
const artifacts = join(root, 'release-artifacts')
mkdirSync(artifacts, { recursive: true })
// Unique staging directory: never erase another run or an existing release.
const bundle = mkdtempSync(join(artifacts, 'windows-build-'))
const app = join(bundle, 'app')
mkdirSync(app)
for (const name of ['dist', 'dist-server', 'package.json']) {
  cpSync(join(root, 'apps/web', name), join(app, name), { recursive: true })
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

// Materialize the already-installed dependency graph (lockfile versions), not
// pnpm's absolute Windows junctions. Installed users need no link privileges,
// package manager, network downloads, or access to the developer's workspace.
function dependencies(from, destination, ancestors) {
  const pkg = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'))
  const names = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...Object.keys(pkg.peerDependencies || {})])
  for (const name of names) {
    let actual
    try { actual = locate(name, from) } catch (error) {
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
        filter: path => path === actual || !path.slice(actual.length + 1).split(sep).some(part => part === 'node_modules' || part === '.git'),
      })
    }
    inventory.push({ name, version: dep.version, path: target.slice(bundle.length + 1) })
    dependencies(actual, target, new Map([...ancestors, [name, actual]]))
  }
}
const webRoot = join(root, 'apps/web')
for (const name of Object.keys(JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')).dependencies)) hoisted.set(name, locate(name, webRoot))
console.log('Collecting installed production dependencies...')
dependencies(webRoot, app, new Map())
console.log(`Collected ${inventory.length} dependency packages`)
mkdirSync(join(bundle, 'runtime'))
cpSync(process.execPath, join(bundle, 'runtime/node.exe'))
cpSync(join(source, 'desktop-server.mjs'), join(bundle, 'desktop-server.mjs'))
if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'))
const nodeLicense = join(source, `node-${process.versions.node}-LICENSE.txt`)
if (!existsSync(nodeLicense)) throw new Error(`Missing Node distribution license: ${nodeLicense}`)
cpSync(nodeLicense, join(bundle, 'runtime/LICENSE.txt'))
writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'mozhou-windows', version, type: 'module' }, null, 2))
writeFileSync(join(bundle, 'DEPENDENCIES.json'), JSON.stringify({ node: process.version, packages: inventory }, null, 2))
writeFileSync(join(bundle, '使用说明.txt'), `墨舟 ${version} Windows 本地版\r\n\r\n双击 MoZhou.exe，工作台在默认浏览器打开。\r\n托盘图标可重新打开工作台、查看数据目录、退出服务。\r\n关闭浏览器不会关闭本地服务；退出请使用托盘菜单。\r\n书稿与密钥存放在 %LOCALAPPDATA%\\MoZhou。升级和卸载不删除此目录。\r\n备份时请退出墨舟，再复制整个数据目录（包括 installation.key）。\r\nAI 功能需在设置中配置您自己的模型服务；未配置时仍可手工写作。\r\n本安装包不包含云同步、支付或签名证书。\r\n`)

// Exercise native SQLite with the exact executable and deployed graph.
execFileSync(join(bundle, 'runtime/node.exe'), ['--input-type=module', '-e', `import {createRequire} from 'node:module'; const r=createRequire(process.cwd()+'/app/node_modules/@mozhou/data-plane/package.json'); const Database=r('better-sqlite3'); const db=new Database(':memory:'); db.exec('CREATE TABLE smoke (id INTEGER)'); db.close(); console.log('Packaged SQLite ABI OK');`], { cwd: bundle, stdio: 'inherit' })

const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${join(bundle, 'MoZhou.exe')}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', join(source, 'MoZhou.cs')], { stdio: 'inherit' })
const iscc = process.env.ISCC_PATH || join(process.env.LOCALAPPDATA, 'Programs/Inno Setup 6/ISCC.exe')
execFileSync(iscc, [`/DBundle=${bundle}`, `/DAppVersion=${version}`, `/DOutput=${artifacts}`, join(source, 'installer.iss')], { stdio: 'inherit' })
const installer = join(artifacts, `MoZhou-${version}-windows-x64-setup.exe`)
const hash = createHash('sha256').update(readFileSync(installer)).digest('hex')
writeFileSync(`${installer}.sha256`, `${hash}  ${installer.split(sep).pop()}\n`)
writeFileSync(join(artifacts, 'windows-build-result.json'), JSON.stringify({ version, bundle, installer, sha256: hash, bytes: statSync(installer).size, node: process.version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dependencyCopies: inventory.length }, null, 2))
console.log(JSON.stringify({ installer, sha256: hash, bundle }))
